#!/bin/bash

# PR Preview Environment Management
# Usage: ./preview-env.sh [create|destroy|list] [pr-number]

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
VPS_HOST="${VPS_HOST:-38.180.136.39}"
VPS_USER="${VPS_USER:-root}"
SSH_KEY="${SSH_KEY:-~/.ssh/id_ed25519_deploy}"
PREVIEW_BASE_PORT="${PREVIEW_BASE_PORT:-4000}"

ACTION="${1:-list}"
PR_NUMBER="${2:-}"

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

show_usage() {
    echo "Usage: $0 [create|destroy|list] [pr-number]"
    echo ""
    echo "Commands:"
    echo "  create <pr-number>  - Create a preview environment for PR"
    echo "  destroy <pr-number> - Destroy a preview environment"
    echo "  list                - List all active preview environments"
    echo ""
    echo "Environment Variables:"
    echo "  VPS_HOST            - Server hostname (default: 38.180.136.39)"
    echo "  SSH_KEY             - SSH key path (default: ~/.ssh/id_ed25519_deploy)"
    echo "  PREVIEW_BASE_PORT   - Base port for preview envs (default: 4000)"
}

# Calculate port for PR
get_pr_port() {
    local pr=$1
    echo $((PREVIEW_BASE_PORT + pr))
}

# Create preview environment
create_preview() {
    local pr=$1
    local port=$(get_pr_port $pr)

    log_info "Creating preview environment for PR #$pr on port $port"

    ssh -i "$SSH_KEY" "$VPS_USER@$VPS_HOST" << REMOTE_SCRIPT
        set -e

        PREVIEW_DIR="/tmp/conductor-preview-$pr"

        # Clone or update preview directory
        if [ -d "\$PREVIEW_DIR" ]; then
            echo "Preview directory exists, updating..."
            cd "\$PREVIEW_DIR"
            git fetch origin
        else
            echo "Creating preview directory..."
            git clone /root/conductor "\$PREVIEW_DIR"
            cd "\$PREVIEW_DIR"
        fi

        # Create preview-specific database
        echo "Setting up preview database..."
        docker exec conductor-postgres psql -U conductor -c "CREATE DATABASE conductor_pr_$pr;" 2>/dev/null || true

        # Copy .env and modify for preview
        cp /root/conductor/.env "\$PREVIEW_DIR/.env"
        sed -i "s/conductor\$/conductor_pr_$pr/" "\$PREVIEW_DIR/.env"
        echo "PORT=$port" >> "\$PREVIEW_DIR/.env"

        # Start preview webhook server
        cd "\$PREVIEW_DIR"
        export \$(grep -v '^#' .env | xargs)

        # Kill existing preview if running
        pkill -f "conductor-preview-$pr" 2>/dev/null || true
        sleep 1

        nohup node packages/webhook-server/dist/index.js > /var/log/conductor-preview-$pr.log 2>&1 &

        sleep 2

        if pgrep -f "PORT=$port" > /dev/null; then
            echo "Preview environment started on port $port"
        else
            echo "Failed to start preview environment"
            exit 1
        fi
REMOTE_SCRIPT

    log_info "Preview environment created!"
    echo ""
    echo "Preview URL: http://$VPS_HOST:$port"
    echo "Health Check: http://$VPS_HOST:$port/health"
    echo "Logs: /var/log/conductor-preview-$pr.log"
}

# Destroy preview environment
destroy_preview() {
    local pr=$1
    local port=$(get_pr_port $pr)

    log_info "Destroying preview environment for PR #$pr"

    ssh -i "$SSH_KEY" "$VPS_USER@$VPS_HOST" << REMOTE_SCRIPT
        set -e

        PREVIEW_DIR="/tmp/conductor-preview-$pr"

        # Stop preview server
        pkill -f "conductor-preview-$pr" 2>/dev/null || true
        fuser -k $port/tcp 2>/dev/null || true

        # Drop preview database
        docker exec conductor-postgres psql -U conductor -c "DROP DATABASE IF EXISTS conductor_pr_$pr;" 2>/dev/null || true

        # Remove preview directory
        rm -rf "\$PREVIEW_DIR"
        rm -f "/var/log/conductor-preview-$pr.log"

        echo "Preview environment destroyed"
REMOTE_SCRIPT

    log_info "Preview environment for PR #$pr destroyed"
}

# List preview environments
list_previews() {
    log_info "Listing active preview environments..."

    ssh -i "$SSH_KEY" "$VPS_USER@$VPS_HOST" << 'REMOTE_SCRIPT'
        echo ""
        echo "Active Preview Environments:"
        echo "============================"

        # Find preview directories
        for dir in /tmp/conductor-preview-*; do
            if [ -d "$dir" ]; then
                pr=$(echo "$dir" | grep -oP 'preview-\K\d+')
                port=$((4000 + pr))

                # Check if running
                if pgrep -f "conductor-preview-$pr" > /dev/null; then
                    status="RUNNING"
                else
                    status="STOPPED"
                fi

                echo "PR #$pr - Port $port - $status"
            fi
        done

        # Check for preview databases
        echo ""
        echo "Preview Databases:"
        docker exec conductor-postgres psql -U conductor -c "\l" 2>/dev/null | grep "conductor_pr_" || echo "  None"
REMOTE_SCRIPT
}

# Main
case "$ACTION" in
    create)
        if [ -z "$PR_NUMBER" ]; then
            log_error "PR number required for create"
            show_usage
            exit 1
        fi
        create_preview "$PR_NUMBER"
        ;;
    destroy)
        if [ -z "$PR_NUMBER" ]; then
            log_error "PR number required for destroy"
            show_usage
            exit 1
        fi
        destroy_preview "$PR_NUMBER"
        ;;
    list)
        list_previews
        ;;
    *)
        log_error "Unknown action: $ACTION"
        show_usage
        exit 1
        ;;
esac
