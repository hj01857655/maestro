/**
 * ToolRegistry — 注册与执行 tools。
 */

import type { ResponsesToolDefinition } from "../types";
import type { Tool, ToolCall, ToolContext, ToolDefinition, ToolResult } from "./types";
import { BUILTIN_TOOLS } from "./builtin";

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  constructor(registerBuiltin = true) {
    if (registerBuiltin) {
      for (const t of BUILTIN_TOOLS) this.register(t);
    }
  }

  register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /** 转为 Provider 原生 function tools（Responses 扁平 / Chat 自动嵌套） */
  toProviderTools(): ResponsesToolDefinition[] {
    return this.list().map((d) => toolDefinitionToProvider(d));
  }

  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return {
        ok: false,
        content: `未知 tool: ${call.name}`,
        error: `未知 tool: ${call.name}`,
      };
    }
    // 校验 required
    for (const p of tool.definition.parameters) {
      if (p.required && (call.arguments[p.name] === undefined || call.arguments[p.name] === "")) {
        return {
          ok: false,
          content: `缺少参数: ${p.name}`,
          error: `缺少参数: ${p.name}`,
        };
      }
    }
    return tool.execute(call.arguments, ctx);
  }
}

/** ToolDefinition → 官方 function tool schema */
export function toolDefinitionToProvider(
  d: ToolDefinition,
): ResponsesToolDefinition {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of d.parameters) {
    properties[p.name] = {
      type: p.type,
      description: p.description,
    };
    if (p.required) required.push(p.name);
  }
  return {
    type: "function",
    name: d.name,
    description: d.description,
    parameters: {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    },
  };
}

/** 从模型输出中解析 tool 调用块 */
const TOOL_BLOCK_RE =
  /```tool\s*\n([\s\S]*?)```/gi;

/**
 * 支持格式：
 * ```tool
 * {"name":"read_file","arguments":{"path":"src/x.ts"}}
 * ```
 * 或多个 JSON 行。
 */
export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const m of text.matchAll(TOOL_BLOCK_RE)) {
    const body = m[1].trim();
    // 尝试整体 JSON 或 JSON 数组
    try {
      const parsed = JSON.parse(body) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const c = normalizeCall(item);
          if (c) calls.push(c);
        }
      } else {
        const c = normalizeCall(parsed);
        if (c) calls.push(c);
      }
      continue;
    } catch {
      // 多行各自 JSON
    }
    for (const line of body.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const c = normalizeCall(JSON.parse(t));
        if (c) calls.push(c);
      } catch {
        // skip
      }
    }
  }
  return calls;
}

function normalizeCall(raw: unknown): ToolCall | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = String(o.name ?? o.tool ?? "").trim();
  if (!name) return null;
  const args =
    o.arguments && typeof o.arguments === "object"
      ? (o.arguments as Record<string, unknown>)
      : o.args && typeof o.args === "object"
        ? (o.args as Record<string, unknown>)
        : {};
  return { name, arguments: args };
}

/** 解析官方 ProviderToolCall.arguments JSON */
export function parseNativeToolArguments(
  argumentsJson: string,
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsJson || "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { _raw: argumentsJson };
  }
}

/** 注入到 system prompt 的 tool 说明（markdown ```tool 回落路径） */
export function toolsPromptSection(defs: ToolDefinition[]): string {
  if (defs.length === 0) return "";
  const lines = [
    "你可以使用以下本地工具。需要时输出一个 markdown 代码块，语言标记为 tool，内容为 JSON：",
    "```tool",
    '{"name":"read_file","arguments":{"path":"相对路径"}}',
    "```",
    "",
    "可用工具：",
  ];
  for (const d of defs) {
    const params = d.parameters
      .map((p) => `${p.name}${p.required ? "*" : ""}: ${p.type} — ${p.description}`)
      .join("; ");
    lines.push(`- ${d.name}: ${d.description}`);
    if (params) lines.push(`  参数: ${params}`);
  }
  lines.push("", "工具结果会回传给你；拿到结果后再继续回答。不要编造工具输出。");
  return lines.join("\n");
}

/** 原生 function calling 提示（不再要求 ```tool 块） */
export function nativeToolsPromptSection(defs: ToolDefinition[]): string {
  if (defs.length === 0) return "";
  const lines = [
    "你可以使用官方 function calling 调用本地工具。",
    "需要读文件、写文件、列目录或执行命令时，请通过 tools 发起 function call，不要编造工具输出。",
    "可用工具：",
  ];
  for (const d of defs) {
    const params = d.parameters
      .map((p) => `${p.name}${p.required ? "*" : ""}: ${p.type}`)
      .join(", ");
    lines.push(`- ${d.name}: ${d.description}${params ? ` (${params})` : ""}`);
  }
  return lines.join("\n");
}
