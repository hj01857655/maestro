/**
 * Gemini Provider — Google Gemini API 适配器。
 *
 * 使用 Gemini 的 generateContent API。
 * 注意：Gemini 的 system prompt 通过 system_instruction 参数传递。
 */

import { BaseProvider } from "./base";
import type {
  Message,
  ProviderConfig,
  ProviderInvokeOptions,
  ProviderResult,
} from "../types";
import { resolveBaseUrl } from "./defaults";

interface GeminiContent {
  role?: string;
  parts: Array<{ text: string }>;
}

interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: {
    maxOutputTokens?: number;
    temperature?: number;
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: GeminiContent;
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
  };
}

export class GeminiProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super("gemini", {
      ...config,
      name: config.name || "Gemini",
      baseUrl: config.baseUrl?.trim()
        ? config.baseUrl.replace(/\/+$/, "")
        : resolveBaseUrl("gemini"),
      model: config.model || "gemini-2.5-pro",
    });
  }

  async invoke(
    messages: Message[],
    options?: ProviderInvokeOptions,
  ): Promise<ProviderResult> {
    const systemParts: string[] = [];
    const contents: GeminiContent[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemParts.push(msg.content);
      } else {
        contents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        });
      }
    }

    const body: GeminiRequest = {
      contents,
      generationConfig: {
        maxOutputTokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
        temperature: options?.temperature ?? this.config.temperature ?? 0.3,
      },
    };
    if (systemParts.length > 0) {
      body.systemInstruction = { parts: systemParts.map((text) => ({ text })) };
    }

    const base = this.config.baseUrl.replace(/\/+$/, "");
    // Gemini v1beta 路径
    const url = `${base}/v1beta/models/${this.config.model}:generateContent?key=${this.config.apiKey}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
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
      throw new Error(`Gemini API 错误 (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as GeminiResponse;
    const contentText =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") ?? "";

    return {
      content: contentText,
      model: this.config.model,
      provider: "gemini",
      usage: data.usageMetadata
        ? {
            inputTokens: data.usageMetadata.promptTokenCount,
            outputTokens: data.usageMetadata.candidatesTokenCount,
          }
        : undefined,
      raw: data,
    };
  }

  async invokeStream(
    messages: Message[],
    options?: ProviderInvokeOptions,
  ): Promise<AsyncIterable<string>> {
    const systemParts: string[] = [];
    const contents: GeminiContent[] = [];
    for (const msg of messages) {
      if (msg.role === "system") systemParts.push(msg.content);
      else {
        contents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        });
      }
    }

    const body: GeminiRequest = {
      contents,
      generationConfig: {
        maxOutputTokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
        temperature: options?.temperature ?? this.config.temperature ?? 0.3,
      },
    };
    if (systemParts.length > 0) {
      body.systemInstruction = { parts: systemParts.map((text) => ({ text })) };
    }

    const base = this.config.baseUrl.replace(/\/+$/, "");
    const url = `${base}/v1beta/models/${this.config.model}:streamGenerateContent?alt=sse&key=${this.config.apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.config.extraHeaders,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeout ?? 120_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "未知错误");
      throw new Error(`Gemini API 错误 (${response.status}): ${errorText}`);
    }
    if (!response.body) throw new Error("Gemini 无流式 body");

    return this.iterateGeminiSse(response.body);
  }

  private async *iterateGeminiSse(
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
            const json = JSON.parse(data) as GeminiResponse;
            const texts =
              json.candidates?.[0]?.content?.parts?.map((p) => p.text) ?? [];
            for (const t of texts) {
              if (t) yield t;
            }
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
