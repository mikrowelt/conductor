# Conductor Requirements

## Core Requirements

### Regression Testing
- **Each phase must include regression testing with real data**
- Integration tests should use real GitHub webhooks (via Smee.io)
- Database tests should use actual PostgreSQL instances
- Agent tests should use recorded Claude API responses for consistency
- End-to-end tests should verify the complete flow with the demo monorepo

### Testing Strategy Per Phase

#### Phase 1: Foundation
- Verify database migrations run successfully
- Test Redis connection and basic queue operations
- Verify Docker Compose services start correctly

#### Phase 2: Webhook Server
- Test with real GitHub webhook payloads (recorded from actual events)
- Verify Probot correctly authenticates with GitHub
- Test health check endpoints

#### Phase 3: Worker & Queue
- Test job processing with real task data
- Verify state machine transitions with actual database records
- Test retry logic with simulated failures

#### Phase 4: Agent System
- Test Claude Code CLI spawning with real commands
- Verify output parsing with actual Claude responses
- Test agent pool concurrency limits

#### Phase 5: Orchestrator
- Test task decomposition with real GitHub issues
- Verify subtask creation and dependency resolution
- Test conflict resolution with real file changes

#### Phase 6: Code Review
- Test review agent with actual code diffs
- Verify issue detection accuracy
- Test review loop iterations

#### Phase 7: PR & Deployment
- Test PR creation on actual repositories (demo repo)
- Verify branch naming conventions
- Test smoke test webhook integration

#### Phase 8: Integrations
- Test Telegram bot with real messages
- Verify Grafana metrics export
- Test notification delivery

#### Phase 9: Configuration
- Test config validation with various valid/invalid configs
- Verify auto-detection with real monorepo structures

#### Phase 10: Demo & Documentation
- Full end-to-end test with demo monorepo
- Verify all documentation examples work

## Quality Gates

Each phase must pass the following before proceeding:
1. All unit tests pass (>80% coverage)
2. Integration tests pass with real services
3. No TypeScript errors
4. Linting passes
5. Manual smoke test documented
