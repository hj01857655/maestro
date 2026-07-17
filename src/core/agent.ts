/**
 * Agent — 编排中的最小执行单元。
 *
 * Agent = 角色定义 + 模型 Provider + System Prompt。
 * Researcher + Grok：自动走 live search（search_parameters）。
 * 可选 Tool 循环：解析 ```tool 块 → 执行 → 回灌。
 */

import { BaseProvider } from "../providers/base";
import { GrokProvider } from "../providers/grok";
import type { AgentConfig, Message, ProviderResult } from "../types";
import {
  ToolRegistry,
  parseToolCalls,
  toolsPromptSection,
  type ToolContext,
} from "../tools";

export interface AgentRunOptions {
  /** 额外临时指令 */
  extraPrompt?: string;
  /** 启用 tools（默认 false；coder/tester 可开） */
  tools?: boolean;
  /** tool 最大轮次 */
  maxToolRounds?: number;
  /** tool 上下文 */
  toolContext?: Partial<ToolContext>;
  /** 优先流式（tools 开启时仅首轮/无 tool 时流式） */
  stream?: boolean;
  /** 流式 token 回调 */
  onStream?: (delta: string) => void;
  /** tool 执行回调（日志） */
  onTool?: (info: {
    name: string;
    args: Record<string, unknown>;
    result: string;
    ok: boolean;
  }) => void;
}

export class Agent {
  readonly config: AgentConfig;
  readonly provider: BaseProvider;
  readonly tools: ToolRegistry;

  constructor(
    config: AgentConfig,
    provider: BaseProvider,
    tools?: ToolRegistry,
  ) {
    this.config = config;
    this.provider = provider;
    this.tools = tools ?? new ToolRegistry(true);
  }

  get name(): string {
    return this.config.name;
  }

  get role(): string {
    return this.config.role;
  }

  /**
   * 运行 Agent：注入 system prompt → 调用 provider → 可选 tool 循环。
   */
  async run(
    messages: Message[],
    options?: AgentRunOptions | string,
  ): Promise<ProviderResult> {
    // 兼容旧签名 run(messages, extraPrompt?)
    const opts: AgentRunOptions =
      typeof options === "string" ? { extraPrompt: options } : (options ?? {});

    let systemPrompt =
      this.config.systemPrompt +
      (opts.extraPrompt ? `\n\n${opts.extraPrompt}` : "");

    const useTools = opts.tools ?? this.defaultToolsEnabled();
    if (useTools) {
      systemPrompt += "\n\n" + toolsPromptSection(this.tools.list());
    }

    const fullMessages: Message[] = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    const invokeOpts = {
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    };

    // Researcher + Grok → 真实 live search（不走 tool 循环）
    if (this.shouldUseSearch() && this.provider instanceof GrokProvider) {
      const userQuery = messages
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .join("\n");
      return this.provider.invokeWithSearch(fullMessages, userQuery, {
        ...invokeOpts,
        search: { mode: "on", returnCitations: true, maxSearchResults: 12 },
      });
    }

    if (useTools) {
      return this.runWithTools(fullMessages, invokeOpts, opts);
    }

    if (opts.stream) {
      return this.runStream(fullMessages, invokeOpts, opts.onStream);
    }

    return this.provider.invoke(fullMessages, invokeOpts);
  }

  /** 流式调用；仅在 provider 不支持流式时回落 invoke */
  private async runStream(
    messages: Message[],
    invokeOpts: { temperature?: number; maxTokens?: number },
    onStream?: (delta: string) => void,
  ): Promise<ProviderResult> {
    try {
      const stream = await this.provider.invokeStream(messages, invokeOpts);
      let content = "";
      for await (const delta of stream) {
        content += delta;
        onStream?.(delta);
      }
      return {
        content,
        model: this.provider.model,
        provider: this.provider.kind,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 仅「不支持流式」时回落；业务失败（含 mock fail）直接抛出，避免双计 attempts
      if (!/不支持流式/.test(msg)) throw err;

      const result = await this.provider.invoke(messages, invokeOpts);
      if (onStream && result.content) onStream(result.content);
      return result;
    }
  }

  private async runWithTools(
    messages: Message[],
    invokeOpts: { temperature?: number; maxTokens?: number },
    opts: AgentRunOptions,
  ): Promise<ProviderResult> {
    const maxRounds = opts.maxToolRounds ?? 4;
    const ctx: ToolContext = {
      cwd: opts.toolContext?.cwd ?? process.cwd(),
      workspaceRoot: opts.toolContext?.workspaceRoot ?? process.cwd(),
      commandTimeoutMs: opts.toolContext?.commandTimeoutMs,
    };

    const history = [...messages];
    let last: ProviderResult | undefined;

    for (let round = 0; round < maxRounds; round++) {
      last = await this.provider.invoke(history, invokeOpts);
      const calls = parseToolCalls(last.content);
      if (calls.length === 0) return last;

      // 把模型回复写入 history
      history.push({ role: "assistant", content: last.content });

      const resultBlocks: string[] = [];
      for (const call of calls) {
        const result = await this.tools.execute(call, ctx);
        opts.onTool?.({
          name: call.name,
          args: call.arguments,
          result: result.content.slice(0, 500),
          ok: result.ok,
        });
        resultBlocks.push(
          `### tool:${call.name}\n\`\`\`\n${result.content.slice(0, 16_000)}\n\`\`\``,
        );
      }

      history.push({
        role: "user",
        content:
          "工具执行结果如下。请基于结果继续，若已完成任务则给出最终回答（不要再调用工具，除非仍缺信息）。\n\n" +
          resultBlocks.join("\n\n"),
      });
    }

    // 超出轮次仍返回最后一次
    return (
      last ?? {
        content: "",
        model: this.provider.model,
        provider: this.provider.kind,
      }
    );
  }

  /** researcher 角色默认开搜索；可被 config 扩展覆盖 */
  private shouldUseSearch(): boolean {
    return this.config.role === "researcher" || this.config.name === "researcher";
  }

  /** enableTools 显式优先；否则 coder/tester 默认开 */
  private defaultToolsEnabled(): boolean {
    if (this.config.enableTools != null) return this.config.enableTools;
    const r = this.config.role;
    return r === "coder" || r === "tester";
  }
}
