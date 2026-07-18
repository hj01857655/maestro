/**
 * 权限策略：mode + 规则（always/deny）+ 会话记忆 + ask。
 */

import * as path from "node:path";
import type {
  PermissionAskHandler,
  PermissionAskResult,
  PermissionCheckResult,
  PermissionDecision,
  PermissionMode,
  PermissionPolicyOptions,
  PermissionRequest,
  PermissionRules,
  ToolRisk,
} from "./types";

const MODE_ALIASES: Record<string, PermissionMode> = {
  plan: "plan",
  default: "default",
  "accept-edits": "accept-edits",
  acceptedits: "accept-edits",
  accept_edits: "accept-edits",
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
 * 纯函数：mode + risk → 决策（不含 ask / 规则）。
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
  "",
  "规则（叠加）:",
  "  always tools/paths/commands  跳过确认（plan 仍拒写/执行）",
  "  denied paths/commands        硬拒绝（含 auto）",
  "TUI: /allow always · /always tool|path|cmd … · /always list",
].join("\n");

/** 规范化路径规则：统一 /，去掉前导 ./ */
export function normalizePathRule(p: string): string {
  let s = p.trim().replace(/\\/g, "/");
  if (s.startsWith("./")) s = s.slice(2);
  return s;
}

/** 路径是否匹配前缀规则（大小写不敏感；支持尾 *） */
export function pathMatchesRule(target: string, rule: string): boolean {
  const t = normalizePathRule(target).toLowerCase();
  let r = normalizePathRule(rule).toLowerCase();
  if (!r) return false;
  if (r.endsWith("*")) {
    const prefix = r.slice(0, -1);
    return t.startsWith(prefix) || t === prefix.replace(/\/$/, "");
  }
  // 目录前缀：rule 以 / 结尾或 target 在其下
  if (r.endsWith("/")) {
    return t === r.slice(0, -1) || t.startsWith(r);
  }
  return t === r || t.startsWith(r + "/");
}

export function extractToolPath(args: Record<string, unknown>): string | undefined {
  const p = args.path;
  if (p == null || p === "") return undefined;
  return normalizePathRule(String(p));
}

export function extractToolCommand(
  args: Record<string, unknown>,
): string | undefined {
  const c = args.command;
  if (c == null || c === "") return undefined;
  // 取 basename，去掉 .exe
  let name = String(c).trim().replace(/\\/g, "/");
  const base = path.posix.basename(name);
  return base.replace(/\.exe$/i, "").toLowerCase();
}

function uniq(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of list) {
    const k = x.trim();
    if (!k) continue;
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
  }
  return out;
}

export function mergePermissionRules(
  ...parts: Array<PermissionRules | undefined>
): PermissionRules {
  const out: PermissionRules = {
    alwaysAllowTools: [],
    alwaysAllowPaths: [],
    alwaysAllowCommands: [],
    deniedPaths: [],
    deniedCommands: [],
  };
  for (const p of parts) {
    if (!p) continue;
    out.alwaysAllowTools = uniq([
      ...(out.alwaysAllowTools ?? []),
      ...(p.alwaysAllowTools ?? []),
    ]);
    out.alwaysAllowPaths = uniq([
      ...(out.alwaysAllowPaths ?? []),
      ...(p.alwaysAllowPaths ?? []).map(normalizePathRule),
    ]);
    out.alwaysAllowCommands = uniq([
      ...(out.alwaysAllowCommands ?? []),
      ...(p.alwaysAllowCommands ?? []).map((c) => c.toLowerCase()),
    ]);
    out.deniedPaths = uniq([
      ...(out.deniedPaths ?? []),
      ...(p.deniedPaths ?? []).map(normalizePathRule),
    ]);
    out.deniedCommands = uniq([
      ...(out.deniedCommands ?? []),
      ...(p.deniedCommands ?? []).map((c) => c.toLowerCase()),
    ]);
  }
  return out;
}

export function emptyPermissionRules(): PermissionRules {
  return {
    alwaysAllowTools: [],
    alwaysAllowPaths: [],
    alwaysAllowCommands: [],
    deniedPaths: [],
    deniedCommands: [],
  };
}

export function formatPermissionRules(rules: PermissionRules): string[] {
  const lines: string[] = [];
  const push = (label: string, arr?: string[]) => {
    if (arr && arr.length) lines.push(`  ${label}: ${arr.join(", ")}`);
    else lines.push(`  ${label}: (none)`);
  };
  push("always tools", rules.alwaysAllowTools);
  push("always paths", rules.alwaysAllowPaths);
  push("always cmds", rules.alwaysAllowCommands);
  push("denied paths", rules.deniedPaths);
  push("denied cmds", rules.deniedCommands);
  return lines;
}

function normalizeAskResult(raw: PermissionAskResult): {
  allow: boolean;
  remember?: "tool" | "path" | "command";
} {
  if (typeof raw === "boolean") return { allow: raw };
  return {
    allow: Boolean(raw.allow),
    remember: raw.remember,
  };
}

export class PermissionPolicy {
  mode: PermissionMode;
  private ask?: PermissionAskHandler;
  private unknownRisk: ToolRisk;
  /** 配置/持久规则 */
  private baseRules: PermissionRules;
  /** 会话内 always（可 /always clear） */
  private sessionRules: PermissionRules;

  constructor(opts: PermissionPolicyOptions = {}) {
    this.mode = opts.mode ?? "auto";
    this.ask = opts.ask;
    this.unknownRisk = opts.unknownRisk ?? "exec";
    this.baseRules = mergePermissionRules(opts.rules);
    this.sessionRules = emptyPermissionRules();
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  setAsk(ask?: PermissionAskHandler): void {
    this.ask = ask;
  }

  setBaseRules(rules?: PermissionRules): void {
    this.baseRules = mergePermissionRules(rules);
  }

  /** 合并配置 + 会话规则的只读视图 */
  effectiveRules(): PermissionRules {
    return mergePermissionRules(this.baseRules, this.sessionRules);
  }

  sessionAlwaysRules(): PermissionRules {
    return mergePermissionRules(this.sessionRules);
  }

  clearSessionRules(): void {
    this.sessionRules = emptyPermissionRules();
  }

  rememberTool(tool: string): void {
    const t = tool.trim();
    if (!t) return;
    this.sessionRules.alwaysAllowTools = uniq([
      ...(this.sessionRules.alwaysAllowTools ?? []),
      t,
    ]);
  }

  rememberPath(p: string): void {
    const n = normalizePathRule(p);
    if (!n) return;
    this.sessionRules.alwaysAllowPaths = uniq([
      ...(this.sessionRules.alwaysAllowPaths ?? []),
      n,
    ]);
  }

  rememberCommand(cmd: string): void {
    const c = cmd.trim().toLowerCase().replace(/\.exe$/i, "");
    if (!c) return;
    this.sessionRules.alwaysAllowCommands = uniq([
      ...(this.sessionRules.alwaysAllowCommands ?? []),
      c,
    ]);
  }

  /**
   * 根据请求推断并写入会话 always。
   * kind 缺省：exec→command，有 path→path，否则 tool
   */
  rememberFromRequest(
    req: Pick<PermissionRequest, "tool" | "args" | "risk">,
    kind?: "tool" | "path" | "command",
  ): string {
    const k =
      kind ??
      (req.risk === "exec"
        ? "command"
        : extractToolPath(req.args)
          ? "path"
          : "tool");
    if (k === "command") {
      const cmd = extractToolCommand(req.args) ?? req.tool;
      this.rememberCommand(cmd);
      return `cmd:${cmd}`;
    }
    if (k === "path") {
      const p = extractToolPath(req.args) ?? ".";
      this.rememberPath(p);
      return `path:${p}`;
    }
    this.rememberTool(req.tool);
    return `tool:${req.tool}`;
  }

  riskOf(tool: string): ToolRisk {
    return toolRisk(tool, this.unknownRisk);
  }

  /**
   * 检查并可能触发 ask。
   * 顺序：硬拒绝 → plan 风险拒绝 → always → mode → ask
   */
  async check(
    tool: string,
    args: Record<string, unknown>,
    meta: { step?: string; agent?: string } = {},
  ): Promise<PermissionCheckResult> {
    const risk = this.riskOf(tool);
    const rules = this.effectiveRules();
    const toolPath = extractToolPath(args);
    const toolCmd = extractToolCommand(args);
    const req: PermissionRequest = {
      tool,
      args,
      risk,
      mode: this.mode,
      step: meta.step,
      agent: meta.agent,
    };

    // 1) 硬拒绝（含 auto）
    if (toolPath && (rules.deniedPaths ?? []).some((r) => pathMatchesRule(toolPath, r))) {
      return {
        decision: "deny",
        allowed: false,
        reason: `denied path: ${toolPath}`,
        risk,
        mode: this.mode,
        matched: `deny-path:${toolPath}`,
      };
    }
    if (toolCmd && (rules.deniedCommands ?? []).some((c) => c === toolCmd)) {
      return {
        decision: "deny",
        allowed: false,
        reason: `denied command: ${toolCmd}`,
        risk,
        mode: this.mode,
        matched: `deny-cmd:${toolCmd}`,
      };
    }

    // 2) plan：写/执行硬拒（always 不能突破 plan）
    const modeDecision = decidePermission(this.mode, risk);
    if (modeDecision === "deny") {
      return {
        decision: "deny",
        allowed: false,
        reason: `${this.mode}: 拒绝 ${risk} 工具 ${tool}`,
        risk,
        mode: this.mode,
      };
    }

    // 3) always 规则
    if ((rules.alwaysAllowTools ?? []).some((t) => t.toLowerCase() === tool.toLowerCase())) {
      return {
        decision: "allow",
        allowed: true,
        reason: `always tool: ${tool}`,
        risk,
        mode: this.mode,
        matched: `always-tool:${tool}`,
      };
    }
    if (toolPath && (rules.alwaysAllowPaths ?? []).some((r) => pathMatchesRule(toolPath, r))) {
      return {
        decision: "allow",
        allowed: true,
        reason: `always path: ${toolPath}`,
        risk,
        mode: this.mode,
        matched: `always-path:${toolPath}`,
      };
    }
    if (toolCmd && (rules.alwaysAllowCommands ?? []).some((c) => c === toolCmd)) {
      return {
        decision: "allow",
        allowed: true,
        reason: `always command: ${toolCmd}`,
        risk,
        mode: this.mode,
        matched: `always-cmd:${toolCmd}`,
      };
    }

    // 4) mode allow
    if (modeDecision === "allow") {
      return {
        decision: "allow",
        allowed: true,
        reason: `${this.mode}: ${risk} 自动放行`,
        risk,
        mode: this.mode,
      };
    }

    // 5) ask
    if (!this.ask) {
      return {
        decision: "ask",
        allowed: false,
        reason: `${this.mode}: ${tool} 需要确认，但当前无交互 handler（/allow always 或配 always 规则 / 用 auto）`,
        risk,
        mode: this.mode,
      };
    }

    let askRaw: PermissionAskResult;
    try {
      askRaw = await this.ask(req);
    } catch (err) {
      return {
        decision: "ask",
        allowed: false,
        reason: `权限确认失败: ${err instanceof Error ? err.message : err}`,
        risk,
        mode: this.mode,
      };
    }

    const { allow, remember } = normalizeAskResult(askRaw);
    let matched: string | undefined;
    if (allow && remember) {
      matched = this.rememberFromRequest(req, remember);
    }

    return {
      decision: "ask",
      allowed: allow,
      reason: allow
        ? `${this.mode}: 用户放行 ${tool}${matched ? ` · remember ${matched}` : ""}`
        : `${this.mode}: 用户拒绝 ${tool}`,
      risk,
      mode: this.mode,
      matched,
    };
  }
}
