#!/bin/bash

# End-to-End Regression Test
# This script tests the complete Conductor flow from task creation to PR

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
VPS_HOST="${VPS_HOST:-38.180.136.39}"
API_URL="http://${VPS_HOST}:3000"
REPO="${TEST_REPO:-socialjunky/conductor-test}"
INSTALLATION_ID="${INSTALLATION_ID:-104648177}"
TIMEOUT="${TIMEOUT:-300}"  # 5 minutes

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

test_pass() {
    echo -e "${GREEN}  ✓ $1${NC}"
    ((TESTS_PASSED++))
}

test_fail() {
    echo -e "${RED}  ✗ $1${NC}"
    ((TESTS_FAILED++))
}

# 1. Test Health Endpoint
log_step "Testing health endpoint..."
HEALTH=$(curl -s "${API_URL}/health")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
    test_pass "Health endpoint returns OK"
else
    test_fail "Health endpoint failed: $HEALTH"
fi

# 2. Test Metrics Endpoint
log_step "Testing metrics endpoint..."
METRICS=$(curl -s "${API_URL}/metrics")
if echo "$METRICS" | grep -q "conductor_tasks_total"; then
    test_pass "Metrics endpoint returns Prometheus metrics"
else
    test_fail "Metrics endpoint failed"
fi

# 3. Test Notification Endpoint (without credentials)
log_step "Testing notification endpoint..."
NOTIF=$(curl -s -X POST "${API_URL}/api/test-notification" \
    -H "Content-Type: application/json" \
    -d '{"channel": "telegram"}')
if echo "$NOTIF" | grep -q "bot token not configured"; then
    test_pass "Notification endpoint validates missing config"
else
    test_fail "Notification endpoint unexpected response: $NOTIF"
fi

# 4. Test Task Creation
log_step "Testing task creation..."
TASK_TITLE="E2E Test $(date +%s)"
TASK_RESPONSE=$(curl -s -X POST "${API_URL}/api/trigger" \
    -H "Content-Type: application/json" \
    -d "{
        \"repositoryFullName\": \"${REPO}\",
        \"installationId\": ${INSTALLATION_ID},
        \"title\": \"${TASK_TITLE}\",
        \"description\": \"Automated E2E test task - add a test function\"
    }")

TASK_ID=$(echo "$TASK_RESPONSE" | grep -o '"taskId":"[^"]*"' | cut -d'"' -f4)

if [ -n "$TASK_ID" ]; then
    test_pass "Task created with ID: $TASK_ID"
else
    test_fail "Task creation failed: $TASK_RESPONSE"
    # Skip rest of tests if task creation failed
    log_error "Cannot continue E2E test without task ID"
    echo ""
    echo "Test Results: ${TESTS_PASSED} passed, ${TESTS_FAILED} failed"
    exit 1
fi

# 5. Monitor Task Progress
log_step "Monitoring task progress (timeout: ${TIMEOUT}s)..."

START_TIME=$(date +%s)
LAST_STATUS=""

while true; do
    ELAPSED=$(($(date +%s) - START_TIME))

    if [ "$ELAPSED" -gt "$TIMEOUT" ]; then
        test_fail "Task did not complete within timeout"
        break
    fi

    # Check task status from metrics
    CURRENT_METRICS=$(curl -s "${API_URL}/metrics")

    # Check logs for task progress
    STATUS_LINE=$(ssh -i ~/.ssh/id_ed25519_deploy root@${VPS_HOST} \
        "grep '${TASK_ID}' /var/log/conductor-worker.log 2>/dev/null | tail -1" 2>/dev/null || echo "")

    if echo "$STATUS_LINE" | grep -q "pr_created\|Pull request created"; then
        test_pass "Task completed - PR created"

        # Extract PR URL if available
        PR_URL=$(echo "$STATUS_LINE" | grep -o 'https://github.com[^"]*pull/[0-9]*' || echo "")
        if [ -n "$PR_URL" ]; then
            log_info "PR URL: $PR_URL"
        fi
        break
    elif echo "$STATUS_LINE" | grep -q "failed"; then
        test_fail "Task failed"
        break
    elif echo "$STATUS_LINE" | grep -q "human_review"; then
        log_warn "Task is in human review (might need clarification)"
        test_pass "Task reached human review state"
        break
    fi

    # Show progress
    NEW_STATUS=$(echo "$STATUS_LINE" | grep -o '"to":"[^"]*"' | tail -1 | cut -d'"' -f4 || echo "pending")
    if [ "$NEW_STATUS" != "$LAST_STATUS" ] && [ -n "$NEW_STATUS" ]; then
        log_info "Status: $NEW_STATUS (${ELAPSED}s elapsed)"
        LAST_STATUS="$NEW_STATUS"
    fi

    sleep 10
done

# 6. Verify Final State
log_step "Verifying final state..."

# Check metrics again
FINAL_METRICS=$(curl -s "${API_URL}/metrics")
TOTAL_TASKS=$(echo "$FINAL_METRICS" | grep "conductor_tasks_total" | head -1 | awk '{print $NF}')
if [ -n "$TOTAL_TASKS" ]; then
    test_pass "Metrics show task count: $TOTAL_TASKS+"
fi

# Summary
echo ""
echo "========================================"
echo "       E2E Test Results"
echo "========================================"
echo -e "Tests Passed: ${GREEN}${TESTS_PASSED}${NC}"
echo -e "Tests Failed: ${RED}${TESTS_FAILED}${NC}"
echo "========================================"

if [ "$TESTS_FAILED" -gt 0 ]; then
    exit 1
else
    log_info "All E2E tests passed!"
    exit 0
fi
