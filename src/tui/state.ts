/**
 * TUI 运行时状态 — 驱动界面渲染的可观察状态。
 */

import type { StepStatus } from "../types";

export type UiMode = "idle" | "running" | "completed" | "failed" | "help";

export interface StepUiState {
  name: string;
  agent: string;
  status: StepStatus;
  summary?: string;
  /** 完整输出（/show 查看） */
  content?: string;
  error?: string;
  attempts: number;
}

export interface LogEntry {
  id: number;
  time: string;
  level: "info" | "success" | "error" | "warn";
  message: string;
}

export interface TuiState {
  mode: UiMode;
  workflowName: string;
  steps: StepUiState[];
  logs: LogEntry[];
  statusLine: string;
  startedAt?: number;
  completedAt?: number;
  mock: boolean;
  /** 当前输入框内容 */
  input: string;
  /** 是否显示帮助面板 */
  showHelp: boolean;
  /** 命令历史（旧 → 新） */
  commandHistory: string[];
  /** 历史浏览索引，-1 表示不在浏览 */
  historyIndex: number;
  /** slash 补全下拉 */
  slashOpen: boolean;
  slashQuery: string;
  slashSelected: number;
  /** /show 查看的 step 名；null 关闭 */
  inspectStep: string | null;
}

export function createInitialState(): TuiState {
  return {
    mode: "idle",
    workflowName: "",
    steps: [],
    logs: [],
    statusLine: "就绪 · 输入 /help 查看命令",
    mock: false,
    input: "",
    showHelp: false,
    commandHistory: [],
    historyIndex: -1,
    slashOpen: false,
    slashQuery: "",
    slashSelected: 0,
    inspectStep: null,
  };
}

export function statusIcon(status: StepStatus): string {
  switch (status) {
    case "pending":
      return "○";
    case "running":
      return "●";
    case "success":
      return "✓";
    case "failed":
      return "✗";
    case "skipped":
      return "–";
  }
}

export function statusColor(status: StepStatus): string {
  switch (status) {
    case "pending":
      return "gray";
    case "running":
      return "cyan";
    case "success":
      return "green";
    case "failed":
      return "red";
    case "skipped":
      return "yellow";
  }
}
