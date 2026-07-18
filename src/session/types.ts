/**
 * Session 类型 — 对齐 Claude 的 continue / resume 体验。
 *
 * Maestro 会话记录 TUI/CLI 运行上下文，不存完整模型 transcript
 *（workflow 产物仍在 .maestro/runs）。
 */

import type { WorkflowConfig } from "../types";

export type SessionKind = "tui" | "cli" | "print";
export type SessionStatus =
  | "active"
  | "idle"
  | "completed"
  | "failed"
  | "cancelled";

export interface SessionLogEntry {
  time: string;
  level: "info" | "success" | "error" | "warn";
  message: string;
}

export interface SessionStepSnapshot {
  name: string;
  agent: string;
  status: string;
  summary?: string;
  error?: string;
  attempts?: number;
}

export interface SessionRecord {
  id: string;
  /** 显示名（-n / --name） */
  name?: string;
  kind: SessionKind;
  /** 创建会话时的 cwd */
  cwd: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  mock?: boolean;
  /** 最近一次用户请求 / plan 文本 */
  lastRequest?: string;
  /** 最近工作流配置（可 resume 重跑） */
  lastWorkflow?: WorkflowConfig;
  /** 最近工作流名 */
  workflowName?: string;
  /** 产物目录 */
  artifactDir?: string;
  /** step 快照 */
  steps?: SessionStepSnapshot[];
  /** 命令历史（旧 → 新，最多 100） */
  commandHistory?: string[];
  /** 最近日志（最多 200） */
  logs?: SessionLogEntry[];
  /** 覆盖 model（会话级） */
  model?: string;
  /** 备注 */
  note?: string;
}

export interface SessionIndexEntry {
  id: string;
  name?: string;
  kind: SessionKind;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  workflowName?: string;
  lastRequest?: string;
  mock?: boolean;
}

export interface SessionListOptions {
  cwd?: string;
  /** 仅当前目录 */
  cwdOnly?: boolean;
  limit?: number;
  query?: string;
}
