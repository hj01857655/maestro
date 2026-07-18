/**
 * Tool 定义 — Agent 可调用的本地能力。
 */

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  /** 给模型看的文本 */
  content: string;
  /** 结构化数据（可选） */
  data?: unknown;
  error?: string;
}

export interface ToolContext {
  /** 工作区根目录（默认 process.cwd） */
  cwd: string;
  /** 允许写盘的根（默认 cwd） */
  workspaceRoot: string;
  /** 命令超时 ms */
  commandTimeoutMs?: number;
  /**
   * 权限门闸（可选）。
   * 未设置时保持旧行为：全部放行。
   */
  permissions?: {
    check: (
      tool: string,
      args: Record<string, unknown>,
      meta?: { step?: string; agent?: string },
    ) => Promise<{
      allowed: boolean;
      reason: string;
    }>;
  };
  /** 调用方元信息（step / agent） */
  meta?: { step?: string; agent?: string };
}

export interface Tool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
