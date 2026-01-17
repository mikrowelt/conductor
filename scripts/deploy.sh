#!/bin/bash

# Conductor Deployment Script
# Usage: ./deploy.sh [staging|production] [--skip-build] [--skip-migrate]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VPS_HOST="${VPS_HOST:-38.180.136.39}"
VPS_USER="${VPS_USER:-root}"
SSH_KEY="${SSH_KEY:-~/.ssh/id_ed25519_deploy}"
REMOTE_DIR="${REMOTE_DIR:-/root/conductor}"
CONDUCTOR_USER="${CONDUCTOR_USER:-conductor}"

# Parse arguments
ENVIRONMENT="${1:-staging}"
SKIP_BUILD=false
SKIP_MIGRATE=false

shift || true
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-build) SKIP_BUILD=true; shift ;;
        --skip-migrate) SKIP_MIGRATE=true; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Validate environment
if [[ "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "production" ]]; then
    log_error "Invalid environment: $ENVIRONMENT. Must be 'staging' or 'production'"
    exit 1
fi

# Production confirmation
if [[ "$ENVIRONMENT" == "production" ]]; then
    echo -e "${RED}WARNING: You are about to deploy to PRODUCTION!${NC}"
    read -p "Type 'yes' to confirm: " confirm
    if [[ "$confirm" != "yes" ]]; then
        log_info "Deployment cancelled"
        exit 0
    fi
fi

log_info "Starting deployment to $ENVIRONMENT"

# Build locally
if [[ "$SKIP_BUILD" == false ]]; then
    log_info "Building packages..."
    cd "$PROJECT_ROOT"
    pnpm build
else
    log_warn "Skipping build (--skip-build)"
fi

# Sync files to server
log_info "Syncing files to $VPS_HOST..."
rsync -avz --delete \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude '.env' \
    --exclude 'secrets' \
    -e "ssh -i $SSH_KEY" \
    "$PROJECT_ROOT/" \
    "$VPS_USER@$VPS_HOST:$REMOTE_DIR/"

# Run remote deployment
log_info "Running remote deployment..."
ssh -i "$SSH_KEY" "$VPS_USER@$VPS_HOST" << REMOTE_SCRIPT
    set -e
    cd $REMOTE_DIR

    echo "=== Stopping services ==="
    pkill -f "node packages/worker/dist/index.js" 2>/dev/null || true
    pkill -f "node packages/webhook-server/dist/index.js" 2>/dev/null || true
    sleep 2

    echo "=== Syncing code to conductor user ==="
    rsync -a $REMOTE_DIR/ /home/$CONDUCTOR_USER/conductor/ --exclude node_modules
    chown -R $CONDUCTOR_USER:$CONDUCTOR_USER /home/$CONDUCTOR_USER/conductor
    cp $REMOTE_DIR/.env /home/$CONDUCTOR_USER/conductor/.env
    chown $CONDUCTOR_USER:$CONDUCTOR_USER /home/$CONDUCTOR_USER/conductor/.env

    echo "=== Starting webhook server ==="
    export \$(grep -v '^#' .env | xargs)
    nohup node packages/webhook-server/dist/index.js > /var/log/conductor-webhook.log 2>&1 &

    echo "=== Starting worker as $CONDUCTOR_USER ==="
    su - $CONDUCTOR_USER -c "cd /home/$CONDUCTOR_USER/conductor && export \\\$(grep -v '^#' .env | xargs) && nohup node packages/worker/dist/index.js >> /var/log/conductor-worker.log 2>&1 &"

    sleep 3

    echo "=== Verifying services ==="
    if pgrep -f "node packages/webhook-server/dist/index.js" > /dev/null; then
        echo "Webhook server: RUNNING"
    else
        echo "Webhook server: FAILED"
        exit 1
    fi

    if pgrep -f "node packages/worker/dist/index.js" > /dev/null; then
        echo "Worker: RUNNING"
    else
        echo "Worker: FAILED"
        exit 1
    fi

    echo "=== Deployment complete ==="
REMOTE_SCRIPT

# Health check
log_info "Running health check..."
sleep 2
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://$VPS_HOST:3000/health" || echo "000")

if [[ "$HTTP_STATUS" == "200" ]]; then
    log_info "Health check passed!"
else
    log_error "Health check failed (HTTP $HTTP_STATUS)"
    exit 1
fi

log_info "Deployment to $ENVIRONMENT completed successfully!"
echo ""
echo "Services:"
echo "  - Webhook Server: http://$VPS_HOST:3000"
echo "  - Health Check:   http://$VPS_HOST:3000/health"
