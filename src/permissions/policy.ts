/**
 * 权限策略：按 mode + tool 风险决定 allow / deny / ask。
 */

import type {
  PermissionAskHandler,
  PermissionCheckResult,
  PermissionDecision,
  PermissionMode,
  PermissionPolicyOptions,
  PermissionRequest,
  ToolRisk,
} from "./types";

const MODE_ALIASES: Record<string, PermissionMode> = {
  plan: "plan",
  default: "default",
  "accept-edits": "accept-edits",
  acceptedits: "accept-edits",
  "accept_edits": "accept-edits",
  accept: "accept-edits",
  auto: "auto",
  bypass: "auto",
  "bypass-permissions": "auto",
  bypasspermissions: "auto",
  full: "auto",
};

/** 内置 tool → 风险 */
const TOOL_RISK: Record<string, ToolRisk> = {
  read_file: "read",
  list_dir: "read",
  write_file: "write",
  run_cmd: "exec",
};

export function parsePermissionMode(
  raw: string | undefined | null,
): PermissionMode | undefined {
  if (!raw) return undefined;
  const key = raw.trim().toLowerCase();
  return MODE_ALIASES[key];
}

export function normalizePermissionMode(
  raw: string | undefined | null,
  fallback: PermissionMode = "auto",
): PermissionMode {
  return parsePermissionMode(raw) ?? fallback;
}

export function toolRisk(
  toolName: string,
  unknownRisk: ToolRisk = "exec",
): ToolRisk {
  return TOOL_RISK[toolName] ?? unknownRisk;
}

/**
 * 纯函数：mode + risk → 决策（不含 ask 交互）。
 */
export function decidePermission(
  mode: PermissionMode,
  risk: ToolRisk,
): PermissionDecision {
  switch (mode) {
    case "plan":
      return risk === "read" ? "allow" : "deny";
    case "default":
      if (risk === "read") return "allow";
      return "ask";
    case "accept-edits":
      if (risk === "read" || risk === "write") return "allow";
      return "ask";
    case "auto":
      return "allow";
    default:
      return "deny";
  }
}

export function formatPermissionMode(mode: PermissionMode): string {
  switch (mode) {
    case "plan":
      return "plan (只读)";
    case "default":
      return "default (写/执行需确认)";
    case "accept-edits":
      return "accept-edits (自动写文件，执行需确认)";
    case "auto":
      return "auto (全部放行)";
  }
}

export const PERMISSION_MODE_HELP = [
  "plan          只读：read_file / list_dir",
  "default       读放行；write_file / run_cmd 需确认（无交互则拒绝）",
  "accept-edits  读+写放行；run_cmd 需确认",
  "auto          全部放行（编排/CI 默认）",
].join("\n");

export class PermissionPolicy {
  mode: PermissionMode;
  private ask?: PermissionAskHandler;
  private unknownRisk: ToolRisk;

  constructor(opts: PermissionPolicyOptions = {}) {
    this.mode = opts.mode ?? "auto";
    this.ask = opts.ask;
    this.unknownRisk = opts.unknownRisk ?? "exec";
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  setAsk(ask?: PermissionAskHandler): void {
    this.ask = ask;
  }

  riskOf(tool: string): ToolRisk {
    return toolRisk(tool, this.unknownRisk);
  }

  /**
   * 检查并可能触发 ask。
   * ask 返回 false / 无 handler → 拒绝。
   */
  async check(
    tool: string,
    args: Record<string, unknown>,
    meta: { step?: string; agent?: string } = {},
  ): Promise<PermissionCheckResult> {
    const risk = this.riskOf(tool);
    const decision = decidePermission(this.mode, risk);
    const req: PermissionRequest = {
      tool,
      args,
      risk,
      mode: this.mode,
      step: meta.step,
      agent: meta.agent,
    };

    if (decision === "allow") {
      return {
        decision,
        allowed: true,
        reason: `${this.mode}: ${risk} 自动放行`,
        risk,
        mode: this.mode,
      };
    }

    if (decision === "deny") {
      return {
        decision,
        allowed: false,
        reason: `${this.mode}: 拒绝 ${risk} 工具 ${tool}`,
        risk,
        mode: this.mode,
      };
    }

    // ask
    if (!this.ask) {
      return {
        decision: "ask",
        allowed: false,
        reason: `${this.mode}: ${tool} 需要确认，但当前无交互 handler（用 auto / accept-edits 或提供 ask）`,
        risk,
        mode: this.mode,
      };
    }

    let ok = false;
    try {
      ok = Boolean(await this.ask(req));
    } catch (err) {
      return {
        decision: "ask",
        allowed: false,
        reason: `权限确认失败: ${err instanceof Error ? err.message : err}`,
        risk,
        mode: this.mode,
      };
    }

    return {
      decision: "ask",
      allowed: ok,
      reason: ok
        ? `${this.mode}: 用户放行 ${tool}`
        : `${this.mode}: 用户拒绝 ${tool}`,
      risk,
      mode: this.mode,
    };
  }
}
