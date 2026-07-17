/**
 * Workflow — 工作流 DAG 定义。
 *
 * 负责解析、验证和存储工作流定义的 DAG。
 */

import type { WorkflowConfig, StepConfig, StepRunState, StepStatus } from "../types";
import { evaluateConditions } from "./condition";

export class Step {
  readonly config: StepConfig;
  status: StepStatus = "pending";
  attempts = 0;
  result?: unknown;
  error?: string;

  constructor(config: StepConfig) {
    this.config = config;
  }

  get name(): string {
    return this.config.name;
  }

  get outputKey(): string {
    return this.config.outputKey ?? this.config.name;
  }

  get maxRetries(): number {
    return this.config.maxRetries ?? 0;
  }

  /**
   * 依赖与条件是否满足。
   * - inputs: 上游结果必须已在 context（skipped 上游 → 本步 skip）
   * - conditions: when / status 表达式不满足 → skip
   */
  canRun(
    context: Record<string, unknown>,
    stepStatus: Record<string, StepStatus> = {},
  ): { ok: boolean; reason?: string; skip?: boolean } {
    if (this.config.inputs && this.config.inputs.length > 0) {
      for (const input of this.config.inputs) {
        const st = stepStatus[input];
        if (st === "failed") {
          return {
            ok: false,
            skip: true,
            reason: `上游 "${input}" 失败，跳过`,
          };
        }
        if (st === "skipped") {
          return {
            ok: false,
            skip: true,
            reason: `上游 "${input}" 已跳过`,
          };
        }
        if (!(input in context)) {
          return { ok: false, reason: `依赖的 step "${input}" 尚未完成` };
        }
      }
    }

    if (this.config.conditions && this.config.conditions.length > 0) {
      const cond = evaluateConditions(this.config.conditions, {
        context,
        stepStatus,
      });
      if (!cond.ok) {
        return { ok: false, skip: true, reason: cond.reason };
      }
    }

    return { ok: true };
  }

  toRunState(): StepRunState {
    return {
      name: this.name,
      status: this.status,
      attempts: this.attempts,
      result: this.result,
      error: this.error,
    };
  }
}

export class Workflow {
  readonly config: WorkflowConfig;
  readonly steps: Map<string, Step>;

  constructor(config: WorkflowConfig) {
    this.config = config;
    this.steps = new Map();
    for (const stepConfig of config.steps) {
      this.steps.set(stepConfig.name, new Step(stepConfig));
    }
  }

  get name(): string {
    return this.config.name;
  }

  /** 输出目录（产物落盘） */
  get outputDir(): string | undefined {
    return this.config.outputDir;
  }

  get entrySteps(): Step[] {
    return Array.from(this.steps.values()).filter(
      (s) => !s.config.inputs || s.config.inputs.length === 0,
    );
  }

  getDependents(stepName: string): Step[] {
    return Array.from(this.steps.values()).filter((s) =>
      s.config.inputs?.includes(stepName),
    );
  }

  get isComplete(): boolean {
    return Array.from(this.steps.values()).every(
      (s) =>
        s.status === "success" || s.status === "skipped" || s.status === "failed",
    );
  }

  /** step 状态表 */
  statusMap(): Record<string, StepStatus> {
    const m: Record<string, StepStatus> = {};
    for (const step of this.steps.values()) {
      m[step.name] = step.status;
    }
    return m;
  }

  getNextRunnable(context: Record<string, unknown>): Step | undefined {
    return this.getRunnableSteps(context).runnable[0];
  }

  /**
   * 当前可并行运行的 pending step，以及应立即跳过的 step。
   */
  getRunnableSteps(context: Record<string, unknown>): {
    runnable: Step[];
    toSkip: Array<{ step: Step; reason: string }>;
  } {
    const runnable: Step[] = [];
    const toSkip: Array<{ step: Step; reason: string }> = [];
    const stepStatus = this.statusMap();

    for (const step of this.steps.values()) {
      if (step.status !== "pending") continue;
      const check = step.canRun(context, stepStatus);
      if (check.ok) {
        runnable.push(step);
      } else if (check.skip) {
        // 仅当依赖的上游都已终态时才 skip，避免过早跳过
        const inputs = step.config.inputs ?? [];
        const condSources = (step.config.conditions ?? []).map((c) => c.sourceStep);
        const deps = [...new Set([...inputs, ...condSources])];
        const depsSettled = deps.every((d) => {
          const st = stepStatus[d];
          return st === "success" || st === "failed" || st === "skipped";
        });
        // 无 deps 但 when 不满足 → 也可 skip
        if (deps.length === 0 || depsSettled) {
          toSkip.push({ step, reason: check.reason ?? "条件未满足" });
        }
      }
    }

    return { runnable, toSkip };
  }

  static fromConfig(config: WorkflowConfig): Workflow {
    return new Workflow(config);
  }
}
