/**
 * 权限模式 — 对齐 Claude / Grok Build 的 tool 门闸语义。
 *
 * - plan: 只读（read_file / list_dir）
 * - default: 读自动放行；写/执行需确认（无 ask 回调则拒绝）
 * - accept-edits: 读+写自动放行；执行需确认
 * - auto: 全部放行（编排/CI 默认，兼容旧行为）
 */

export type PermissionMode =
  | "plan"
  | "default"
  | "accept-edits"
  | "auto";

/** tool 风险等级 */
export type ToolRisk = "read" | "write" | "exec";

export type PermissionDecision = "allow" | "deny" | "ask";

export interface PermissionRequest {
  tool: string;
  args: Record<string, unknown>;
  risk: ToolRisk;
  mode: PermissionMode;
  /** 可选：所属 step / agent */
  step?: string;
  agent?: string;
}

export type PermissionAskHandler = (
  req: PermissionRequest,
) => Promise<boolean> | boolean;

export interface PermissionPolicyOptions {
  mode?: PermissionMode;
  /** 当决策为 ask 时调用；返回 true 放行 */
  ask?: PermissionAskHandler;
  /** 未知 tool 的风险（默认 exec，更安全） */
  unknownRisk?: ToolRisk;
}

export interface PermissionCheckResult {
  decision: PermissionDecision;
  /** 最终是否放行 */
  allowed: boolean;
  reason: string;
  risk: ToolRisk;
  mode: PermissionMode;
}
