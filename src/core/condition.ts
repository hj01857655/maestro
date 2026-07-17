/**
 * 条件表达式求值。
 *
 * 支持精简语法（故意不做任意 JS eval）：
 *   status:success          — 上游 step 状态
 *   status:failed
 *   contains:关键词          — 上游输出字符串包含
 *   equals:精确值            — 上游输出全等
 *   exists                   — 上游有输出
 *   not:contains:xxx         — 取反
 *   true / false             — 字面量
 *
 * Condition.when 也可写完整表达式，sourceStep 指定求值上下文。
 */

import type { Condition, StepStatus } from "../types";

export interface ConditionEvalContext {
  /** 上游 step 输出（字符串或对象） */
  value: unknown;
  /** 上游 step 状态 */
  status?: StepStatus;
  /** 全量上下文快照（用于跨 step 引用） */
  context: Record<string, unknown>;
  /** 工作流内 step 状态表 */
  stepStatus?: Record<string, StepStatus>;
}

export function evaluateWhen(
  when: string | undefined,
  ctx: ConditionEvalContext,
): boolean {
  if (when == null || when.trim() === "") return true;
  const expr = when.trim();

  // 取反
  if (expr.startsWith("not:") || expr.startsWith("!")) {
    const inner = expr.startsWith("not:") ? expr.slice(4) : expr.slice(1);
    return !evaluateWhen(inner, ctx);
  }

  if (expr === "true" || expr === "always") return true;
  if (expr === "false" || expr === "never") return false;

  if (expr === "exists") {
    return ctx.value !== undefined && ctx.value !== null && ctx.value !== "";
  }

  if (expr.startsWith("status:")) {
    const expected = expr.slice("status:".length).trim() as StepStatus;
    return ctx.status === expected;
  }

  if (expr.startsWith("contains:")) {
    const needle = expr.slice("contains:".length);
    const hay = stringify(ctx.value);
    return hay.includes(needle);
  }

  if (expr.startsWith("equals:")) {
    const expected = expr.slice("equals:".length);
    return stringify(ctx.value) === expected;
  }

  if (expr.startsWith("matches:")) {
    const pattern = expr.slice("matches:".length);
    try {
      return new RegExp(pattern, "i").test(stringify(ctx.value));
    } catch {
      return false;
    }
  }

  // 未知表达式：fail-closed
  return false;
}

export function evaluateConditions(
  conditions: Condition[] | undefined,
  ctx: {
    context: Record<string, unknown>;
    stepStatus: Record<string, StepStatus>;
  },
): { ok: boolean; reason?: string } {
  if (!conditions || conditions.length === 0) return { ok: true };

  for (const cond of conditions) {
    const status = ctx.stepStatus[cond.sourceStep];
    const value = ctx.context[cond.sourceStep];

    // 状态约束
    if (cond.status) {
      if (status !== cond.status) {
        return {
          ok: false,
          reason: `条件未满足: ${cond.sourceStep} 状态=${status ?? "unknown"}，期望=${cond.status}`,
        };
      }
    } else if (status && status !== "success" && status !== "skipped") {
      // 默认要求上游至少不是 failed/running
      if (status === "failed" || status === "pending" || status === "running") {
        return {
          ok: false,
          reason: `条件未满足: ${cond.sourceStep} 尚未成功 (status=${status})`,
        };
      }
    }

    if (cond.when) {
      const passed = evaluateWhen(cond.when, {
        value,
        status,
        context: ctx.context,
        stepStatus: ctx.stepStatus,
      });
      if (!passed) {
        return {
          ok: false,
          reason: `条件未满足: ${cond.sourceStep} when="${cond.when}"`,
        };
      }
    }
  }

  return { ok: true };
}

function stringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
