/**
 * Mock Provider — 测试用，不调真实 API。
 *
 * 模拟不同模型的返回，用于验证 Orchestrator 的 DAG 调度逻辑。
 */

import { BaseProvider } from "../providers/base";
import type { Message, ProviderConfig, ProviderResult } from "../types";

export class MockProvider extends BaseProvider {
  private delayMs: number;
  private failOnMessages?: (msgs: Message[]) => boolean;

  constructor(
    config: Partial<ProviderConfig> = {},
    options?: {
      delayMs?: number;
      failOn?: (msgs: Message[]) => boolean;
    },
  ) {
    super("claude", {
      name: "mock",
      baseUrl: "",
      apiKey: "",
      model: "mock-model",
      ...config,
    });
    this.delayMs = options?.delayMs ?? 10;
    this.failOnMessages = options?.failOn;
  }

  async invoke(
    messages: Message[],
    _options?: { temperature?: number; maxTokens?: number },
  ): Promise<ProviderResult> {
    // 模拟网络延迟
    await new Promise((r) => setTimeout(r, this.delayMs));

    // 模拟失败
    if (this.failOnMessages?.(messages)) {
      throw new Error("Mock provider 模拟失败");
    }

    // 抽取 system prompt 和 用户消息做摘要
    const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
    const userMsg = messages.find((m) => m.role === "user")?.content ?? "";

    return {
      content: `[Mock ${this.config.model} 回复]
System: ${systemMsg.slice(0, 40)}...
User: ${userMsg.slice(0, 60)}...

---

这是 Mock 返回的模拟内容，用于测试 DAG 编排流程。`,
      model: this.config.model,
      provider: "mock",
      usage: { inputTokens: 100, outputTokens: 50 },
    };
  }

  async invokeStream(
    messages: Message[],
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<AsyncIterable<string>> {
    const result = await this.invoke(messages, options);
    const text = result.content;
    const chunkSize = 24;
    const pause = Math.min(this.delayMs, 5);
    return (async function* () {
      for (let i = 0; i < text.length; i += chunkSize) {
        await new Promise((r) => setTimeout(r, pause));
        yield text.slice(i, i + chunkSize);
      }
    })();
  }
}
