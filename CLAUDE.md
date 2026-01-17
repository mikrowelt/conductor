# Conductor - Claude Code Orchestration System

A system where Claude Code agents work together to complete development tasks. One Master Agent coordinates the work, delegating to Sub-Agents that each focus on a specific part of the codebase. Tasks flow through a GitHub Projects board with human review gates.

**This should be a GitHub App/Bot** that anyone can install on their repo with minimal setup.

---

## Full Project Specification

See **[ORIGINAL_PROMPT.md](./ORIGINAL_PROMPT.md)** for the complete project specification including:
- Distribution model (GitHub App, self-hosted)
- Agent architecture (Master, Sub-Agents, Code Review)
- GitHub Projects board workflow
- Git workflow and environments
- Key principles and what needs to be built

---

## Project Layout

```
conductor/
├── packages/           # Core packages
├── demo/              # Demo monorepo for testing
├── config/            # Configuration templates
├── scripts/           # Build and deployment scripts
├── CLAUDE.md          # This file
├── REQUIREMENTS.md    # Technical requirements
└── ORIGINAL_PROMPT.md # Full project specification
```

---

## Development Commands

```bash
pnpm install    # Install dependencies
pnpm build      # Build all packages
pnpm test       # Run tests
pnpm dev        # Start development
```

---

## Access & Authentication

**SSH Deploy Key**: For any repository access (cloning, pushing, etc.), use the user's SSH deploy key. This key is configured for GitHub access.

```bash
# SSH key location (if not using default)
# Ensure SSH agent has the deploy key loaded
ssh-add ~/.ssh/id_deploy  # or wherever the key is stored

# Git operations should use SSH URLs
git clone git@github.com:owner/repo.git
```

**Secrets Location**: `/secrets/`
- `github-app.pem` - GitHub App private key for API authentication

---

## VPS Server

**Production/Staging Server**:
- **IP**: 38.180.136.39
- **User**: root
- **OS**: Ubuntu 22.04.4 LTS
- **Access**: SSH key authentication (use deploy key)

```bash
# Connect to server
ssh -i ~/.ssh/id_ed25519_deploy root@38.180.136.39

# Or add to ssh config (~/.ssh/config):
# Host conductor-vps
#     HostName 38.180.136.39
#     User root
#     IdentityFile ~/.ssh/id_ed25519_deploy
```

**SSH Keys Configured**:
- `mikrowelt@gmail.com` (id_ed25519)
- `deploy-key` (id_ed25519_deploy)

**VPS Services Running**:
- PostgreSQL (Docker): `conductor-postgres` on port 5432
- Redis (Docker): `conductor-redis` on port 6379
- Webhook Server: `node packages/webhook-server/dist/index.js` on port 3000 (as root)
- Worker: `node packages/worker/dist/index.js` (as conductor user)

**Service Logs**:
- Webhook: `/var/log/conductor-webhook.log`
- Worker: `/var/log/conductor-worker.log`

**Health Check**: `curl http://38.180.136.39:3000/health`

---

## GitHub App Configuration

**App ID**: 2671159
**App Name**: conductorboss
**Installation ID**: 104648177 (on socialjunky org)
**Webhook URL**: `http://38.180.136.39:3000/api/github/webhooks`
**Webhook Secret**: `conductor-webhook-secret-123`

**IMPORTANT**: The webhook secret MUST be `conductor-webhook-secret-123` in BOTH places:
1. **GitHub App Settings**: https://github.com/settings/apps/conductorboss → Webhook → Secret
2. **VPS .env file**: `GITHUB_WEBHOOK_SECRET=conductor-webhook-secret-123` in `/root/conductor/.env`

If webhook signature errors occur, verify both locations have this exact secret.

**Test Repository**: `socialjunky/conductor-test` (org-owned, receives webhooks)

---

## Current Test Status

### Manual Trigger Tests (Completed)
The manual trigger endpoint (`POST /api/trigger`) has been tested and works:
- Tasks are decomposed by Master Agent
- Sub-agents execute using Claude Code CLI
- Code review runs
- PRs are created automatically

**Successful PRs Created** (on socialjunky/conductor-test):
- PR #7: Add average function (merged)
- PR #8: Add multiply function (merged)

### Card Movement Implementation

**Status**: Card movements are implemented and code is deployed. The movements are triggered at:
1. **In Progress** - When task starts decomposing (`task-processor.ts:handleDecompose`)
2. **Human Review** - After PR is created (`task-processor.ts:handleCreatePR`)
3. **Done** - When PR is merged (`pull-request.ts:handlePullRequest`)

**Troubleshooting**: If PR merge webhooks fail with signature errors, ensure the GitHub App webhook secret is set to `conductor-webhook-secret-123` (see GitHub App Configuration section above).

### GitHub Projects Integration

**Status**: Requires organization-owned projects. User-owned projects do NOT trigger `projects_v2_item` webhooks.

**Current Workaround**: Use the manual trigger endpoint:
```bash
curl -X POST http://38.180.136.39:3000/api/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "repositoryFullName": "socialjunky/conductor-test",
    "installationId": 104648177,
    "title": "Your task title",
    "description": "Task description"
  }'
```

**Note**: Manual triggers use placeholder project IDs ("manual"), so card movements will log errors but won't affect functionality. Real project webhooks will work when proper project IDs are provided.

---

## Restart Services on VPS

```bash
# SSH to VPS
ssh -i ~/.ssh/id_ed25519_deploy root@38.180.136.39

# Restart all services
cd /root/conductor
docker compose -f config/docker/docker-compose.dev.yml up -d postgres redis

# Start webhook server (as root)
export $(grep -v '^#' .env | xargs)
nohup node packages/webhook-server/dist/index.js > /var/log/conductor-webhook.log 2>&1 &

# Start worker (as conductor user to avoid Claude permission issues)
su - conductor -c "cd /home/conductor/conductor && export \$(grep -v '^#' .env | xargs) && nohup node packages/worker/dist/index.js > /var/log/conductor-worker.log 2>&1 &"
```

---

## Trigger Manual Task

```bash
curl -X POST http://38.180.136.39:3000/api/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "repositoryFullName": "mikrowelt/conductor-test-repo",
    "installationId": 104580643,
    "title": "Your task title",
    "description": "Task description"
  }'
```

---

## Deployment Scripts

```bash
# Deploy to staging (from local machine)
pnpm deploy:staging

# Deploy to production (requires confirmation)
pnpm deploy:production

# Check service status
pnpm service:status

# Restart services
pnpm service:restart

# View logs
pnpm service:logs
```

---

## Metrics & Monitoring

**Prometheus Metrics**: http://38.180.136.39:3000/metrics

**Test Notifications**:
```bash
curl -X POST http://38.180.136.39:3000/api/test-notification \
  -H "Content-Type: application/json" \
  -d '{"channel": "telegram", "botToken": "TOKEN", "chatId": "CHAT_ID"}'
```
