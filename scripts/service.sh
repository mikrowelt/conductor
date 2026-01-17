#!/bin/bash

# Conductor Service Management
# Usage: ./service.sh [start|stop|restart|status|logs] [service]

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
CONDUCTOR_USER="${CONDUCTOR_USER:-conductor}"

ACTION="${1:-status}"
SERVICE="${2:-all}"

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

show_usage() {
    echo "Usage: $0 [start|stop|restart|status|logs] [webhook|worker|all]"
    echo ""
    echo "Commands:"
    echo "  start   [service]  - Start service(s)"
    echo "  stop    [service]  - Stop service(s)"
    echo "  restart [service]  - Restart service(s)"
    echo "  status  [service]  - Show service status"
    echo "  logs    [service]  - Tail service logs"
    echo ""
    echo "Services:"
    echo "  webhook - Webhook server"
    echo "  worker  - Background worker"
    echo "  all     - All services (default)"
}

run_remote() {
    ssh -i "$SSH_KEY" "$VPS_USER@$VPS_HOST" "$@"
}

start_services() {
    local service=$1
    log_info "Starting $service service(s)..."

    run_remote << REMOTE_SCRIPT
        set -e
        cd /root/conductor
        export \$(grep -v '^#' .env | xargs)

        if [ "$service" == "webhook" ] || [ "$service" == "all" ]; then
            echo "Starting webhook server..."
            pkill -f "node packages/webhook-server/dist/index.js" 2>/dev/null || true
            sleep 1
            nohup node packages/webhook-server/dist/index.js > /var/log/conductor-webhook.log 2>&1 &
            echo "Webhook server started"
        fi

        if [ "$service" == "worker" ] || [ "$service" == "all" ]; then
            echo "Starting worker..."
            pkill -f "node packages/worker/dist/index.js" 2>/dev/null || true
            sleep 1
            su - $CONDUCTOR_USER -c "cd /home/$CONDUCTOR_USER/conductor && export \\\$(grep -v '^#' .env | xargs) && nohup node packages/worker/dist/index.js >> /var/log/conductor-worker.log 2>&1 &"
            echo "Worker started"
        fi

        sleep 2
        echo ""
        echo "Service Status:"
        pgrep -a -f "node packages" || echo "No services running"
REMOTE_SCRIPT
}

stop_services() {
    local service=$1
    log_info "Stopping $service service(s)..."

    run_remote << REMOTE_SCRIPT
        if [ "$service" == "webhook" ] || [ "$service" == "all" ]; then
            echo "Stopping webhook server..."
            pkill -f "node packages/webhook-server/dist/index.js" 2>/dev/null || echo "Not running"
        fi

        if [ "$service" == "worker" ] || [ "$service" == "all" ]; then
            echo "Stopping worker..."
            pkill -f "node packages/worker/dist/index.js" 2>/dev/null || echo "Not running"
        fi

        echo "Services stopped"
REMOTE_SCRIPT
}

show_status() {
    log_info "Checking service status..."

    run_remote << 'REMOTE_SCRIPT'
        echo ""
        echo "=== Service Status ==="
        echo ""

        # Webhook server
        if pgrep -f "node packages/webhook-server/dist/index.js" > /dev/null; then
            webhook_pid=$(pgrep -f "node packages/webhook-server/dist/index.js")
            webhook_user=$(ps -o user= -p $webhook_pid)
            echo "Webhook Server: RUNNING (PID: $webhook_pid, User: $webhook_user)"
        else
            echo "Webhook Server: STOPPED"
        fi

        # Worker
        if pgrep -f "node packages/worker/dist/index.js" > /dev/null; then
            worker_pid=$(pgrep -f "node packages/worker/dist/index.js")
            worker_user=$(ps -o user= -p $worker_pid)
            echo "Worker:         RUNNING (PID: $worker_pid, User: $worker_user)"
        else
            echo "Worker:         STOPPED"
        fi

        echo ""
        echo "=== Docker Services ==="
        docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null | grep -E "(conductor|NAMES)" || echo "Docker not available"

        echo ""
        echo "=== Health Check ==="
        curl -s http://localhost:3000/health 2>/dev/null && echo "" || echo "Health endpoint not responding"

        echo ""
        echo "=== Disk Usage ==="
        df -h / | tail -1

        echo ""
        echo "=== Memory ==="
        free -h | head -2
REMOTE_SCRIPT
}

show_logs() {
    local service=$1
    log_info "Tailing logs for $service..."

    local log_files=""
    if [ "$service" == "webhook" ] || [ "$service" == "all" ]; then
        log_files="$log_files /var/log/conductor-webhook.log"
    fi
    if [ "$service" == "worker" ] || [ "$service" == "all" ]; then
        log_files="$log_files /var/log/conductor-worker.log"
    fi

    run_remote "tail -f $log_files"
}

# Main
case "$ACTION" in
    start)
        start_services "$SERVICE"
        ;;
    stop)
        stop_services "$SERVICE"
        ;;
    restart)
        stop_services "$SERVICE"
        sleep 2
        start_services "$SERVICE"
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs "$SERVICE"
        ;;
    *)
        log_error "Unknown action: $ACTION"
        show_usage
        exit 1
        ;;
esac
