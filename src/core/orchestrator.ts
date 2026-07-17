/**
 * Orchestrator — Maestro 总管。
 *
 * 核心职责：
 * 1. 接收工作流定义
 * 2. 维护 Agent 注册表（角色 → 模型 Provider）
 * 3. 解析工作流 DAG，按依赖顺序调度执行（真并行）
 * 4. 管理上下文总线，在 Agent 间传递产物
 * 5. 处理重试、条件分支、错误恢复、取消
 * 6. 发出结构化事件（供 TUI / CLI 订阅）
 * 7. 可选产物落盘（ArtifactStore）
 */

import { Agent } from "./agent";
import { Context } from "./context";
import { Workflow, Step } from "./workflow";
import { ArtifactStore } from "./artifacts";
import { BaseProvider } from "../providers/base";
import type { OrchestratorEvent, OrchestratorListener } from "./events";
import type {
  AgentConfig,
  Message,
  ProviderKind,
  RunState,
} from "../types";

export interface OrchestratorOptions {
  /** 最大全局重试轮次 */
  maxGlobalRetries?: number;
  /** 覆盖 workflow.outputDir 的产物目录 */
  outputDir?: string;
  /** 日志回调（兼容旧接口） */
  onLog?: (msg: string) => void;
  /** Step 完成回调（兼容旧接口） */
  onStepComplete?: (step: Step, result: unknown) => void;
  /** Step 失败回调（兼容旧接口） */
  onStepFailed?: (step: Step, error: Error) => void;
  /** 结构化事件监听（推荐） */
  onEvent?: OrchestratorListener;
}

export class Orchestrator {
  private agents = new Map<string, Agent>();
  private providers = new Map<ProviderKind, BaseProvider>();
  context = new Context();
  private runState?: RunState;
  private listeners = new Set<OrchestratorListener>();
  private abortController?: AbortController;
  private artifacts?: ArtifactStore;
  options: OrchestratorOptions;

  constructor(options: OrchestratorOptions = {}) {
    this.options = {
      maxGlobalRetries: 1,
      ...options,
    };
    if (options.onEvent) {
      this.listeners.add(options.onEvent);
    }
  }

  on(listener: OrchestratorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: OrchestratorEvent): void {
    this.options.onEvent?.(event);
    for (const listener of this.listeners) {
      listener(event);
    }
    if (event.type === "log") {
      this.options.onLog?.(event.message);
    }
  }

  private log(
    level: "info" | "success" | "error" | "warn",
    message: string,
  ): void {
    this.emit({ type: "log", level, message });
  }

  setCallbacks(
    callbacks: Pick<
      OrchestratorOptions,
      "onLog" | "onStepComplete" | "onStepFailed" | "onEvent"
    >,
  ): void {
    Object.assign(this.options, callbacks);
    if (callbacks.onEvent) {
      this.listeners.add(callbacks.onEvent);
    }
  }

  cancel(): void {
    this.abortController?.abort();
  }

  get isCancelled(): boolean {
    return this.abortController?.signal.aborted ?? false;
  }

  /** 最近一次 run 的产物目录 */
  get artifactDir(): string | undefined {
    return this.artifacts?.runDir;
  }

  /* ========== Provider 注册 ========== */

  registerProvider(kind: ProviderKind, provider: BaseProvider): void {
    this.providers.set(kind, provider);
    this.log("info", `  📡 注册 Provider: ${kind} → ${provider.name}`);
  }

  getProvider(kind: ProviderKind): BaseProvider | undefined {
    return this.providers.get(kind);
  }

  /* ========== Agent 注册 ========== */

  registerAgent(config: AgentConfig): Agent {
    const provider = this.providers.get(config.provider);
    if (!provider) {
      throw new Error(
        `Agent "${config.name}" 引用了未注册的 Provider "${config.provider}"`,
      );
    }
    const agent = new Agent(config, provider);
    this.agents.set(config.name, agent);
    this.log(
      "info",
      `  🤖 注册 Agent: ${config.name} (${config.role} → ${config.provider})`,
    );
    return agent;
  }

  registerAgents(configs: AgentConfig[]): void {
    for (const config of configs) {
      this.registerAgent(config);
    }
  }

  getAgent(name: string): Agent | undefined {
    return this.agents.get(name);
  }

  /* ========== 工作流执行 ========== */

  async run(
    workflow: Workflow,
    initialInput?: Record<string, unknown>,
    opts?: { mock?: boolean; signal?: AbortSignal; outputDir?: string },
  ): Promise<RunState> {
    this.abortController = new AbortController();
    if (opts?.signal) {
      if (opts.signal.aborted) {
        this.abortController.abort();
      } else {
        opts.signal.addEventListener(
          "abort",
          () => this.abortController?.abort(),
          { once: true },
        );
      }
    }

    const wfName = workflow.name;
    this.log("info", `\n🎼 Maestro 开始执行工作流: ${wfName}`);
    this.log("info", `   └ 共 ${workflow.steps.size} 个步骤\n`);
    this.emit({
      type: "workflow:start",
      workflowName: wfName,
      stepCount: workflow.steps.size,
      mock: opts?.mock,
    });

    // 产物落盘
    const outputDir =
      opts?.outputDir ?? this.options.outputDir ?? workflow.outputDir;
    this.artifacts = outputDir
      ? new ArtifactStore({ outputDir, workflowName: wfName })
      : undefined;
    if (this.artifacts) {
      this.artifacts.ensureDir();
      this.log("info", `   📁 产物目录: ${this.artifacts.runDir}`);
    }

    this.runState = {
      workflowName: wfName,
      status: "running",
      startedAt: Date.now(),
      stepStates: new Map(),
      context: {},
    };
    this.context.load(initialInput ?? {});

    let cancelled = false;

    for (let round = 0; round <= (this.options.maxGlobalRetries ?? 1); round++) {
      if (this.isCancelled) {
        cancelled = true;
        break;
      }

      if (round > 0) {
        this.emit({ type: "retry:round", round });
        this.log("info", `\n🔄 全局重试第 ${round} 轮...`);
        // 仅重置 failed；success/skipped 保留
        // 必须清 attempts，否则 step 级 while (attempts < max) 直接跳过 → pending 死循环
        for (const step of workflow.steps.values()) {
          if (step.status === "failed") {
            step.status = "pending";
            step.error = undefined;
            step.attempts = 0;
            step.result = undefined;
          }
        }
      }

      let failedThisRound = false;
      let progress = true;

      while (progress) {
        progress = false;
        if (this.isCancelled) {
          cancelled = true;
          break;
        }

        const { runnable, toSkip } = workflow.getRunnableSteps(
          this.context.snapshot(),
        );

        // 先处理条件跳过
        for (const { step, reason } of toSkip) {
          this.markSkipped(step, reason);
          progress = true;
        }

        if (runnable.length === 0) {
          if (toSkip.length > 0) continue; // 跳过可能解锁下游
          break;
        }

        if (runnable.length > 1) {
          this.log(
            "info",
            `  ⚡ 并行执行 ${runnable.length} 步: ${runnable.map((s) => s.name).join(", ")}`,
          );
        }

        await Promise.all(
          runnable.map((step) => this.executeStep(step, workflow)),
        );
        progress = true;

        if (this.isCancelled) {
          cancelled = true;
          break;
        }

        const failed = runnable.filter((s) => s.status === "failed");
        if (failed.length > 0) {
          failedThisRound = true;
          for (const step of failed) {
            const canGlobalRetry =
              round < (this.options.maxGlobalRetries ?? 1);
            this.log(
              "error",
              `  ❌ ${step.name} 失败，${
                canGlobalRetry ? "等待全局重试" : "已耗尽重试次数"
              }`,
            );
            if (!canGlobalRetry) {
              this.skipDependents(step.name, workflow);
            }
          }
          if (round < (this.options.maxGlobalRetries ?? 1)) {
            break; // 进入下一轮全局重试
          }
        }
      }

      if (cancelled) break;

      // 死锁检测：仍有 pending 且无可跑
      const pending = Array.from(workflow.steps.values()).filter(
        (s) => s.status === "pending",
      );
      if (pending.length > 0 && !failedThisRound) {
        throw new Error(
          `工作流死锁！以下步骤无法执行（可能循环依赖）: ${pending.map((s) => s.name).join(", ")}`,
        );
      }

      const allSuccess = Array.from(workflow.steps.values()).every(
        (s) => s.status === "success" || s.status === "skipped",
      );
      if (allSuccess || !failedThisRound) break;
    }

    if (cancelled) {
      for (const step of workflow.steps.values()) {
        if (step.status === "running" || step.status === "pending") {
          step.status = "failed";
          step.error = "cancelled";
          this.persistStep(step);
        }
      }
      this.runState.status = "failed";
      this.runState.completedAt = Date.now();
      this.runState.error = "cancelled";
      this.runState.context = this.context.snapshot();
      for (const step of workflow.steps.values()) {
        this.runState.stepStates.set(step.name, step.toRunState());
      }
      this.artifacts?.writeContext(this.context.snapshot());
      this.artifacts?.finalize("cancelled");
      this.emit({ type: "workflow:cancelled", workflowName: wfName });
      this.log("warn", `\n⏹ Maestro 工作流已取消`);
      return this.runState;
    }

    const allSuccess = Array.from(workflow.steps.values()).every(
      (s) => s.status === "success" || s.status === "skipped",
    );
    this.runState.status = allSuccess ? "completed" : "failed";
    this.runState.completedAt = Date.now();
    this.runState.context = this.context.snapshot();

    for (const step of workflow.steps.values()) {
      this.runState.stepStates.set(step.name, step.toRunState());
    }

    this.artifacts?.writeContext(this.context.snapshot());
    const art = this.artifacts?.finalize(this.runState.status);
    if (art) {
      this.log("info", `   📁 产物已写入: ${art.dir}`);
    }

    const durationMs = this.runState.completedAt - this.runState.startedAt;
    const duration = (durationMs / 1000).toFixed(1);
    this.emit({
      type: "workflow:complete",
      workflowName: wfName,
      status: allSuccess ? "completed" : "failed",
      durationMs,
    });
    this.log(
      allSuccess ? "success" : "error",
      allSuccess
        ? `\n✅ Maestro 工作流完成 (${duration}s)`
        : `\n❌ Maestro 工作流失败 (${duration}s)`,
    );

    return this.runState;
  }

  private markSkipped(step: Step, reason: string): void {
    step.status = "skipped";
    step.error = reason;
    this.emit({
      type: "step:complete",
      step: step.name,
      status: "skipped",
      error: reason,
      attempt: step.attempts,
    });
    this.log("warn", `  ⏭ ${step.name} 跳过: ${reason}`);
    this.persistStep(step);
  }

  private persistStep(step: Step): void {
    this.artifacts?.writeStep({
      step: step.name,
      agent: step.config.agent,
      status: step.status,
      content: typeof step.result === "string" ? step.result : undefined,
      error: step.error,
      attempts: step.attempts,
    });
  }

  private async executeStep(step: Step, _workflow: Workflow): Promise<void> {
    if (this.isCancelled) {
      step.status = "failed";
      step.error = "cancelled";
      return;
    }

    const agent = this.agents.get(step.config.agent);
    if (!agent) {
      step.status = "failed";
      step.error = `未找到 Agent: ${step.config.agent}`;
      throw new Error(
        `Step "${step.name}" 引用了未注册的 Agent "${step.config.agent}"`,
      );
    }

    const maxAttempts = 1 + (step.config.maxRetries ?? 0);
    let lastError: string | undefined;

    while (step.attempts < maxAttempts) {
      if (this.isCancelled) {
        step.status = "failed";
        step.error = "cancelled";
        this.emit({
          type: "step:complete",
          step: step.name,
          status: "failed",
          error: "cancelled",
          attempt: step.attempts,
        });
        return;
      }

      const renderedPrompt = this.context.render(step.config.prompt);
      const inputMessages: Message[] = [
        { role: "user", content: renderedPrompt },
      ];

      step.status = "running";
      step.attempts++;
      this.emit({
        type: "step:start",
        step: step.name,
        agent: agent.config.name,
        attempt: step.attempts,
      });
      this.log(
        "info",
        `  🎯 ${step.name} (${agent.role} → ${agent.provider.model})${
          step.attempts > 1 ? ` · retry#${step.attempts}` : ""
        }`,
      );

      try {
        const result = await agent.run(inputMessages, {
          tools: agent.config.enableTools,
          onTool: (info) => {
            this.log(
              info.ok ? "info" : "warn",
              `  🔧 ${step.name} tool:${info.name} ${info.ok ? "ok" : "fail"} · ${info.result.slice(0, 60).replace(/\n/g, " ")}`,
            );
          },
        });

        if (this.isCancelled) {
          step.status = "failed";
          step.error = "cancelled";
          this.emit({
            type: "step:complete",
            step: step.name,
            status: "failed",
            error: "cancelled",
            attempt: step.attempts,
          });
          return;
        }

        step.status = "success";
        step.result = result.content;
        step.error = undefined;
        this.context.set(step.outputKey, result.content);
        const summary = result.content.slice(0, 100).replace(/\n/g, " ");
        this.log(
          "success",
          `  ✅ ${step.name} 成功 (${
            result.usage ? `${result.usage.outputTokens} tokens` : "完成"
          })`,
        );
        this.log("info", `     └ 摘要: ${summary.slice(0, 80)}...`);
        this.emit({
          type: "step:complete",
          step: step.name,
          status: "success",
          summary,
          content: result.content.slice(0, 50_000),
          attempt: step.attempts,
        });
        this.persistStep(step);
        this.options.onStepComplete?.(step, result);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        step.status = "failed";
        step.error = lastError;
        this.log("error", `  ❌ ${step.name} 失败: ${lastError}`);
        this.emit({
          type: "step:complete",
          step: step.name,
          status: "failed",
          error: lastError,
          attempt: step.attempts,
        });
        this.options.onStepFailed?.(
          step,
          error instanceof Error ? error : new Error(String(error)),
        );

        if (step.attempts < maxAttempts) {
          this.log(
            "warn",
            `  🔁 ${step.name} step 级重试 ${step.attempts}/${maxAttempts}`,
          );
          continue;
        }
      }
    }

    // 防御：若未进入 while（attempts 已耗尽）仍为 pending，强制 failed 避免调度死循环
    if (step.status === "pending" || step.status === "running") {
      step.status = "failed";
      step.error = lastError ?? "未执行或 attempts 已耗尽";
    }
    this.persistStep(step);
  }

  private resetDependents(stepName: string, workflow: Workflow): void {
    for (const step of workflow.steps.values()) {
      if (step.config.inputs?.includes(stepName) && step.status === "pending") {
        this.resetDependents(step.name, workflow);
      }
    }
  }

  private skipDependents(stepName: string, workflow: Workflow): void {
    for (const step of workflow.steps.values()) {
      if (
        step.config.inputs?.includes(stepName) &&
        (step.status === "pending" || step.status === "failed")
      ) {
        this.markSkipped(step, `上游 ${stepName} 失败，已跳过`);
        this.skipDependents(step.name, workflow);
      }
    }
  }
}
