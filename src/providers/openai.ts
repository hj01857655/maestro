/**
 * OpenAI Provider — OpenAI / Codex API 适配器。
 *
 * 兼容 OpenAI 协议的所有模型（GPT-4o、Codex、o1 等）。
 * 也兼容使用 OpenAI 协议的第三方网关。
 * Grok 等子类可覆盖 buildRequestBody / providerLabel。
 */

import { BaseProvider } from "./base";
import type { Message, ProviderConfig, ProviderResult } from "../types";
import { resolveBaseUrl } from "./defaults";

export interface OpenAIRequest {
  model: string;
  max_tokens?: number;
  temperature?: number;
  messages: Array<{ role: string; content: string }>;
  /** xAI live search 等扩展字段 */
  search_parameters?: Record<string, unknown>;
  tools?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

interface OpenAIResponse {
  id: string;
  model: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    num_sources_used?: number;
  };
  citations?: string[];
}

export class OpenAIProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super("openai", {
      ...config,
      baseUrl: config.baseUrl?.trim()
        ? config.baseUrl.replace(/\/+$/, "")
        : resolveBaseUrl("openai"),
      model: config.model || "gpt-5.6-sol",
      name: config.name || "OpenAI",
    });
  }

  /** 子类可覆盖，用于错误信息 / result.provider */
  protected get providerLabel(): string {
    return "openai";
  }

  /** 子类可扩展请求体（如 Grok search_parameters） */
  protected buildRequestBody(
    messages: Message[],
    options?: { temperature?: number; maxTokens?: number },
  ): OpenAIRequest {
    return {
      model: this.config.model,
      max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
      temperature: options?.temperature ?? this.config.temperature ?? 0.3,
      messages: messages.map((m) => ({
        role: m.role as string,
        content: m.content,
      })),
    };
  }

  async invoke(
    messages: Message[],
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<ProviderResult> {
    const body = this.buildRequestBody(messages, options);
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
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
      throw new Error(
        `${this.providerLabel} API 错误 (${response.status}): ${errorText}`,
      );
    }

    const data = (await response.json()) as OpenAIResponse;
    let content = data.choices[0]?.message?.content ?? "";

    // 若有 citations，附加来源列表（一手证据）
    if (data.citations && data.citations.length > 0) {
      content +=
        "\n\n## Sources\n" +
        data.citations.map((c, i) => `${i + 1}. ${c}`).join("\n");
    }

    return {
      content,
      model: data.model,
      provider: this.providerLabel,
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
          }
        : undefined,
      raw: data,
    };
  }

  /** SSE stream: data: {...}\n\n / data: [DONE] */
  async invokeStream(
    messages: Message[],
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<AsyncIterable<string>> {
    const body = {
      ...this.buildRequestBody(messages, options),
      stream: true,
    };
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
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
      throw new Error(
        `${this.providerLabel} API 错误 (${response.status}): ${errorText}`,
      );
    }
    if (!response.body) {
      throw new Error(`${this.providerLabel} 无流式 body`);
    }

    return this.iterateOpenAIStream(response.body);
  }

  protected async *iterateOpenAIStream(
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
          if (data === "[DONE]") return;
          try {
            const json = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {
            // skip partial
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
