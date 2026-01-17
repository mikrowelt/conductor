# Conductor

**Conductor** is a self-hosted GitHub App that orchestrates Claude Code agents to complete development tasks automatically. When a task moves to "Todo" on a GitHub Projects board, Conductor picks it up, breaks it down, runs parallel Sub-Agents, performs code review, and creates a PR for human review.

## Features

- **GitHub Projects Integration**: Automatically picks up tasks when cards move to "Todo"
- **Intelligent Task Decomposition**: Master Agent analyzes tasks and breaks them into subtasks
- **Parallel Execution**: Sub-Agents work on independent subtasks concurrently
- **Code Review**: Automated code review before PR creation
- **Monorepo Support**: Detects and handles multi-package repositories
- **Notifications**: Telegram, Slack, and webhook integrations
- **Metrics**: Prometheus-compatible metrics for Grafana dashboards

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  GitHub         │     │  Webhook Server  │     │  Redis          │
│  (Projects,     │────▶│  (Probot)        │────▶│  (BullMQ)       │
│   Webhooks)     │     │                  │     │                 │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  PostgreSQL     │◀────│  Worker          │◀────│  Task Queue     │
│  (Tasks,        │     │  (Processors)    │     │                 │
│   Agent Runs)   │     │                  │     │                 │
└─────────────────┘     └────────┬─────────┘     └─────────────────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │ Master   │ │ Sub-     │ │ Code     │
              │ Agent    │ │ Agents   │ │ Review   │
              └──────────┘ └──────────┘ └──────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker and Docker Compose
- GitHub App credentials
- Anthropic API key

### Setup

1. **Clone and install dependencies:**
   ```bash
   git clone https://github.com/your-org/conductor.git
   cd conductor
   pnpm install
   ```

2. **Create a GitHub App:**
   - Go to GitHub Settings → Developer settings → GitHub Apps → New GitHub App
   - Set webhook URL to your server (use Smee.io for local dev)
   - Enable permissions: Repository (read/write), Issues (read/write), Pull requests (read/write), Projects (read)
   - Subscribe to events: `projects_v2_item`, `pull_request`, `issue_comment`, `check_run`
   - Generate and download the private key

3. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

4. **Start services:**
   ```bash
   # Start PostgreSQL and Redis
   pnpm docker:dev

   # Run database migrations
   pnpm db:migrate

   # Start the webhook server
   pnpm --filter @conductor/webhook-server dev

   # In another terminal, start the worker
   pnpm --filter @conductor/worker dev
   ```

5. **Configure your repository:**
   - Install the GitHub App on your repository
   - Copy `.conductor.example.yml` to your repo as `.conductor.yml`
   - Create a GitHub Project with a "Todo" column

## Configuration

Create a `.conductor.yml` file in your repository:

```yaml
version: "1.0"

project:
  name: "my-app"

subprojects:
  auto_detect:
    enabled: true
    patterns:
      - "packages/*"
      - "apps/*"

agents:
  master:
    model: "claude-sonnet-4-20250514"
    maxTurns: 30
  sub_agent:
    model: "claude-sonnet-4-20250514"
    maxParallel: 5
    timeoutMinutes: 30

workflow:
  triggers:
    startColumn: "Todo"
  branchPattern: "conductor/{task_id}/{short_description}"

notifications:
  telegram:
    enabled: true
```

See `.conductor.example.yml` for all configuration options.

## Packages

| Package | Description |
|---------|-------------|
| `@conductor/core` | Shared types, database schema, utilities |
| `@conductor/webhook-server` | Probot GitHub App, webhook handling |
| `@conductor/worker` | BullMQ job processors |
| `@conductor/agents` | Claude Code CLI runner, agent pool |
| `@conductor/orchestrator` | Master Agent, task decomposition, code review |
| `@conductor/integrations` | Telegram, Grafana, webhook integrations |

## How It Works

1. **Task Detection**: When a card moves to "Todo" in your GitHub Project, Conductor receives a webhook
2. **Task Creation**: A task record is created and queued for processing
3. **Decomposition**: The Master Agent analyzes the task and breaks it into subtasks
4. **Parallel Execution**: Sub-Agents work on subtasks concurrently (up to 5 by default)
5. **Code Review**: A Code Review Agent reviews all changes
6. **PR Creation**: If review passes, a PR is created with a summary of changes
7. **Notification**: Optionally notify via Telegram/Slack

## Commands

Conductor responds to commands in issue comments:

- `/conductor status` - Show active tasks
- `/conductor retry` - Retry a failed task
- `/conductor help` - Show available commands

## Development

```bash
# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint
```

## Operations

### Service Management

```bash
# Check service status
pnpm service:status

# Restart all services
pnpm service:restart

# View logs
pnpm service:logs
```

### Deployment

```bash
# Deploy to staging
pnpm deploy:staging

# Deploy to production (with confirmation)
pnpm deploy:production
```

### Preview Environments

```bash
# Create a preview environment for a PR
pnpm preview:create 123

# List active preview environments
pnpm preview:list

# Destroy a preview environment
pnpm preview:destroy 123
```

### Metrics

Prometheus-compatible metrics are available at `/metrics`:

```bash
curl http://your-server:3000/metrics
```

Available metrics:
- `conductor_tasks_total` - Tasks by status
- `conductor_subtasks_total` - Subtasks by status
- `conductor_tokens_total` - Total tokens used
- `conductor_cost_total_dollars` - Total API cost
- `conductor_agent_runs_total` - Agent runs by type
- `conductor_task_duration_seconds_avg` - Average task duration

### Notifications

Test notifications via the API:

```bash
# Test Telegram notification
curl -X POST http://your-server:3000/api/test-notification \
  -H "Content-Type: application/json" \
  -d '{"channel": "telegram", "botToken": "your-token", "chatId": "your-chat-id"}'
```

## Deployment

### Docker Compose (Production)

```bash
# Create secrets directory and add your secrets
mkdir -p secrets
echo "your_postgres_password" > secrets/postgres_password.txt
# Copy your GitHub private key to secrets/github-app.pem
# etc.

# Start services
docker compose -f config/docker/docker-compose.yml up -d
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GITHUB_APP_ID` | GitHub App ID |
| `GITHUB_PRIVATE_KEY_PATH` | Path to GitHub App private key |
| `GITHUB_WEBHOOK_SECRET` | Webhook secret |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token (optional) |
| `TELEGRAM_CHAT_ID` | Telegram chat ID (optional) |

## Security

- GitHub private keys are stored as Docker secrets
- API keys are never logged
- Sensitive file patterns are blocked from agent access
- Maximum file/line limits prevent runaway changes
- Agents run with Claude Code's built-in sandboxing

## License

MIT
