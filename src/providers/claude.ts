/**
 * Claude Provider — Anthropic Claude API 适配器。
 *
 * 使用 Messages API（/v1/messages），支持 Anthropic 格式的请求。
 * 可选对接本地 cc-switch 代理路由（127.0.0.1:15721）。
 */

import { BaseProvider } from "./base";
import type { Message, ProviderConfig, ProviderResult } from "../types";
import { resolveBaseUrl } from "./defaults";

interface AnthropicMessage {
  role: string;
  content: string;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  temperature?: number;
}

interface AnthropicResponse {
  id: string;
  model: string;
  type: string;
  role: string;
  content: Array<{ type: string; text: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class ClaudeProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super("claude", {
      ...config,
      name: config.name || "Claude",
      baseUrl: config.baseUrl?.trim()
        ? config.baseUrl.replace(/\/+$/, "")
        : resolveBaseUrl("claude"),
      model: config.model || "claude-sonnet-4-6",
    });
  }

  async invoke(
    messages: Message[],
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<ProviderResult> {
    const systemMessages: string[] = [];
    const chatMessages: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemMessages.push(msg.content);
      } else {
        chatMessages.push({ role: msg.role, content: msg.content });
      }
    }

    const body: AnthropicRequest = {
      model: this.config.model,
      max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
      messages: chatMessages,
      temperature: options?.temperature ?? this.config.temperature ?? 0.3,
    };
    if (systemMessages.length > 0) {
      body.system = systemMessages.join("\n");
    }

    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/v1/messages`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": this.config.apiKey,
      "anthropic-version": "2023-06-01",
      ...this.config.extraHeaders,
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeout ?? 120_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "未知错误");
      throw new Error(`Claude API 错误 (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as AnthropicResponse;
    const contentText = data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    return {
      content: contentText,
      model: data.model,
      provider: "claude",
      usage: data.usage
        ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }
        : undefined,
      raw: data,
    };
  }

  async invokeStream(
    messages: Message[],
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<AsyncIterable<string>> {
    const systemMessages: string[] = [];
    const chatMessages: AnthropicMessage[] = [];
    for (const msg of messages) {
      if (msg.role === "system") systemMessages.push(msg.content);
      else chatMessages.push({ role: msg.role, content: msg.content });
    }

    const body: AnthropicRequest & { stream: boolean } = {
      model: this.config.model,
      max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
      messages: chatMessages,
      temperature: options?.temperature ?? this.config.temperature ?? 0.3,
      stream: true,
    };
    if (systemMessages.length > 0) body.system = systemMessages.join("\n");

    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/v1/messages`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": this.config.apiKey,
      "anthropic-version": "2023-06-01",
      ...this.config.extraHeaders,
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeout ?? 120_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "未知错误");
      throw new Error(`Claude API 错误 (${response.status}): ${errorText}`);
    }
    if (!response.body) throw new Error("Claude 无流式 body");

    return this.iterateAnthropicStream(response.body);
  }

  private async *iterateAnthropicStream(
    body: ReadableStream<Uint8Array>,
  ): AsyncIterable<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const json = JSON.parse(data) as {
              type?: string;
              delta?: { type?: string; text?: string };
            };
            if (
              json.type === "content_block_delta" &&
              json.delta?.type === "text_delta" &&
              json.delta.text
            ) {
              yield json.delta.text;
            }
          } catch {
            // skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
