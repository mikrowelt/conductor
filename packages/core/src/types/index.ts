/**
 * Core types for the Conductor orchestration system
 */

// Task state machine
export type TaskStatus =
  | 'pending'
  | 'decomposing'
  | 'executing'
  | 'review'
  | 'pr_created'
  | 'done'
  | 'failed';

export type SubtaskStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed';

export type AgentRunStatus =
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout';

export type CodeReviewResult = 'approved' | 'changes_requested' | 'failed';

// GitHub types
export interface GitHubProjectItem {
  id: string;
  nodeId: string;
  projectId: string;
  contentId: string;
  contentType: 'Issue' | 'PullRequest' | 'DraftIssue';
  title: string;
  body: string | null;
  status: string;
  url: string;
}

export interface GitHubRepository {
  id: number;
  nodeId: string;
  name: string;
  fullName: string;
  owner: string;
  defaultBranch: string;
  cloneUrl: string;
}

export interface GitHubInstallation {
  id: number;
  accountLogin: string;
  accountType: 'User' | 'Organization';
}

// Task types
export interface Task {
  id: string;
  githubProjectItemId: string;
  githubProjectId: string;
  repositoryId: number;
  repositoryFullName: string;
  installationId: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  branchName: string | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  errorMessage: string | null;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface Subtask {
  id: string;
  taskId: string;
  subprojectPath: string;
  title: string;
  description: string;
  status: SubtaskStatus;
  dependsOn: string[];
  agentRunId: string | null;
  filesModified: string[];
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface AgentRun {
  id: string;
  taskId: string;
  subtaskId: string | null;
  agentType: 'master' | 'sub_agent' | 'code_review';
  status: AgentRunStatus;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  logs: string;
  startedAt: Date;
  completedAt: Date | null;
}

export interface PullRequest {
  id: string;
  taskId: string;
  repositoryFullName: string;
  number: number;
  title: string;
  body: string;
  branchName: string;
  headSha: string;
  url: string;
  status: 'open' | 'merged' | 'closed';
  reviewsPassed: boolean;
  checksStatus: 'pending' | 'success' | 'failure' | null;
  createdAt: Date;
  updatedAt: Date;
  mergedAt: Date | null;
}

export interface CodeReview {
  id: string;
  taskId: string;
  agentRunId: string;
  result: CodeReviewResult;
  iteration: number;
  summary: string;
  issues: CodeReviewIssue[];
  createdAt: Date;
}

export interface CodeReviewIssue {
  file: string;
  line: number | null;
  severity: 'error' | 'warning' | 'suggestion';
  message: string;
  suggestion: string | null;
}

export interface Notification {
  id: string;
  taskId: string;
  type: NotificationType;
  channel: 'telegram' | 'slack' | 'webhook';
  payload: Record<string, unknown>;
  sentAt: Date | null;
  error: string | null;
  createdAt: Date;
}

export type NotificationType =
  | 'task_started'
  | 'task_decomposed'
  | 'subtask_completed'
  | 'review_started'
  | 'review_completed'
  | 'pr_created'
  | 'task_completed'
  | 'task_failed';

// Configuration types
export interface ConductorConfig {
  version: string;
  project: ProjectConfig;
  subprojects: SubprojectsConfig;
  agents: AgentsConfig;
  workflow: WorkflowConfig;
  notifications: NotificationsConfig;
  security: SecurityConfig;
}

export interface ProjectConfig {
  name: string;
  description?: string;
}

export interface SubprojectsConfig {
  autoDetect: {
    enabled: boolean;
    patterns: string[];
  };
  explicit?: SubprojectDefinition[];
}

export interface SubprojectDefinition {
  path: string;
  name: string;
  language?: string;
  testCommand?: string;
  buildCommand?: string;
}

export interface AgentsConfig {
  master: AgentConfig;
  subAgent: SubAgentConfig;
  codeReview: AgentConfig;
}

export interface AgentConfig {
  model: string;
  maxTurns?: number;
  temperature?: number;
}

export interface SubAgentConfig extends AgentConfig {
  maxParallel: number;
  timeoutMinutes: number;
}

export interface WorkflowConfig {
  triggers: {
    startColumn: string;
    reviewColumn?: string;
  };
  branchPattern: string;
  autoMerge?: boolean;
  requireSmokeTest?: boolean;
  smokeTestWebhook?: string;
}

export interface NotificationsConfig {
  telegram?: {
    enabled: boolean;
    botToken?: string;
    chatId?: string;
  };
  slack?: {
    enabled: boolean;
    webhookUrl?: string;
  };
  webhook?: {
    enabled: boolean;
    url?: string;
  };
}

export interface SecurityConfig {
  blockedPatterns: string[];
  maxFilesPerPr: number;
  maxLinesPerPr: number;
  allowedCommands?: string[];
}

// Queue job types
export interface TaskJob {
  taskId: string;
  action: 'decompose' | 'execute' | 'review' | 'create_pr';
}

export interface SubtaskJob {
  subtaskId: string;
  taskId: string;
}

export interface NotificationJob {
  notificationId: string;
}

// Agent communication types
export interface AgentContext {
  taskId: string;
  task: Task;
  repository: GitHubRepository;
  config: ConductorConfig;
  workDir: string;
  branchName: string;
}

export interface SubAgentContext extends AgentContext {
  subtask: Subtask;
  subprojectPath: string;
  sharedContext: SharedContext;
}

export interface SharedContext {
  requirementsUpdates: RequirementsUpdate[];
  modifiedFiles: Map<string, string[]>;
  conflicts: FileConflict[];
}

export interface RequirementsUpdate {
  subprojectPath: string;
  file: string;
  changes: string;
  timestamp: Date;
}

export interface FileConflict {
  file: string;
  subprojects: string[];
  resolutionStrategy: 'merge' | 'priority' | 'manual';
}

// Task decomposition types
export interface TaskDecomposition {
  summary: string;
  affectedSubprojects: string[];
  subtasks: SubtaskDefinition[];
  dependencies: DependencyGraph;
  estimatedComplexity: 'low' | 'medium' | 'high';
}

export interface SubtaskDefinition {
  subprojectPath: string;
  title: string;
  description: string;
  dependsOn: string[];
  files: string[];
}

export interface DependencyGraph {
  nodes: string[];
  edges: Array<{ from: string; to: string }>;
}

// PR creation types
export interface PRTemplate {
  title: string;
  body: string;
  labels: string[];
  reviewers: string[];
  draft: boolean;
}

// Metrics types
export interface TaskMetrics {
  taskId: string;
  totalDuration: number;
  decompositionDuration: number;
  executionDuration: number;
  reviewDuration: number;
  totalTokens: number;
  totalCost: number;
  subtaskCount: number;
  reviewIterations: number;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}

// Event types for internal communication
export type ConductorEvent =
  | { type: 'task.created'; payload: { task: Task } }
  | { type: 'task.status_changed'; payload: { task: Task; previousStatus: TaskStatus } }
  | { type: 'subtask.created'; payload: { subtask: Subtask } }
  | { type: 'subtask.completed'; payload: { subtask: Subtask } }
  | { type: 'subtask.failed'; payload: { subtask: Subtask; error: string } }
  | { type: 'agent.started'; payload: { agentRun: AgentRun } }
  | { type: 'agent.completed'; payload: { agentRun: AgentRun } }
  | { type: 'review.completed'; payload: { review: CodeReview } }
  | { type: 'pr.created'; payload: { pullRequest: PullRequest } }
  | { type: 'notification.sent'; payload: { notification: Notification } };
