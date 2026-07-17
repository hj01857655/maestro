/**
 * Orchestrator 结构化事件。
 *
 * 对照 Grok Build 的 Action / TaskResult：
 * - 不再靠解析日志文本驱动 UI
 * - TUI / CLI 都订阅同一事件流
 */

import type { StepStatus } from "../types";

export type OrchestratorEvent =
  | { type: "workflow:start"; workflowName: string; stepCount: number; mock?: boolean }
  | { type: "workflow:complete"; workflowName: string; status: "completed" | "failed"; durationMs: number }
  | { type: "workflow:cancelled"; workflowName: string }
  | { type: "step:start"; step: string; agent: string; attempt: number }
  | {
      type: "step:complete";
      step: string;
      status: Extract<StepStatus, "success" | "failed" | "skipped">;
      summary?: string;
      /** 完整输出（可能截断，供 TUI /show） */
      content?: string;
      error?: string;
      attempt: number;
    }
  | {
      type: "step:stream";
      step: string;
      delta: string;
    }
  | { type: "log"; level: "info" | "success" | "error" | "warn"; message: string }
  | { type: "retry:round"; round: number };

export type OrchestratorListener = (event: OrchestratorEvent) => void;
