# Claude Code Orchestration System

## What We're Building

A system where Claude Code agents work together to complete development tasks. One Master Agent coordinates the work, delegating to Sub-Agents that each focus on a specific part of the codebase. Tasks flow through a GitHub Projects board with human review gates.

**This should be a GitHub App/Bot** that anyone can install on their repo with minimal setup. Think of it like Dependabot or Renovate - install it, add a config file, and it works.

---

## Distribution Model

### As a GitHub App
- Users install the app on their GitHub org/repo
- App requests necessary permissions (repo, projects, PRs, etc.)
- Users add a config file to their repo (e.g., `.claude-orchestrator.yml`)
- App automatically starts working when tasks move to Todo

### Easy Onboarding
- Install app → Add config file → Create GitHub Project board → Start adding tasks
- Sensible defaults so minimal config needed
- Auto-detects sub-projects if not specified
- Creates CLAUDE.md and REQUIREMENTS.md templates if missing

### Self-Hosted Option
- Can also be self-hosted for enterprises
- Docker image that runs the bot
- Connect your own Anthropic API key
- Full control over infrastructure

---

## The Big Picture

```
Human creates task → Claude picks it up → Claude breaks it down →
Sub-agents do the work → Code review → Smoke test → PR created →
Human reviews → Merged & deployed
```

---

## Project Structure

We have a root directory containing multiple sub-projects (separate git repos or folders). Each sub-project is independent but may depend on others.

**Key files that must exist:**
- `CLAUDE.md` in root and each sub-project - instructions for Claude Code
- `REQUIREMENTS.md` in root and each sub-project - technical requirements, API contracts, dependencies

Claude Code must keep REQUIREMENTS.md files updated whenever interfaces change. Each sub-project's CLAUDE.md should reference the REQUIREMENTS.md.

---

## Agents

### Master Agent
- Works from the root directory
- Sees the whole project
- Reads tasks from GitHub Projects
- Breaks tasks into sub-tasks
- Delegates to Sub-Agents
- Resolves conflicts between Sub-Agents' work
- Triggers Code Review Agent
- Runs smoke tests on staging
- Creates PRs
- Moves tasks through the board
- Can ask humans questions by moving task to Human Review with comments

### Sub-Agents
- Each works in ONE sub-project only
- Can read other sub-projects (for dependencies) but only modify their own
- Implements the specific work assigned by Master Agent
- Updates REQUIREMENTS.md if they change interfaces
- Multiple can run in parallel on different sub-projects

### Code Review Agent
- Reviews all changes before PR
- Checks for bugs, security issues, code quality
- Reports issues back to Master Agent
- Master Agent fixes or delegates fixes

---

## GitHub Projects Board

| Column | Who Controls | What Happens |
|--------|--------------|--------------|
| **Icebox** | Human | Ideas, backlog - not ready for work |
| **Todo** | Human moves here | Triggers Master Agent to start |
| **In Progress** | Agent | Work is happening |
| **Human Review** | Agent moves here | PR ready, or agent has questions |
| **Done** | System | PR merged and deployed to production |
| **Redo** | Human moves here | Feedback provided, agent should retry |

---

## Workflows

### Happy Path
1. Human moves task from Icebox → Todo
2. Master Agent picks up task, moves to In Progress
3. Master Agent analyzes and decomposes task
4. Master Agent spawns Sub-Agents for each sub-project involved
5. Sub-Agents complete their work (can be parallel)
6. Master Agent pulls everything together, resolves any conflicts
7. Code Review Agent reviews
8. Master Agent fixes any issues found
9. Master Agent deploys to staging, runs smoke tests
10. Master Agent creates PR, moves task to Human Review
11. Human reviews PR, approves
12. PR merges, auto-deploys to production
13. Task moves to Done

### Question Path
- At any point, if agent is unsure about requirements:
  - Move task to Human Review
  - Add comment with specific questions
  - Wait for human to answer and move to Redo

### Redo Path
- Human reviews PR, finds issues
- Human adds comments explaining what's wrong
- Human moves task to Redo
- Master Agent picks up task, reads feedback
- Master Agent addresses feedback
- Back to normal flow

### Error Path
- If agent crashes or times out
- Move task to Redo
- Add comment explaining what happened

---

## Git Workflow

- Main branch is protected
- One branch per task
- All Sub-Agents work on the same task branch
- Master Agent handles merge conflicts at the end
- Squash merge when PR is approved
- Last agent to finish handles conflicts if concurrent changes

---

## Environments

### Staging
- Used for smoke testing before human review
- Master Agent deploys here and tests

### PR Preview
- Each PR gets its own preview environment
- Clones the staging database (sanitized)
- Human can test changes in isolation
- Cleaned up when PR closes

### Production
- Auto-deploys when PR merges to main

---

## GitHub App Integration

### Installation Flow
1. User visits app page on GitHub Marketplace (or self-hosts)
2. User installs app on their org/repo
3. App requests permissions: repo, projects, pull requests, workflows
4. User adds `.claude-orchestrator.yml` to their repo
5. User creates a GitHub Project board with required columns (or app creates it)
6. Done - app starts listening for task movements

### Config File (`.claude-orchestrator.yml`)
Lives in the repo root. Should support:
- Sub-project paths (or auto-detect)
- Branch naming preferences
- Notification settings (optional: Telegram, Slack, or webhook)
- Environment URLs (staging, production)
- Custom agent instructions (optional)
- Feature flags (enable/disable code review, smoke tests, etc.)

### Webhook Events to Handle
- `projects_v2_item` - Card moved between columns
- `pull_request` - PR opened, closed, merged
- `issue_comment` - Comments on tasks/PRs
- `push` - For deployment triggers

### Multi-Tenant Considerations (if hosted)
- Each installation has its own config
- API keys per installation (user provides their Anthropic key)
- Isolated execution environments
- Usage tracking per installation

---

## Notifications (Optional)

Optionally send notifications via Telegram, Slack, or webhook for:
- Task needs human review
- Agent has questions
- Task failed/errored
- Deployment failed

---

## Logging

Log to Grafana:
- All agent actions
- Task progress
- Errors
- Token usage per task

---

## Task Card Format

When humans create tasks, they should include:
- Clear description of what needs to be done
- Acceptance criteria (how to know it's done)
- Which sub-projects are involved (scope)
- Any relevant context or links

---

## Smoke Testing

Master Agent verifies changes work by:
- Deploying to staging
- Testing against acceptance criteria
- Checking endpoints work
- Verifying no errors in logs
- Documenting results in task comments

---

## REQUIREMENTS.md Purpose

Each sub-project's REQUIREMENTS.md should contain:
- What this sub-project does
- What it depends on (internal and external)
- What APIs/interfaces it exposes
- What events it publishes/consumes
- How to build and run it

Claude Code must update these whenever changes affect interfaces. This is how agents understand how sub-projects connect.

---

## Key Principles

1. **Humans control the board** - Only humans move to Todo and decide when Done
2. **Agents ask when unsure** - Better to ask than guess wrong
3. **Documentation stays current** - REQUIREMENTS.md is always up to date
4. **Test before review** - Always smoke test on staging
5. **One task, one branch** - Keep changes focused
6. **Parallel when possible** - Sub-agents can work simultaneously
7. **Master resolves conflicts** - Single point of coordination

---

## What Claude Code Needs to Build

1. **GitHub App/Bot** - The installable app that users add to their repos
2. **Webhook handler** - Receives GitHub events (project card moves, PR events, etc.)
3. **The agent system** - Master, Sub-Agent, and Code Review agent prompts/logic
4. **GitHub integration** - Read/update Projects board, create PRs, add comments
5. **Orchestration** - Trigger when cards move, spawn agents, coordinate work
6. **Deployment scripts** - Staging, preview environments, production
7. **Notification system** - Optional alerts via Telegram, Slack, or webhook (configurable)
8. **Logging** - Grafana integration (optional, configurable)
9. **The file structure** - CLAUDE.md and REQUIREMENTS.md templates and management
10. **Config schema** - Define what goes in `.claude-orchestrator.yml`
11. **CLI tool** - For self-hosted setup and local testing
12. **Documentation** - How to install, configure, and use

---

## Questions to Ask Human

Before starting, Claude Code should clarify:

### For the GitHub App itself:
- App name and branding?
- Hosted service, self-hosted only, or both?
- Where will the app be hosted? (Vercel, Railway, AWS, etc.)
- Pricing model if hosted? (free tier, paid plans?)

### For initial test/demo setup:
- What are the actual sub-projects? (paths and names)
- GitHub repo details (owner, repo name, project number)
- Notification setup (optional: Telegram, Slack, or webhook)
- Staging/production server details
- Database setup for preview environments
- Any existing CI/CD to integrate with

### Config file design:
- What should be required vs optional?
- What sensible defaults make sense?
- How much auto-detection vs explicit config?
