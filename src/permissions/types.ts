/**
 * 权限模式 — 对齐 Claude / Grok Build 的 tool 门闸语义。
 *
 * - plan: 只读（read_file / list_dir）
 * - default: 读自动放行；写/执行需确认（无 ask 回调则拒绝）
 * - accept-edits: 读+写自动放行；执行需确认
 * - auto: 全部放行（编排/CI 默认，兼容旧行为）
 *
 * 规则层（always / deny）叠加在 mode 之上：
 * - denied* 硬拒绝（含 auto）
 * - always* 跳过确认（plan 下写/执行仍拒绝）
 */

export type PermissionMode =
  | "plan"
  | "default"
  | "accept-edits"
  | "auto";

/** tool 风险等级 */
export type ToolRisk = "read" | "write" | "exec";

export type PermissionDecision = "allow" | "deny" | "ask";

/** 路径前缀 / 命令 / tool 级规则 */
export interface PermissionRules {
  /** 始终放行的 tool 名（plan 下写/执行仍拒绝） */
  alwaysAllowTools?: string[];
  /** 始终放行的路径前缀（相对 workspace，如 src/ · .maestro/） */
  alwaysAllowPaths?: string[];
  /** 始终放行的可执行文件名（run_cmd.command） */
  alwaysAllowCommands?: string[];
  /** 硬拒绝路径前缀（含 auto） */
  deniedPaths?: string[];
  /** 硬拒绝命令名（含 auto） */
  deniedCommands?: string[];
}

export interface PermissionRequest {
  tool: string;
  args: Record<string, unknown>;
  risk: ToolRisk;
  mode: PermissionMode;
  /** 可选：所属 step / agent */
  step?: string;
  agent?: string;
}

/**
 * ask 回调返回值：
 * - true / false：单次
 * - { allow, remember }：remember 写入会话 always 规则
 */
export type PermissionAskResult =
  | boolean
  | {
      allow: boolean;
      /** tool | path | command — 会话级 always */
      remember?: "tool" | "path" | "command";
    };

export type PermissionAskHandler = (
  req: PermissionRequest,
) => Promise<PermissionAskResult> | PermissionAskResult;

export interface PermissionPolicyOptions {
  mode?: PermissionMode;
  /** 当决策为 ask 时调用；返回 true 放行 */
  ask?: PermissionAskHandler;
  /** 未知 tool 的风险（默认 exec，更安全） */
  unknownRisk?: ToolRisk;
  /** 持久/配置规则 */
  rules?: PermissionRules;
}

export interface PermissionCheckResult {
  decision: PermissionDecision;
  /** 最终是否放行 */
  allowed: boolean;
  reason: string;
  risk: ToolRisk;
  mode: PermissionMode;
  /** 命中的规则标签 */
  matched?: string;
}
