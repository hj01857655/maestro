/**
 * 预置 slash 命令。
 */

import type { SlashCommand } from "./registry";
import { BUILTIN_ROLES } from "../../roles";
import { configPath, loadConfig, maskKey } from "../../config/store";
import { DEFAULT_BASE_URLS } from "../../providers";

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
      return {
        kind: "actions",
        actions: [
          { type: "logs/push", level: "info", message: "预置角色:" },
          ...lines.map(
            (message) =>
              ({ type: "logs/push", level: "info" as const, message }) as const,
          ),
          { type: "status/set", statusLine: "已列出角色" },
          { type: "help/hide" },
        ],
      };
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
        const envKey =
          k === "openai"
            ? process.env.OPENAI_API_KEY
            : process.env[`${k.toUpperCase()}_API_KEY`];
        const key = e?.apiKey || envKey;
        const url =
          e?.baseUrl ||
          process.env[`${k.toUpperCase()}_BASE_URL`] ||
          DEFAULT_BASE_URLS[k];
        const model =
          e?.model || process.env[`${k.toUpperCase()}_MODEL`] || "(默认)";
        return `  ${k}: key=${maskKey(key)} · ${url} · ${model}`;
      });
      return {
        kind: "actions",
        actions: [
          {
            type: "logs/push",
            level: "info",
            message: `配置文件: ${configPath()}`,
          },
          ...lines.map(
            (message) =>
              ({ type: "logs/push", level: "info" as const, message }) as const,
          ),
          { type: "status/set", statusLine: "providers" },
          { type: "help/hide" },
        ],
      };
    },
  },
  {
    name: "config",
    description: "显示配置路径与摘要",
    usage: "/config",
    allowWhileRunning: true,
    run: () => ({
      kind: "actions",
      actions: [
        {
          type: "logs/push",
          level: "info",
          message: `配置: ${configPath()}`,
        },
        {
          type: "logs/push",
          level: "info",
          message: "CLI: maestro config set <kind> apiKey=... model=...",
        },
        { type: "status/set", statusLine: "config" },
        { type: "help/hide" },
      ],
    }),
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
    description: "清空日志",
    usage: "/clear",
    allowWhileRunning: true,
    run: () => ({
      kind: "actions",
      actions: [
        { type: "logs/clear" },
        { type: "status/set", statusLine: "日志已清空" },
        { type: "help/hide" },
      ],
    }),
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
