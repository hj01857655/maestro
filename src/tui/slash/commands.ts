/**
 * 预置 slash 命令。
 */

import type { SlashCommand, SlashResult } from "./registry";
import type { TuiAction } from "../actions";
import type { StepUiState } from "../state";
import { BUILTIN_ROLES } from "../../roles";
import {
  configPath,
  loadConfig,
  maskKey,
  setProviderEntry,
} from "../../config/store";
import { DEFAULT_BASE_URLS } from "../../providers";
import {
  formatSessionLine,
  latestSessionForCwd,
  listSessions,
  loadSession,
  resolveSessionRef,
  sessionsDir,
  type SessionRecord,
} from "../../session";
import { formatVersionLine, resolveInstallInfo } from "../../cli/self";
import type { ProviderKind } from "../../types";
import {
  PERMISSION_MODE_HELP,
  formatPermissionMode,
  parsePermissionMode,
  type PermissionMode,
} from "../../permissions";
import { setPermissionMode as savePermissionMode } from "../../config/store";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function infoLines(lines: string[], status = ""): SlashResult {
  const actions: TuiAction[] = [
    ...lines.map(
      (message) =>
        ({ type: "logs/push", level: "info" as const, message }) as const,
    ),
    { type: "help/hide" },
  ];
  if (status) actions.push({ type: "status/set", statusLine: status });
  return { kind: "actions", actions };
}

function sessionToHydrateActions(s: SessionRecord): TuiAction[] {
  const steps: StepUiState[] = (s.steps ?? []).map((st) => ({
    name: st.name,
    agent: st.agent,
    status:
      (st.status as StepUiState["status"]) ||
      ("pending" as StepUiState["status"]),
    summary: st.summary,
    error: st.error,
    attempts: st.attempts ?? 0,
  }));
  return [
    {
      type: "session/hydrate",
      sessionId: s.id,
      sessionName: s.name,
      workflowName: s.workflowName,
      mock: s.mock,
      steps,
      logs: s.logs,
      commandHistory: s.commandHistory,
      statusLine: `已加载 ${s.id}${s.name ? ` "${s.name}"` : ""} · ${s.status}`,
    },
    {
      type: "logs/push",
      level: "success",
      message: `↩ 已切换到会话 ${s.id}${s.name ? ` "${s.name}"` : ""}`,
    },
    ...(s.lastRequest
      ? [
          {
            type: "logs/push" as const,
            level: "info" as const,
            message: `request: ${s.lastRequest.slice(0, 100)}`,
          },
        ]
      : []),
    ...(s.artifactDir
      ? [
          {
            type: "logs/push" as const,
            level: "info" as const,
            message: `artifacts: ${s.artifactDir}`,
          },
        ]
      : []),
    {
      type: "logs/push",
      level: "info",
      message: s.lastWorkflow
        ? "可用 /rerun 重跑上次工作流"
        : "此会话无 lastWorkflow · 用 /plan 或 /run 开始",
    },
  ];
}

export const builtinCommands: SlashCommand[] = [
  {
    name: "help",
    aliases: ["?"],
    description: "显示帮助",
    usage: "/help",
    allowWhileRunning: true,
    run: () => ({
      kind: "actions",
      actions: [
        { type: "help/show" },
        { type: "status/set", statusLine: "帮助" },
      ],
    }),
  },
  {
    name: "roles",
    description: "列出预置角色",
    usage: "/roles",
    allowWhileRunning: true,
    run: () => {
      const lines = Object.values(BUILTIN_ROLES).map(
        (r) => `  ${r.name} → ${r.provider} / ${r.model}`,
      );
      return infoLines(["预置角色:", ...lines], "已列出角色");
    },
  },
  {
    name: "providers",
    description: "查看 provider 配置状态",
    usage: "/providers",
    allowWhileRunning: true,
    run: () => {
      const cfg = loadConfig();
      const kinds = ["claude", "openai", "gemini", "grok"] as const;
      const lines = kinds.map((k) => {
        const e = cfg.providers[k];
        const envKey = process.env[`${k.toUpperCase()}_API_KEY`];
        const key = e?.apiKey || envKey;
        const url =
          e?.baseUrl ||
          process.env[`${k.toUpperCase()}_BASE_URL`] ||
          DEFAULT_BASE_URLS[k];
        const model =
          e?.model || process.env[`${k.toUpperCase()}_MODEL`] || "(默认)";
        const fmt =
          k === "openai" || k === "grok"
            ? e?.apiFormat ||
              process.env[`${k.toUpperCase()}_API_FORMAT`] ||
              "chat"
            : undefined;
        return fmt
          ? `  ${k}: key=${maskKey(key)} · ${url} · ${model} · ${fmt}`
          : `  ${k}: key=${maskKey(key)} · ${url} · ${model}`;
      });
      return infoLines(
        [`配置文件: ${configPath()}`, ...lines],
        "providers",
      );
    },
  },
  {
    name: "model",
    description: "查看/设置 provider 默认 model",
    usage: "/model [kind] [model]",
    allowWhileRunning: true,
    run: ({ args }) => {
      const kinds = ["claude", "openai", "gemini", "grok"] as const;
      const cfg = loadConfig();
      if (args.length === 0) {
        const lines = kinds.map((k) => {
          const m =
            cfg.providers[k]?.model ||
            process.env[`${k.toUpperCase()}_MODEL`] ||
            "(默认)";
          return `  ${k}: ${m}`;
        });
        return infoLines(
          ["当前 model（config/env）:", ...lines, "设置: /model openai gpt-x"],
          "model",
        );
      }
      const kind = args[0]!.toLowerCase() as ProviderKind;
      if (!kinds.includes(kind as (typeof kinds)[number])) {
        return {
          kind: "message",
          level: "error",
          message: `未知 kind: ${args[0]} · 可用: ${kinds.join(", ")}`,
        };
      }
      const model = args.slice(1).join(" ").trim();
      if (!model) {
        const cur =
          cfg.providers[kind]?.model ||
          process.env[`${kind.toUpperCase()}_MODEL`] ||
          "(默认)";
        return infoLines([`${kind} model: ${cur}`, `设置: /model ${kind} <model>`], "model");
      }
      setProviderEntry(kind, { model });
      return infoLines(
        [`✅ 已写入 ${kind}.model = ${model}`, `配置: ${configPath()}`],
        `model ${kind}`,
      );
    },
  },
  {
    name: "config",
    description: "显示配置路径与摘要",
    usage: "/config",
    allowWhileRunning: true,
    run: () =>
      infoLines(
        [
          `配置: ${configPath()}`,
          `会话: ${sessionsDir()}`,
          "CLI: maestro config set <kind> apiKey=... model=...",
        ],
        "config",
      ),
  },
  {
    name: "permissions",
    aliases: ["permission", "perm", "mode"],
    description: "查看/切换权限模式",
    usage: "/permissions [plan|default|accept-edits|auto] [--save]",
    allowWhileRunning: true,
    run: ({ state, args }) => {
      const save = args.includes("--save") || args.includes("-s");
      const raw = args.find((a) => !a.startsWith("-"));
      if (!raw) {
        return infoLines(
          [
            `当前: ${formatPermissionMode(state.permissionMode)}`,
            "",
            PERMISSION_MODE_HELP,
            "切换: /permissions plan|default|accept-edits|auto [--save]",
            "确认: /allow · /deny · y/n",
          ],
          "permissions",
        );
      }
      const mode = parsePermissionMode(raw);
      if (!mode) {
        return {
          kind: "message",
          level: "error",
          message: `未知模式: ${raw} · plan|default|accept-edits|auto`,
        };
      }
      if (save) {
        try {
          savePermissionMode(mode);
        } catch (err) {
          return {
            kind: "message",
            level: "error",
            message: `写入配置失败: ${err instanceof Error ? err.message : err}`,
          };
        }
      }
      const actions: TuiAction[] = [
        { type: "permission/set-mode", mode },
        {
          type: "logs/push",
          level: "info",
          message: `权限模式 → ${formatPermissionMode(mode)}${save ? " · 已写入配置" : " · 本次会话"}`,
        },
        { type: "help/hide" },
        { type: "status/set", statusLine: `perm ${mode}` },
      ];
      return { kind: "actions", actions };
    },
  },
  {
    name: "allow",
    aliases: ["yes", "y"],
    description: "允许当前待确认 tool",
    usage: "/allow",
    allowWhileRunning: true,
    run: ({ state }) => {
      if (!state.pendingPermission) {
        return {
          kind: "message",
          level: "warn",
          message: "当前无待确认权限",
        };
      }
      return {
        kind: "effect",
        effect: { type: "permission-answer", allow: true },
        actions: [{ type: "help/hide" }],
      };
    },
  },
  {
    name: "deny",
    aliases: ["no", "n"],
    description: "拒绝当前待确认 tool",
    usage: "/deny",
    allowWhileRunning: true,
    run: ({ state }) => {
      if (!state.pendingPermission) {
        return {
          kind: "message",
          level: "warn",
          message: "当前无待确认权限",
        };
      }
      return {
        kind: "effect",
        effect: { type: "permission-answer", allow: false },
        actions: [{ type: "help/hide" }],
      };
    },
  },
  {
    name: "version",
    aliases: ["v"],
    description: "显示版本",
    usage: "/version",
    allowWhileRunning: true,
    run: () => {
      const info = resolveInstallInfo();
      return infoLines(
        [
          formatVersionLine(info),
          `root: ${info.root}`,
          `mode: ${info.mode}`,
        ],
        "version",
      );
    },
  },
  {
    name: "doctor",
    description: "快速健康检查",
    usage: "/doctor",
    allowWhileRunning: true,
    run: () => {
      const info = resolveInstallInfo();
      const cfg = loadConfig();
      const kinds = ["claude", "openai", "gemini", "grok"] as const;
      const keys = kinds.map((k) => {
        const has =
          Boolean(cfg.providers[k]?.apiKey) ||
          Boolean(process.env[`${k.toUpperCase()}_API_KEY`]);
        return `  ${k}: ${has ? "key✓" : "key✗"}`;
      });
      const nm = path.join(info.root, "node_modules");
      const lines = [
        formatVersionLine(info),
        `bun/git: 见 CLI maestro doctor`,
        `node_modules: ${fs.existsSync(nm) ? "ok" : "missing"}`,
        `config: ${fs.existsSync(configPath()) ? "ok" : "missing"}`,
        `sessions: ${sessionsDir()}`,
        "providers:",
        ...keys,
        `tty: stdin=${Boolean(process.stdin.isTTY)}`,
        `cwd: ${process.cwd()}`,
      ];
      return infoLines(lines, "doctor");
    },
  },
  {
    name: "cost",
    aliases: ["usage", "tokens"],
    description: "本次运行 token 汇总（若 provider 返回 usage）",
    usage: "/cost",
    allowWhileRunning: true,
    run: ({ state }) => {
      const steps = state.steps;
      if (steps.length === 0) {
        return {
          kind: "message",
          level: "info",
          message: "尚无 step · 跑完 /plan 或 /run 后再看",
        };
      }
      // usage 存在 step content 旁的日志语义；当前 step 未单独存 usage
      // 给出可操作的摘要：成功/失败数 + 提示 CLI print json 含 usage
      const ok = steps.filter((s) => s.status === "success").length;
      const fail = steps.filter((s) => s.status === "failed").length;
      const lines = [
        `workflow: ${state.workflowName || "(none)"}`,
        `steps: ${steps.length} · success ${ok} · failed ${fail}`,
        `session: ${state.sessionId ?? "(none)"}`,
        "注: 逐步 usage 见 provider 响应；print 模式用 --output-format json",
        ...steps.map(
          (s) =>
            `  ${s.name}: ${s.status}${s.summary ? ` · ${s.summary.slice(0, 40).replace(/\n/g, " ")}` : ""}`,
        ),
      ];
      return infoLines(lines, "cost");
    },
  },
  {
    name: "plan",
    description: "从需求生成并运行流水线",
    usage: "/plan <需求> [--mock] [--test]",
    allowWhileRunning: false,
    run: ({ state, args }) => {
      if (state.mode === "running") {
        return {
          kind: "message",
          level: "warn",
          message: "已有工作流在运行 · 先 /stop",
        };
      }
      const isMock = args.includes("--mock");
      const withTest = args.includes("--test");
      const request = args.filter((a) => !a.startsWith("--")).join(" ").trim();
      if (!request) {
        return {
          kind: "message",
          level: "error",
          message: "用法: /plan <需求> [--mock] [--test]",
        };
      }
      return {
        kind: "effect",
        effect: {
          type: "plan-and-run",
          request,
          mock: isMock,
          test: withTest,
        },
        actions: [{ type: "help/hide" }],
      };
    },
  },
  {
    name: "run",
    description: "运行工作流",
    usage: "/run <workflow.yaml> [--mock]",
    allowWhileRunning: false,
    run: ({ state, args }) => {
      if (state.mode === "running") {
        return {
          kind: "message",
          level: "warn",
          message: "已有工作流在运行 · 先 /stop",
        };
      }
      const isMock = args.includes("--mock");
      const pathArg = args.find((a) => !a.startsWith("--"));
      if (!pathArg) {
        return {
          kind: "message",
          level: "error",
          message: "用法: /run <workflow.yaml> [--mock]",
        };
      }
      return {
        kind: "effect",
        effect: { type: "run-workflow", path: pathArg, mock: isMock },
        actions: [{ type: "help/hide" }],
      };
    },
  },
  {
    name: "rerun",
    aliases: ["retry"],
    description: "重跑当前会话上次工作流",
    usage: "/rerun [--mock]",
    allowWhileRunning: false,
    run: ({ state, args }) => {
      if (state.mode === "running") {
        return {
          kind: "message",
          level: "warn",
          message: "已有工作流在运行 · 先 /stop",
        };
      }
      return {
        kind: "effect",
        effect: { type: "rerun-last" },
        actions: [
          { type: "help/hide" },
          {
            type: "logs/push",
            level: "info",
            message: args.includes("--mock")
              ? "↩ rerun（将使用会话内 mock 标记）"
              : "↩ rerun 上次工作流…",
          },
        ],
      };
    },
  },
  {
    name: "stop",
    aliases: ["cancel"],
    description: "取消当前工作流",
    usage: "/stop",
    allowWhileRunning: true,
    run: ({ state }) => {
      if (state.mode !== "running") {
        return {
          kind: "message",
          level: "warn",
          message: "当前没有运行中的工作流",
        };
      }
      return {
        kind: "effect",
        effect: { type: "stop-workflow" },
        actions: [
          { type: "logs/push", level: "warn", message: "正在取消工作流…" },
          { type: "status/set", statusLine: "取消中…" },
        ],
      };
    },
  },
  {
    name: "clear",
    description: "清空日志（加 --all 重置工作流面板）",
    usage: "/clear [--all]",
    allowWhileRunning: true,
    run: ({ args }) => {
      if (args.includes("--all") || args.includes("-a")) {
        return {
          kind: "actions",
          actions: [
            { type: "logs/clear" },
            { type: "workflow/reset" },
            { type: "status/set", statusLine: "已清空日志与工作流" },
            { type: "help/hide" },
          ],
        };
      }
      return {
        kind: "actions",
        actions: [
          { type: "logs/clear" },
          { type: "status/set", statusLine: "日志已清空" },
          { type: "help/hide" },
        ],
      };
    },
  },
  {
    name: "session",
    description: "当前会话信息",
    usage: "/session",
    allowWhileRunning: true,
    run: ({ state }) => {
      const s = state.sessionId ? loadSession(state.sessionId) : null;
      const lines = [
        `session: ${state.sessionId ?? "(none)"}${state.sessionName ? ` "${state.sessionName}"` : ""}`,
        `status:  ${s?.status ?? state.mode}`,
        `workflow:${state.workflowName || s?.workflowName || "(none)"}`,
        `cwd:     ${process.cwd()}`,
        `store:   ${sessionsDir()}`,
        "相关: /sessions · /resume <id> · /rerun",
      ];
      return infoLines(lines, "session");
    },
  },
  {
    name: "sessions",
    description: "列出会话（默认当前目录）",
    usage: "/sessions [--all] [query]",
    allowWhileRunning: true,
    run: ({ args }) => {
      const all = args.includes("--all") || args.includes("-a");
      const query = args.filter((a) => !a.startsWith("-")).join(" ").trim();
      const cwd = process.cwd();
      const entries = listSessions({
        cwdOnly: !all && !query,
        cwd,
        limit: 15,
        query: query || undefined,
      });
      if (entries.length === 0) {
        return {
          kind: "message",
          level: "info",
          message: all
            ? "（无会话）"
            : "当前目录无会话 · /sessions --all",
        };
      }
      const lines = [
        all || query
          ? `会话 ${entries.length} · ${sessionsDir()}`
          : `当前目录会话 ${entries.length}`,
        ...entries.map((e) => `  ${formatSessionLine(e, cwd)}`),
        "恢复: /resume <id>",
      ];
      return infoLines(lines, "sessions");
    },
  },
  {
    name: "resume",
    aliases: ["load"],
    description: "加载历史会话到 TUI",
    usage: "/resume [id|query|latest]",
    allowWhileRunning: false,
    run: ({ state, args }) => {
      if (state.mode === "running") {
        return {
          kind: "message",
          level: "warn",
          message: "运行中不可切换会话 · 先 /stop",
        };
      }
      const ref = args.join(" ").trim();
      let s: SessionRecord | null = null;
      if (!ref || ref === "latest" || ref === ".") {
        s = latestSessionForCwd();
        if (!s) {
          return {
            kind: "message",
            level: "error",
            message: "当前目录无会话可 resume · /sessions --all",
          };
        }
      } else {
        s = resolveSessionRef(ref) ?? loadSession(ref);
        if (!s) {
          const hits = listSessions({ query: ref, limit: 8 });
          if (hits.length === 0) {
            return {
              kind: "message",
              level: "error",
              message: `未找到会话: ${ref}`,
            };
          }
          return infoLines(
            [
              `未精确匹配 "${ref}"，候选:`,
              ...hits.map((e) => `  ${formatSessionLine(e)}`),
              "用法: /resume <id>",
            ],
            "resume",
          );
        }
      }
      return {
        kind: "actions",
        actions: sessionToHydrateActions(s),
      };
    },
  },
  {
    name: "export",
    aliases: ["copy"],
    description: "导出当前会话摘要到文件或 stdout 提示",
    usage: "/export [path]",
    allowWhileRunning: true,
    run: ({ state, args }) => {
      if (!state.sessionId) {
        return {
          kind: "message",
          level: "error",
          message: "无当前会话",
        };
      }
      const s = loadSession(state.sessionId);
      const payload = {
        sessionId: state.sessionId,
        sessionName: state.sessionName,
        workflowName: state.workflowName,
        mock: state.mock,
        steps: state.steps.map((st) => ({
          name: st.name,
          agent: st.agent,
          status: st.status,
          summary: st.summary,
          error: st.error,
        })),
        lastRequest: s?.lastRequest,
        artifactDir: s?.artifactDir,
        exportedAt: new Date().toISOString(),
        cwd: process.cwd(),
      };
      const text = JSON.stringify(payload, null, 2);
      const outArg = args.find((a) => !a.startsWith("-"));
      const outPath = outArg
        ? path.resolve(outArg)
        : path.join(
            os.tmpdir(),
            `maestro-session-${state.sessionId}.json`,
          );
      try {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, text + "\n", "utf-8");
        return infoLines(
          [`✅ 已导出: ${outPath}`, `session ${state.sessionId}`],
          "export",
        );
      } catch (err) {
        return {
          kind: "message",
          level: "error",
          message: `导出失败: ${err instanceof Error ? err.message : err}`,
        };
      }
    },
  },
  {
    name: "show",
    description: "查看 step 完整输出",
    usage: "/show [step名]",
    allowWhileRunning: true,
    run: ({ state, args }) => {
      if (args[0] === "close" || args[0] === "-") {
        return {
          kind: "actions",
          actions: [
            { type: "inspect/close" },
            { type: "status/set", statusLine: "已关闭预览" },
          ],
        };
      }
      const name =
        args[0] ??
        [...state.steps].reverse().find((s) => s.status === "success")?.name;
      if (!name) {
        return {
          kind: "message",
          level: "error",
          message: "用法: /show <step名>  或  /show close",
        };
      }
      const step = state.steps.find((s) => s.name === name);
      if (!step) {
        const names = state.steps.map((s) => s.name).join(", ") || "(无)";
        return {
          kind: "message",
          level: "error",
          message: `未找到 step "${name}" · 可选: ${names}`,
        };
      }
      return {
        kind: "actions",
        actions: [
          { type: "inspect/open", step: name },
          { type: "help/hide" },
        ],
      };
    },
  },
  {
    name: "quit",
    aliases: ["exit", "q"],
    description: "退出",
    usage: "/quit",
    allowWhileRunning: true,
    run: () => ({
      kind: "effect",
      effect: { type: "exit" },
    }),
  },
];
