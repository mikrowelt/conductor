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
**Installation ID**: 104580643 (on mikrowelt's repos)
**Webhook URL**: `http://38.180.136.39:3000/api/github/webhooks`
**Webhook Secret**: `conductor-webhook-secret-123`

**Test Repository**: `mikrowelt/conductor-test-repo`

---

## Current Test Status

### Manual Trigger Tests (Completed)
The manual trigger endpoint (`POST /api/trigger`) has been tested and works:
- Tasks are decomposed by Master Agent
- Sub-agents execute using Claude Code CLI
- Code review runs
- PRs are created automatically

**Successful PRs Created**:
- PR #3: Add min function
- PR #4: Add sign function

### GitHub Projects Integration (Pending)
To test the full workflow as described in ORIGINAL_PROMPT.md:
1. Create a GitHub Project board with columns: Icebox, Todo, In Progress, Human Review, Done, Redo
2. Create issues and link them to the project
3. Move cards to "Todo" column
4. Verify webhooks trigger Conductor
5. Verify full flow: Todo → In Progress → Human Review → Done

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
