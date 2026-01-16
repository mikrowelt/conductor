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
