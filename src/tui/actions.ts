/**
 * TUI Action — 用户意图（同步、无副作用）。
 *
 * 对照 Grok Build `Action`：
 * input → Action → reduce → (state, effects) → effect runner
 */

import type { OrchestratorEvent } from "../core/events";
import type { PermissionMode } from "../permissions";
import type { StepUiState } from "./state";

export type TuiAction =
  | { type: "input/set"; value: string }
  | { type: "input/clear" }
  | { type: "help/show" }
  | { type: "help/hide" }
  | { type: "logs/clear" }
  | { type: "logs/push"; level: "info" | "success" | "error" | "warn"; message: string }
  | { type: "status/set"; statusLine: string }
  | {
      type: "workflow/prepare";
      workflowName: string;
      steps: StepUiState[];
      mock: boolean;
      stepDeps?: Record<string, string[]>;
    }
  | { type: "workflow/running" }
  | { type: "workflow/finished"; status: "completed" | "failed" | "cancelled"; durationMs?: number }
  | { type: "step/update"; name: string; patch: Partial<StepUiState> }
  | { type: "orchestrator/event"; event: OrchestratorEvent }
  | { type: "history/push"; command: string }
  | { type: "history/prev" }
  | { type: "history/next" }
  | { type: "slash/open"; query: string }
  | { type: "slash/close" }
  | { type: "slash/select"; delta: number }
  | { type: "slash/set-selected"; index: number }
  | { type: "slash/accept"; name: string; keepOpen?: boolean }
  | { type: "inspect/open"; step: string }
  | { type: "inspect/close" }
  | {
      type: "session/bind";
      sessionId: string;
      sessionName?: string;
    }
  | {
      type: "session/hydrate";
      sessionId: string;
      sessionName?: string;
      workflowName?: string;
      mock?: boolean;
      steps?: StepUiState[];
      logs?: Array<{
        level: "info" | "success" | "error" | "warn";
        message: string;
        time?: string;
      }>;
      commandHistory?: string[];
      statusLine?: string;
    }
  | { type: "workflow/reset" }
  | {
      type: "permission/set-mode";
      mode: PermissionMode;
    }
  | {
      type: "permission/pending";
      pending: {
        id: number;
        tool: string;
        risk: string;
        summary: string;
        step?: string;
        agent?: string;
      } | null;
    }
  | { type: "quit" };

/** Effect — 由 reduce 产出，交给 effect runner 执行（异步/IO） */
export type TuiEffect =
  | { type: "run-workflow"; path: string; mock: boolean }
  | { type: "plan-and-run"; request: string; mock: boolean; test?: boolean }
  | { type: "rerun-last" }
  | { type: "stop-workflow" }
  | { type: "permission-answer"; allow: boolean }
  | { type: "exit" }
  | { type: "none" };
