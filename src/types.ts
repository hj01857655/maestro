/**
 * Maestro — 核心类型定义。
 *
 * 整个编排系统的类型基石，所有模块共享的类型在此定义。
 */

/* ========== 消息 ========== */

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
}

/* ========== Provider ========== */

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
  extraHeaders?: Record<string, string>;
}

export interface ProviderResult {
  content: string;
  model: string;
  provider: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  raw?: unknown;
}

export type ProviderKind = "claude" | "openai" | "gemini" | "grok";

/* ========== Agent ========== */

export interface AgentConfig {
  /** Agent 唯一标识 */
  name: string;
  /** 角色名称，如 "designer" / "coder" / "reviewer" */
  role: string;
  /** 绑定哪个 provider */
  provider: ProviderKind;
  /** 使用的模型名 */
  model: string;
  /** 系统提示词 */
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
  /** 是否启用本地 tools（默认按角色：coder/tester/reviewer 开） */
  enableTools?: boolean;
}

/* ========== Workflow ========== */

export type StepStatus = "pending" | "running" | "success" | "failed" | "skipped";

export interface Condition {
  /** 依赖的上游 step 名称 */
  sourceStep: string;
  /** 期望状态（不指定则只要完成即可） */
  status?: StepStatus;
  /**
   * 条件表达式，支持：
   *   exists | true | false
   *   status:success | status:failed
   *   contains:关键词
   *   equals:精确值
   *   matches:regex
   *   not:contains:xxx
   */
  when?: string;
}

export interface StepConfig {
  name: string;
  agent: string;
  /** prompt 模板，支持 {{ stepName }} 变量注入 */
  prompt: string;
  /** 依赖的上游 step */
  inputs?: string[];
  conditions?: Condition[];
  /** 单 step 失败后的额外重试次数（不含首次） */
  maxRetries?: number;
  /** 存入上下文的 key（默认 step.name） */
  outputKey?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface WorkflowConfig {
  name: string;
  description?: string;
  steps: StepConfig[];
  maxGlobalRetries?: number;
  onComplete?: string;
  /**
   * 产物输出目录。设置后每个 step 结果写入
   *   <outputDir>/<runId>/<step>.md 与 manifest.json
   */
  outputDir?: string;
}

/* ========== 运行时状态 ========== */

export interface RunState {
  workflowName: string;
  status: "running" | "completed" | "failed";
  startedAt: number;
  completedAt?: number;
  stepStates: Map<string, StepRunState>;
  context: Record<string, unknown>;
  error?: string;
}

export interface StepRunState {
  name: string;
  status: StepStatus;
  attempts: number;
  startedAt?: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
}
