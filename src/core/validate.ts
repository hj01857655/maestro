/**
 * 工作流 YAML 校验 + 静态 DAG 分析。
 *
 * - zod schema 校验结构
 * - 静态环检测（Kahn）
 * - 未知 agent / 悬空 inputs / 重复 name
 */

import { z } from "zod";
import type { WorkflowConfig } from "../types";
import { BUILTIN_ROLES } from "../roles";

const ConditionSchema = z.object({
  sourceStep: z.string().min(1),
  status: z
    .enum(["pending", "running", "success", "failed", "skipped"])
    .optional(),
  when: z.string().optional(),
});

const StepSchema = z.object({
  name: z.string().min(1),
  agent: z.string().min(1),
  prompt: z.string().min(1),
  inputs: z.array(z.string()).optional(),
  conditions: z.array(ConditionSchema).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  outputKey: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});

export const WorkflowConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(StepSchema).min(1),
  maxGlobalRetries: z.number().int().min(0).max(10).optional(),
  onComplete: z.string().optional(),
  outputDir: z.string().optional(),
});

export interface ValidationIssue {
  level: "error" | "warn";
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  config?: WorkflowConfig;
  issues: ValidationIssue[];
}

export function validateWorkflowConfig(raw: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const parsed = WorkflowConfigSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        level: "error",
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      });
    }
    return { ok: false, issues };
  }

  const config = parsed.data as WorkflowConfig;
  const names = new Set<string>();

  for (let i = 0; i < config.steps.length; i++) {
    const step = config.steps[i];
    const base = `steps[${i}]`;

    if (names.has(step.name)) {
      issues.push({
        level: "error",
        path: `${base}.name`,
        message: `重复的 step 名: "${step.name}"`,
      });
    }
    names.add(step.name);

    if (!BUILTIN_ROLES[step.agent]) {
      issues.push({
        level: "warn",
        path: `${base}.agent`,
        message: `未知角色 "${step.agent}"（运行时需手动 registerAgent）`,
      });
    }

    for (const input of step.inputs ?? []) {
      if (!config.steps.some((s) => s.name === input)) {
        issues.push({
          level: "error",
          path: `${base}.inputs`,
          message: `依赖不存在的 step: "${input}"`,
        });
      }
    }

    for (const cond of step.conditions ?? []) {
      if (!config.steps.some((s) => s.name === cond.sourceStep)) {
        issues.push({
          level: "error",
          path: `${base}.conditions`,
          message: `条件引用不存在的 step: "${cond.sourceStep}"`,
        });
      }
    }
  }

  // 自依赖
  for (const step of config.steps) {
    if (step.inputs?.includes(step.name)) {
      issues.push({
        level: "error",
        path: `steps.${step.name}.inputs`,
        message: `step "${step.name}" 不能依赖自身`,
      });
    }
  }

  // 静态环检测
  const cycle = detectCycle(config);
  if (cycle) {
    issues.push({
      level: "error",
      path: "steps",
      message: `检测到循环依赖: ${cycle.join(" → ")}`,
    });
  }

  const hasError = issues.some((i) => i.level === "error");
  return {
    ok: !hasError,
    config: hasError ? undefined : config,
    issues,
  };
}

/** Kahn 拓扑；若有环返回环上节点路径 */
export function detectCycle(config: WorkflowConfig): string[] | null {
  const nodes = config.steps.map((s) => s.name);
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    indeg.set(n, 0);
    adj.set(n, []);
  }
  for (const step of config.steps) {
    for (const input of step.inputs ?? []) {
      if (!adj.has(input)) continue;
      adj.get(input)!.push(step.name);
      indeg.set(step.name, (indeg.get(step.name) ?? 0) + 1);
    }
  }

  const q = nodes.filter((n) => (indeg.get(n) ?? 0) === 0);
  const order: string[] = [];
  while (q.length > 0) {
    const n = q.shift()!;
    order.push(n);
    for (const m of adj.get(n) ?? []) {
      const d = (indeg.get(m) ?? 1) - 1;
      indeg.set(m, d);
      if (d === 0) q.push(m);
    }
  }

  if (order.length === nodes.length) return null;

  // 找环：从剩余节点 DFS
  const remaining = new Set(nodes.filter((n) => !order.includes(n)));
  const path: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  let found: string[] | null = null;

  function dfs(n: string): void {
    if (found) return;
    visiting.add(n);
    path.push(n);
    for (const m of adj.get(n) ?? []) {
      if (!remaining.has(m)) continue;
      if (visiting.has(m)) {
        const idx = path.indexOf(m);
        found = [...path.slice(idx), m];
        return;
      }
      if (!visited.has(m)) dfs(m);
    }
    visiting.delete(n);
    path.pop();
    visited.add(n);
  }

  for (const n of remaining) {
    if (!visited.has(n)) dfs(n);
    if (found) break;
  }
  return found ?? Array.from(remaining);
}
