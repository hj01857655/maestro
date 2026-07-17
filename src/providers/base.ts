/**
 * Provider 接口 — 所有模型适配器的抽象层。
 *
 * 定义统一的 invoke / invokeStream 接口，每个模型厂商各自实现。
 */

import type {
  Message,
  ProviderConfig,
  ProviderResult,
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
  abstract invoke(messages: Message[], options?: {
    temperature?: number;
    maxTokens?: number;
  }): Promise<ProviderResult>;

  /** 流式调用（可选实现） */
  async invokeStream(
    _messages: Message[],
    _options?: { temperature?: number; maxTokens?: number },
  ): Promise<AsyncIterable<string>> {
    throw new Error(`${this.kind} provider 不支持流式调用`);
  }
}
