/**
 * Provider 接口 — 所有模型适配器的抽象层。
 *
 * 定义统一的 invoke / invokeStream 接口，每个模型厂商各自实现。
 */

import type {
  Message,
  ProviderConfig,
  ProviderInvokeOptions,
  ProviderResult,
  ProviderStreamEvent,
  ProviderKind,
} from "../types";

export abstract class BaseProvider {
  readonly config: ProviderConfig;
  readonly kind: ProviderKind;

  constructor(kind: ProviderKind, config: ProviderConfig) {
    this.kind = kind;
    this.config = config;
  }

  get name(): string {
    return this.config.name;
  }

  get model(): string {
    return this.config.model;
  }

  /** 统一调用接口（完整响应） */
  abstract invoke(
    messages: Message[],
    options?: ProviderInvokeOptions,
  ): Promise<ProviderResult>;

  /** 流式调用（可选实现；仅文本 delta） */
  async invokeStream(
    _messages: Message[],
    _options?: ProviderInvokeOptions,
  ): Promise<AsyncIterable<string>> {
    throw new Error(`${this.kind} provider 不支持流式调用`);
  }

  /**
   * 结构化流式事件（可选）。
   * 默认把 invokeStream 文本包装为 {type:text}，结束时发 {type:done}。
   */
  async invokeStreamEvents(
    messages: Message[],
    options?: ProviderInvokeOptions,
  ): Promise<AsyncIterable<ProviderStreamEvent>> {
    const stream = await this.invokeStream(messages, options);
    return (async function* () {
      for await (const text of stream) {
        if (text) yield { type: "text" as const, text };
      }
      yield { type: "done" as const };
    })();
  }
}
