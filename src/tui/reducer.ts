/**
 * TUI reducer — 纯函数：state + action → nextState
 *
 * 对照 Grok Build dispatch：同步、无副作用。
 */

import type { TuiAction } from "./actions";
import {
  createInitialState,
  type LogEntry,
  type TuiState,
} from "./state";

let logSeq = 0;

function nowTime(): string {
  return new Date().toTimeString().slice(0, 8);
}

function makeLog(level: LogEntry["level"], message: string): LogEntry {
  return { id: ++logSeq, time: nowTime(), level, message };
}

function pushLog(state: TuiState, level: LogEntry["level"], message: string): TuiState {
  return {
    ...state,
    logs: [...state.logs, makeLog(level, message)].slice(-200),
  };
}

/** 仅命令名阶段（/xxx 无空格）才打开下拉 */
function slashFromInput(value: string): { open: boolean; query: string } {
  const m = value.match(/^\/(\S*)$/);
  if (!m) return { open: false, query: "" };
  return { open: true, query: m[1] };
}

export function reduce(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case "input/set": {
      const slash = slashFromInput(action.value);
      return {
        ...state,
        input: action.value,
        historyIndex: -1,
        slashOpen: slash.open,
        slashQuery: slash.query,
        // 输入变化时重置选中，避免越界
        slashSelected: slash.open ? state.slashSelected : 0,
      };
    }
    case "input/clear":
      return {
        ...state,
        input: "",
        historyIndex: -1,
        slashOpen: false,
        slashQuery: "",
        slashSelected: 0,
      };
    case "help/show":
      return { ...state, showHelp: true, mode: state.mode === "running" ? "running" : "help" };
    case "help/hide":
      return {
        ...state,
        showHelp: false,
        mode: state.mode === "help" ? "idle" : state.mode,
      };
    case "logs/clear":
      return { ...state, logs: [] };
    case "logs/push":
      return pushLog(state, action.level, action.message);
    case "status/set":
      return { ...state, statusLine: action.statusLine };
    case "workflow/prepare":
      return {
        ...state,
        mode: "running",
        workflowName: action.workflowName,
        steps: action.steps,
        mock: action.mock,
        startedAt: Date.now(),
        completedAt: undefined,
        showHelp: false,
        statusLine: `运行中: ${action.workflowName}`,
      };
    case "workflow/running":
      return { ...state, mode: "running" };
    case "workflow/finished": {
      const mode =
        action.status === "completed"
          ? "completed"
          : action.status === "cancelled"
            ? "idle"
            : "failed";
      const statusLine =
        action.status === "completed"
          ? `完成 · ${((action.durationMs ?? 0) / 1000).toFixed(1)}s`
          : action.status === "cancelled"
            ? "已取消"
            : "工作流失败";
      return {
        ...state,
        mode,
        completedAt: Date.now(),
        statusLine,
      };
    }
    case "step/update":
      return {
        ...state,
        steps: state.steps.map((st) =>
          st.name === action.name ? { ...st, ...action.patch } : st,
        ),
      };
    case "orchestrator/event": {
      const ev = action.event;
      switch (ev.type) {
        case "log":
          return pushLog(state, ev.level, ev.message);
        case "step:start":
          return {
            ...state,
            steps: state.steps.map((st) =>
              st.name === ev.step
                ? { ...st, status: "running", attempts: ev.attempt }
                : st,
            ),
          };
        case "step:complete":
          return {
            ...state,
            steps: state.steps.map((st) =>
              st.name === ev.step
                ? {
                    ...st,
                    status: ev.status,
                    summary: ev.summary,
                    content: ev.content ?? st.content,
                    error: ev.error,
                    attempts: ev.attempt,
                  }
                : st,
            ),
          };
        case "step:stream":
          return {
            ...state,
            steps: state.steps.map((st) =>
              st.name === ev.step
                ? {
                    ...st,
                    content: (st.content ?? "") + ev.delta,
                    summary: ((st.content ?? "") + ev.delta)
                      .slice(0, 100)
                      .replace(/\n/g, " "),
                  }
                : st,
            ),
          };
        case "workflow:start":
          return pushLog(
            state,
            "info",
            `加载工作流: ${ev.workflowName}${ev.mock ? " [MOCK]" : ""}`,
          );
        case "workflow:complete":
          return pushLog(
            state,
            ev.status === "completed" ? "success" : "error",
            `工作流 ${ev.status}`,
          );
        case "workflow:cancelled":
          return pushLog(state, "warn", `工作流已取消: ${ev.workflowName}`);
        case "retry:round":
          return pushLog(state, "warn", `全局重试第 ${ev.round} 轮`);
        default:
          return state;
      }
    }
    case "history/push": {
      const cmd = action.command.trim();
      if (!cmd) return state;
      const history = [...state.commandHistory.filter((h) => h !== cmd), cmd].slice(-50);
      return { ...state, commandHistory: history, historyIndex: -1 };
    }
    case "history/prev": {
      if (state.commandHistory.length === 0) return state;
      const nextIndex =
        state.historyIndex < 0
          ? state.commandHistory.length - 1
          : Math.max(0, state.historyIndex - 1);
      const value = state.commandHistory[nextIndex] ?? state.input;
      const slash = slashFromInput(value);
      return {
        ...state,
        historyIndex: nextIndex,
        input: value,
        slashOpen: slash.open,
        slashQuery: slash.query,
        slashSelected: 0,
      };
    }
    case "history/next": {
      if (state.historyIndex < 0) return state;
      const nextIndex = state.historyIndex + 1;
      if (nextIndex >= state.commandHistory.length) {
        return {
          ...state,
          historyIndex: -1,
          input: "",
          slashOpen: false,
          slashQuery: "",
          slashSelected: 0,
        };
      }
      const value = state.commandHistory[nextIndex] ?? "";
      const slash = slashFromInput(value);
      return {
        ...state,
        historyIndex: nextIndex,
        input: value,
        slashOpen: slash.open,
        slashQuery: slash.query,
        slashSelected: 0,
      };
    }
    case "slash/open":
      return { ...state, slashOpen: true, slashQuery: action.query, slashSelected: 0 };
    case "slash/close":
      return { ...state, slashOpen: false, slashQuery: "", slashSelected: 0 };
    case "slash/select":
      return {
        ...state,
        slashSelected: Math.max(0, state.slashSelected + action.delta),
      };
    case "slash/set-selected":
      return { ...state, slashSelected: Math.max(0, action.index) };
    case "slash/accept": {
      // 带空格方便继续打参数
      const next = `/${action.name}${action.keepOpen ? " " : ""}`;
      const slash = slashFromInput(next);
      return {
        ...state,
        input: next,
        historyIndex: -1,
        slashOpen: action.keepOpen ? slash.open : false,
        slashQuery: action.keepOpen ? slash.query : "",
        slashSelected: 0,
      };
    }
    case "inspect/open":
      return {
        ...state,
        inspectStep: action.step,
        showHelp: false,
        statusLine: `查看: ${action.step}`,
      };
    case "inspect/close":
      return {
        ...state,
        inspectStep: null,
        statusLine:
          state.mode === "running" ? state.statusLine : "就绪 · 输入 /help",
      };
    case "quit":
      return state;
    default:
      return state;
  }
}

export function resetLogSeq(): void {
  logSeq = 0;
}

export { createInitialState };
