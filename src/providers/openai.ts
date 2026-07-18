/**
 * OpenAI Provider — OpenAI / Codex API 适配器。
 *
 * 兼容两种协议（字段按官方 Create 文档映射）：
 *   - chat（默认）: POST /v1/chat/completions
 *   - responses:    POST /v1/responses
 *
 * Chat Completions：
 *   model · messages · max_completion_tokens/max_tokens · temperature · top_p
 *   frequency_penalty · presence_penalty · stop · seed · n · stream · stream_options
 *   tools · tool_choice · parallel_tool_calls · response_format
 *   reasoning_effort · verbosity · modalities · audio · prediction
 *   logit_bias · logprobs · top_logprobs · metadata · service_tier
 *   safety_identifier · prompt_cache_key · prompt_cache_options
 *   web_search_options · store · user · extraBody
 *   multimodal parts: text · image_url · input_audio · file
 *   tool 回灌: role=tool + tool_call_id
 *   流式: delta.content · delta.tool_calls 聚合 · [DONE]
 *
 * Responses：
 *   model · input · instructions · max_output_tokens · temperature · top_p
 *   stream · store · previous_response_id · conversation · background
 *   include · max_tool_calls · tools · tool_choice · parallel_tool_calls
 *   text.format · text.verbosity · reasoning · prompt · truncation
 *   metadata · service_tier · safety_identifier · prompt_cache_key
 *   prompt_cache_options · stream_options · extraBody
 *   multimodal: input_text · input_image · input_file
 *   tool 闭环: function_call ↔ function_call_output
 *   流式: output_text.delta · function_call_arguments.delta · completed/failed
 *
 * Grok 等子类可覆盖 buildRequestBody / providerLabel。
 */

import { BaseProvider } from "./base";
import type {
  Message,
  MessageContentPart,
  OpenAIApiFormat,
  ProviderConfig,
  ProviderInvokeOptions,
  ProviderOutputItem,
  ProviderResult,
  ProviderStreamEvent,
  ProviderToolCall,
  ResponsesTextFormat,
  ResponsesToolDefinition,
} from "../types";
import { resolveBaseUrl } from "./defaults";

/** Chat Completions 请求体（官方 Create Chat Completion） */
export interface OpenAIRequest {
  model: string;
  messages: ChatMessage[];
  /** 官方推荐；reasoning 模型必须用这个 */
  max_completion_tokens?: number;
  /** 已弃用，仍广泛被中转支持 */
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  seed?: number;
  n?: number;
  stream?: boolean;
  stream_options?: { include_usage?: boolean; include_obfuscation?: boolean };
  tools?: ChatTool[];
  tool_choice?: unknown;
  parallel_tool_calls?: boolean;
  response_format?: unknown;
  reasoning_effort?: string;
  verbosity?: string;
  metadata?: Record<string, string>;
  service_tier?: string;
  safety_identifier?: string;
  prompt_cache_key?: string;
  web_search_options?: Record<string, unknown>;
  modalities?: string[];
  audio?: Record<string, unknown>;
  prediction?: unknown;
  logit_bias?: Record<string, number>;
  logprobs?: boolean;
  top_logprobs?: number;
  store?: boolean;
  user?: string;
  prompt_cache_options?: Record<string, unknown>;
  moderation?: Record<string, unknown>;
  context_management?: unknown;
  /** xAI live search 等扩展字段 */
  search_parameters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: string;
  content?: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
  refusal?: string | null;
  /** 多轮音频引用 */
  audio?: { id: string };
}

export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface ChatToolCall {
  id: string;
  type: "function" | string;
  function: { name: string; arguments: string };
  index?: number;
}

/** 官方 input item */
export type ResponsesInputItem =
  | {
      type?: "message";
      role: "user" | "assistant" | "system" | "developer";
      content: string | ResponsesContentPart[];
    }
  | {
      type: "function_call_output";
      call_id: string;
      output: string;
    }
  | {
      type: "function_call";
      call_id: string;
      name: string;
      arguments: string;
    }
  | Record<string, unknown>;

export type ResponsesContentPart =
  | { type: "input_text"; text: string }
  | {
      type: "input_image";
      image_url: string;
      detail?: "auto" | "low" | "high";
    }
  | { type: "input_file"; file_id?: string; file_url?: string; filename?: string }
  | { type: "output_text"; text: string }
  | { type: string; [k: string]: unknown };

/** OpenAI Responses API 请求体 */
export interface OpenAIResponsesRequest {
  model: string;
  input: string | ResponsesInputItem[];
  instructions?: string;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stream_options?: Record<string, unknown>;
  store?: boolean;
  previous_response_id?: string;
  conversation?: string | { id: string };
  background?: boolean;
  include?: string[];
  max_tool_calls?: number;
  tools?: ResponsesToolDefinition[];
  tool_choice?: unknown;
  parallel_tool_calls?: boolean;
  text?: { format: ResponsesTextFormat; verbosity?: string };
  reasoning?: Record<string, unknown>;
  metadata?: Record<string, string>;
  service_tier?: string;
  safety_identifier?: string;
  prompt_cache_key?: string;
  prompt_cache_options?: Record<string, unknown>;
  prompt?: { id: string; version?: string; variables?: Record<string, unknown> };
  truncation?: string;
  moderation?: Record<string, unknown>;
  context_management?: unknown;
  [key: string]: unknown;
}

interface OpenAIChatResponse {
  id: string;
  model: string;
  choices: Array<{
    index?: number;
    message: {
      role?: string;
      content?: string | null;
      refusal?: string | null;
      tool_calls?: ChatToolCall[];
      /** 已弃用 */
      function_call?: { name?: string; arguments?: string };
      audio?: {
        id?: string;
        data?: string;
        transcript?: string;
        expires_at?: number;
      };
      annotations?: unknown[];
    };
    finish_reason?: string | null;
    logprobs?: unknown;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    num_sources_used?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
      audio_tokens?: number;
      [k: string]: unknown;
    };
    completion_tokens_details?: {
      reasoning_tokens?: number;
      audio_tokens?: number;
      [k: string]: unknown;
    };
  };
  citations?: string[];
  moderation?: unknown;
  service_tier?: string;
  error?: { message?: string; type?: string };
}

export interface OpenAIResponsesResponse {
  id?: string;
  model?: string;
  status?: string;
  output_text?: string;
  output?: Array<Record<string, unknown> & {
    id?: string;
    type?: string;
    role?: string;
    status?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    content?: Array<{ type?: string; text?: string; annotations?: unknown[] }>;
    summary?: unknown;
    queries?: unknown;
    results?: unknown;
    code?: string;
    outputs?: unknown;
    action?: unknown;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens_details?: { cached_tokens?: number; [k: string]: unknown };
    output_tokens_details?: {
      reasoning_tokens?: number;
      [k: string]: unknown;
    };
  };
  moderation?: unknown;
  service_tier?: string;
  error?: { message?: string; type?: string; code?: string };
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
      apiFormat: config.apiFormat === "responses" ? "responses" : "chat",
    });
  }

  get apiFormat(): OpenAIApiFormat {
    return this.config.apiFormat === "responses" ? "responses" : "chat";
  }

  protected get providerLabel(): string {
    return "openai";
  }

  /**
   * Chat Completions 请求体（官方 Create Chat Completion）。
   * 子类可扩展（Grok search_parameters）。
   *
   * 映射：
   *   maxTokens        → max_completion_tokens（默认；legacy/both 可改）
   *   tools            → [{type:function,function:{name,...}}]（嵌套）
   *   textFormat       → response_format
   *   tool role+callId → role=tool + tool_call_id
   *   assistant.toolCalls → message.tool_calls
   *   parts            → content: [{type:text|image_url,...}]
   *   topP/stop/…      → 同名 snake_case 官方字段
   */
  protected buildRequestBody(
    messages: Message[],
    options?: ProviderInvokeOptions,
  ): OpenAIRequest {
    const maxTok = options?.maxTokens ?? this.config.maxTokens ?? 4096;
    const field = options?.chatMaxTokensField ?? "completion";
    const body: OpenAIRequest = {
      model: this.config.model,
      temperature: options?.temperature ?? this.config.temperature ?? 0.3,
      messages: messages.map((m) => toChatMessage(m)),
    };

    if (field === "legacy") {
      body.max_tokens = maxTok;
    } else if (field === "both") {
      body.max_completion_tokens = maxTok;
      body.max_tokens = maxTok;
    } else {
      body.max_completion_tokens = maxTok;
    }

    if (options?.topP != null) body.top_p = options.topP;
    if (options?.frequencyPenalty != null) {
      body.frequency_penalty = options.frequencyPenalty;
    }
    if (options?.presencePenalty != null) {
      body.presence_penalty = options.presencePenalty;
    }
    if (options?.stop != null) body.stop = options.stop;
    if (options?.seed != null) body.seed = options.seed;
    if (options?.n != null) body.n = options.n;
    if (options?.reasoningEffort != null) {
      body.reasoning_effort = options.reasoningEffort;
    }
    if (options?.verbosity != null) body.verbosity = options.verbosity;
    if (options?.metadata) body.metadata = options.metadata;
    if (options?.serviceTier != null) body.service_tier = options.serviceTier;
    if (options?.safetyIdentifier != null) {
      body.safety_identifier = options.safetyIdentifier;
    }
    if (options?.promptCacheKey != null) {
      body.prompt_cache_key = options.promptCacheKey;
    }
    if (options?.webSearchOptions) {
      body.web_search_options = options.webSearchOptions;
    }
    if (options?.modalities) body.modalities = options.modalities;
    if (options?.audio) body.audio = options.audio;
    if (options?.prediction != null) body.prediction = options.prediction;
    if (options?.logitBias) body.logit_bias = options.logitBias;
    if (options?.logprobs != null) body.logprobs = options.logprobs;
    if (options?.topLogprobs != null) body.top_logprobs = options.topLogprobs;
    if (options?.store != null) body.store = options.store;
    if (options?.user != null) body.user = options.user;
    if (options?.promptCacheOptions) {
      body.prompt_cache_options = options.promptCacheOptions;
    }
    if (options?.moderation) body.moderation = options.moderation;
    if (options?.contextManagement != null) {
      body.context_management = options.contextManagement;
    }

    if (options?.tools && options.tools.length > 0) {
      body.tools = toChatTools(options.tools);
    }
    if (options?.toolChoice != null) {
      body.tool_choice = options.toolChoice;
    }
    if (options?.parallelToolCalls != null) {
      body.parallel_tool_calls = options.parallelToolCalls;
    }
    if (options?.textFormat) {
      body.response_format = toChatResponseFormat(options.textFormat);
    }

    if (options?.extraBody) {
      Object.assign(body, options.extraBody);
    }
    return body;
  }

  /**
   * 官方 Responses 请求体。
   *
   * 映射：
   *   system            → instructions
   *   user/assistant    → input message items（可含 input_text/input_image）
   *   tool + callId     → function_call_output
   *   maxTokens         → max_output_tokens
   *   previousResponseId→ previous_response_id
   *   tools / textFormat→ tools / text.format
   *   store 默认 false（无状态）；续聊 previousResponseId 时默认 true 可被覆盖
   */
  protected buildResponsesBody(
    messages: Message[],
    options?: ProviderInvokeOptions & { stream?: boolean },
  ): OpenAIResponsesRequest {
    const systems: string[] = [];
    const input: ResponsesInputItem[] = [];

    for (const m of messages) {
      if (m.role === "system") {
        systems.push(m.content);
        continue;
      }

      // tool 回灌 → function_call_output
      if (m.role === "tool" || (m.callId && m.role !== "assistant") || m.toolOutput != null) {
        const callId = m.callId ?? m.name ?? "";
        if (!callId) {
          // 无 call_id 时退回 user 文本，避免请求非法
          input.push({
            type: "message",
            role: "user",
            content: m.toolOutput ?? m.content,
          });
          continue;
        }
        input.push({
          type: "function_call_output",
          call_id: callId,
          output: m.toolOutput ?? m.content,
        });
        continue;
      }

      // assistant 历史中的 tool_calls → function_call items + 可选 message
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        for (const tc of m.toolCalls) {
          input.push({
            type: "function_call",
            call_id: tc.callId,
            name: tc.name,
            arguments: tc.arguments,
          });
        }
        if (m.content) {
          input.push({
            type: "message",
            role: "assistant",
            content: m.content,
          });
        }
        continue;
      }

      const role: "user" | "assistant" =
        m.role === "assistant" ? "assistant" : "user";
      const parts = toResponsesContentParts(m);
      input.push({
        type: "message",
        role,
        content: parts.length === 1 && parts[0].type === "input_text"
          ? (parts[0] as { type: "input_text"; text: string }).text
          : parts,
      });
    }

    // 仅 system：input 用 string
    if (input.length === 0) {
      const fallback = systems.pop() ?? "";
      return finalizeResponsesBody(
        {
          model: this.config.model,
          input: fallback,
          max_output_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
          temperature: options?.temperature ?? this.config.temperature ?? 0.3,
        },
        systems,
        options,
      );
    }

    // 单轮纯文本 user → string input（官方 quickstart）
    const single =
      input.length === 1 &&
      "role" in input[0] &&
      (input[0] as { role?: string }).role === "user" &&
      typeof (input[0] as { content?: unknown }).content === "string";

    const bodyInput: string | ResponsesInputItem[] = single
      ? ((input[0] as { content: string }).content as string)
      : input;

    return finalizeResponsesBody(
      {
        model: this.config.model,
        input: bodyInput,
        max_output_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
        temperature: options?.temperature ?? this.config.temperature ?? 0.3,
      },
      systems,
      options,
    );
  }

  async invoke(
    messages: Message[],
    options?: ProviderInvokeOptions,
  ): Promise<ProviderResult> {
    if (this.apiFormat === "responses") {
      return this.invokeResponses(messages, options);
    }
    return this.invokeChat(messages, options);
  }

  private async invokeChat(
    messages: Message[],
    options?: ProviderInvokeOptions,
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

    const data = (await response.json()) as OpenAIChatResponse;
    if (data.error?.message) {
      throw new Error(
        `${this.providerLabel} API 错误: ${data.error.message}`,
      );
    }

    const choice = data.choices?.[0];
    const msg = choice?.message;
    let content = msg?.content ?? "";
    if (content == null) content = "";
    // refusal 作为文本可见（模型拒答）；同时保留独立 refusal 字段
    if (!content && msg?.refusal) content = msg.refusal;
    // audio transcript 可补 content
    if (!content && msg?.audio?.transcript) content = msg.audio.transcript;

    const toolCalls = extractChatToolCalls(data);

    if (data.citations && data.citations.length > 0) {
      content +=
        "\n\n## Sources\n" +
        data.citations.map((c, i) => `${i + 1}. ${c}`).join("\n");
    }

    const usageDetails = data.usage?.completion_tokens_details;
    const promptDetails = data.usage?.prompt_tokens_details;

    return {
      content,
      model: data.model ?? this.config.model,
      provider: this.providerLabel,
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens ?? 0,
            outputTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens,
            reasoningTokens: usageDetails?.reasoning_tokens,
            audioTokens:
              usageDetails?.audio_tokens ?? promptDetails?.audio_tokens,
            cachedTokens: promptDetails?.cached_tokens,
          }
        : undefined,
      raw: data,
      responseId: data.id,
      status: choice?.finish_reason ?? undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      audio: msg?.audio
        ? {
            id: msg.audio.id,
            data: msg.audio.data,
            transcript: msg.audio.transcript,
            expiresAt: msg.audio.expires_at,
          }
        : undefined,
      refusal: msg?.refusal ?? undefined,
      logprobs: choice?.logprobs,
      moderation: data.moderation,
      annotations: msg?.annotations,
      serviceTier: data.service_tier,
    };
  }

  private async invokeResponses(
    messages: Message[],
    options?: ProviderInvokeOptions,
  ): Promise<ProviderResult> {
    const body = this.buildResponsesBody(messages, options);
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/v1/responses`;
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
        `${this.providerLabel} Responses API 错误 (${response.status}): ${errorText}`,
      );
    }

    const data = (await response.json()) as OpenAIResponsesResponse;
    if (data.error?.message) {
      throw new Error(
        `${this.providerLabel} Responses API 错误: ${data.error.message}`,
      );
    }
    if (data.status === "failed" || data.status === "cancelled") {
      throw new Error(
        `${this.providerLabel} Responses API 状态=${data.status}` +
          (data.error?.message ? `: ${data.error.message}` : ""),
      );
    }

    const content = extractResponsesText(data);
    const toolCalls = extractResponsesToolCalls(data);
    const outputItems = extractResponsesOutputItems(data);
    const reasoningItems = outputItems.filter((i) => i.type === "reasoning");
    const annotations = extractResponsesAnnotations(data);
    const inputTokens =
      data.usage?.input_tokens ?? data.usage?.prompt_tokens ?? undefined;
    const outputTokens =
      data.usage?.output_tokens ?? data.usage?.completion_tokens ?? undefined;

    return {
      content,
      model: data.model ?? this.config.model,
      provider: this.providerLabel,
      usage:
        inputTokens != null || outputTokens != null
          ? {
              inputTokens: inputTokens ?? 0,
              outputTokens: outputTokens ?? 0,
              totalTokens: data.usage?.total_tokens,
              reasoningTokens:
                data.usage?.output_tokens_details?.reasoning_tokens,
              cachedTokens: data.usage?.input_tokens_details?.cached_tokens,
            }
          : undefined,
      raw: data,
      responseId: data.id,
      status: data.status,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      outputItems: outputItems.length > 0 ? outputItems : undefined,
      reasoning: reasoningItems.length > 0 ? reasoningItems : undefined,
      annotations: annotations.length > 0 ? annotations : undefined,
      moderation: data.moderation,
      serviceTier: data.service_tier,
    };
  }

  async invokeStream(
    messages: Message[],
    options?: ProviderInvokeOptions,
  ): Promise<AsyncIterable<string>> {
    if (this.apiFormat === "responses") {
      return this.invokeResponsesStream(messages, options);
    }
    return this.invokeChatStream(messages, options);
  }

  private async invokeChatStream(
    messages: Message[],
    options?: ProviderInvokeOptions,
  ): Promise<AsyncIterable<string>> {
    const body: OpenAIRequest = {
      ...this.buildRequestBody(messages, options),
      stream: true,
      stream_options: {
        include_usage: true,
        ...(options?.streamOptions ?? {}),
      },
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

  private async invokeResponsesStream(
    messages: Message[],
    options?: ProviderInvokeOptions,
  ): Promise<AsyncIterable<string>> {
    const body = this.buildResponsesBody(messages, {
      ...options,
      stream: true,
    });
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/v1/responses`;
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
        `${this.providerLabel} Responses API 错误 (${response.status}): ${errorText}`,
      );
    }
    if (!response.body) {
      throw new Error(`${this.providerLabel} 无流式 body`);
    }

    return this.iterateResponsesStream(response.body);
  }

  protected async *iterateOpenAIStream(
    body: ReadableStream<Uint8Array>,
  ): AsyncIterable<string> {
    for await (const ev of this.iterateOpenAIStreamEvents(body)) {
      if (ev.type === "text") yield ev.text;
      if (ev.type === "error") throw new Error(ev.message);
    }
  }

  /**
   * Chat Completions SSE 事件：
   *   choices[0].delta.content
   *   choices[0].delta.tool_calls[]（按 index 聚合）
   *   data: [DONE]
   */
  protected async *iterateOpenAIStreamEvents(
    body: ReadableStream<Uint8Array>,
  ): AsyncIterable<ProviderStreamEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const toolAcc = new Map<
      number,
      { callId?: string; name?: string; arguments: string }
    >();
    let responseId: string | undefined;
    let finishReason: string | undefined;
    let usage: { inputTokens: number; outputTokens: number } | undefined;

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
          if (data === "[DONE]") {
            const toolCalls = finalizeStreamToolCalls(toolAcc);
            yield {
              type: "done",
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
              responseId,
              status: finishReason,
              usage,
            };
            return;
          }
          try {
            const json = JSON.parse(data) as {
              id?: string;
              choices?: Array<{
                delta?: {
                  content?: string | null;
                  tool_calls?: Array<{
                    index?: number;
                    id?: string;
                    type?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
                finish_reason?: string | null;
              }>;
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
              };
              error?: { message?: string };
            };
            if (json.error?.message) {
              yield { type: "error", message: json.error.message };
              return;
            }
            if (json.id) responseId = json.id;
            if (json.usage) {
              usage = {
                inputTokens: json.usage.prompt_tokens ?? 0,
                outputTokens: json.usage.completion_tokens ?? 0,
              };
            }
            const choice = json.choices?.[0];
            if (choice?.finish_reason) finishReason = choice.finish_reason;
            const delta = choice?.delta;
            if (delta?.content) {
              yield { type: "text", text: delta.content };
            }
            if (Array.isArray(delta?.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                const cur = toolAcc.get(idx) ?? { arguments: "" };
                if (tc.id) cur.callId = tc.id;
                if (tc.function?.name) {
                  cur.name = (cur.name ?? "") + tc.function.name;
                }
                if (tc.function?.arguments) {
                  cur.arguments += tc.function.arguments;
                }
                toolAcc.set(idx, cur);
                yield {
                  type: "tool_call_delta",
                  index: idx,
                  callId: cur.callId,
                  name: cur.name,
                  argumentsDelta: tc.function?.arguments,
                };
              }
            }
          } catch {
            // skip partial
          }
        }
      }
      // 流结束但无 [DONE]
      const toolCalls = finalizeStreamToolCalls(toolAcc);
      yield {
        type: "done",
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        responseId,
        status: finishReason,
        usage,
      };
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 官方 Responses SSE：
   *   response.output_text.delta · function_call 增量 · completed · failed
   */
  protected async *iterateResponsesStream(
    body: ReadableStream<Uint8Array>,
  ): AsyncIterable<string> {
    for await (const ev of this.iterateResponsesStreamEvents(body)) {
      if (ev.type === "text") yield ev.text;
      if (ev.type === "error") {
        throw new Error(
          `${this.providerLabel} Responses 流式失败: ${ev.message}`,
        );
      }
    }
  }

  protected async *iterateResponsesStreamEvents(
    body: ReadableStream<Uint8Array>,
  ): AsyncIterable<ProviderStreamEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const toolAcc = new Map<
      number,
      { callId?: string; name?: string; arguments: string }
    >();
    let responseId: string | undefined;
    let status: string | undefined;
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    let toolIndex = 0;
    const callIdToIndex = new Map<string, number>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("event:")) continue;
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") {
            if (data === "[DONE]") {
              const toolCalls = finalizeStreamToolCalls(toolAcc);
              yield {
                type: "done",
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                responseId,
                status: status ?? "completed",
                usage,
              };
              return;
            }
            continue;
          }
          try {
            const json = JSON.parse(data) as {
              type?: string;
              delta?: string | { text?: string };
              text?: string;
              message?: string;
              item?: {
                type?: string;
                call_id?: string;
                name?: string;
                arguments?: string;
                id?: string;
              };
              response?: {
                id?: string;
                status?: string;
                usage?: {
                  input_tokens?: number;
                  output_tokens?: number;
                };
              };
              error?: { message?: string };
              name?: string;
              call_id?: string;
              arguments?: string;
              output_index?: number;
            };
            const t = json.type ?? "";

            if (json.response?.id) responseId = json.response.id;
            if (json.response?.status) status = json.response.status;
            if (json.response?.usage) {
              usage = {
                inputTokens: json.response.usage.input_tokens ?? 0,
                outputTokens: json.response.usage.output_tokens ?? 0,
              };
            }

            if (t === "response.output_text.delta") {
              const d = json.delta;
              if (typeof d === "string" && d) yield { type: "text", text: d };
              else if (
                d &&
                typeof d === "object" &&
                typeof d.text === "string" &&
                d.text
              ) {
                yield { type: "text", text: d.text };
              }
              continue;
            }

            if (t === "response.refusal.delta") {
              const d = json.delta;
              if (typeof d === "string" && d) yield { type: "text", text: d };
              continue;
            }

            // function_call item 出现
            if (
              t === "response.output_item.added" &&
              json.item?.type === "function_call"
            ) {
              const callId = json.item.call_id ?? json.item.id ?? "";
              const idx =
                json.output_index ??
                (callId
                  ? (callIdToIndex.get(callId) ?? toolIndex++)
                  : toolIndex++);
              if (callId) callIdToIndex.set(callId, idx);
              const cur = toolAcc.get(idx) ?? { arguments: "" };
              if (callId) cur.callId = callId;
              if (json.item.name) cur.name = json.item.name;
              if (json.item.arguments) cur.arguments = json.item.arguments;
              toolAcc.set(idx, cur);
              yield {
                type: "tool_call_delta",
                index: idx,
                callId: cur.callId,
                name: cur.name,
                argumentsDelta: json.item.arguments,
              };
              continue;
            }

            // arguments 增量
            if (t === "response.function_call_arguments.delta") {
              const callId = json.call_id ?? "";
              const idx =
                json.output_index ??
                (callId ? callIdToIndex.get(callId) : undefined) ??
                0;
              if (callId && !callIdToIndex.has(callId)) {
                callIdToIndex.set(callId, idx);
              }
              const cur = toolAcc.get(idx) ?? { arguments: "" };
              if (callId) cur.callId = callId;
              if (json.name) cur.name = json.name;
              const argDelta =
                typeof json.delta === "string"
                  ? json.delta
                  : typeof json.arguments === "string"
                    ? json.arguments
                    : "";
              if (argDelta) cur.arguments += argDelta;
              toolAcc.set(idx, cur);
              yield {
                type: "tool_call_delta",
                index: idx,
                callId: cur.callId,
                name: cur.name,
                argumentsDelta: argDelta || undefined,
              };
              continue;
            }

            if (t === "response.function_call_arguments.done") {
              const callId = json.call_id ?? "";
              const idx =
                json.output_index ??
                (callId ? callIdToIndex.get(callId) : undefined) ??
                0;
              const cur = toolAcc.get(idx) ?? { arguments: "" };
              if (callId) cur.callId = callId;
              if (json.name) cur.name = json.name;
              if (typeof json.arguments === "string") {
                cur.arguments = json.arguments;
              }
              toolAcc.set(idx, cur);
              continue;
            }

            if (t === "response.completed") {
              const toolCalls = finalizeStreamToolCalls(toolAcc);
              yield {
                type: "done",
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                responseId,
                status: status ?? "completed",
                usage,
              };
              return;
            }

            if (t === "response.failed" || t === "error") {
              const msg =
                json.error?.message ||
                json.message ||
                (typeof json.delta === "string" ? json.delta : "") ||
                t;
              yield { type: "error", message: msg };
              return;
            }
          } catch (err) {
            // skip partial JSON
            void err;
          }
        }
      }
      const toolCalls = finalizeStreamToolCalls(toolAcc);
      yield {
        type: "done",
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        responseId,
        status: status ?? "completed",
        usage,
      };
    } finally {
      reader.releaseLock();
    }
  }

  /** 结构化流式事件（含 tool_call 聚合） */
  override async invokeStreamEvents(
    messages: Message[],
    options?: ProviderInvokeOptions,
  ): Promise<AsyncIterable<ProviderStreamEvent>> {
    if (this.apiFormat === "responses") {
      const body = this.buildResponsesBody(messages, {
        ...options,
        stream: true,
      });
      const url = `${this.config.baseUrl.replace(/\/+$/, "")}/v1/responses`;
      const response = await this.postStream(url, body);
      return this.iterateResponsesStreamEvents(response.body!);
    }
    const body: OpenAIRequest = {
      ...this.buildRequestBody(messages, options),
      stream: true,
      stream_options: {
        include_usage: true,
        ...(options?.streamOptions ?? {}),
      },
    };
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
    const response = await this.postStream(url, body);
    return this.iterateOpenAIStreamEvents(response.body!);
  }

  private async postStream(
    url: string,
    body: unknown,
  ): Promise<Response> {
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
    return response;
  }
}

function finalizeStreamToolCalls(
  toolAcc: Map<number, { callId?: string; name?: string; arguments: string }>,
): ProviderToolCall[] {
  return Array.from(toolAcc.entries())
    .sort(([a], [b]) => a - b)
    .filter(([, v]) => Boolean(v.name))
    .map(([index, v]) => ({
      callId: v.callId || `call_${index}`,
      name: v.name!,
      arguments: v.arguments || "{}",
      type: "function",
      index,
    }));
}

function finalizeResponsesBody(
  base: Pick<
    OpenAIResponsesRequest,
    "model" | "input" | "max_output_tokens" | "temperature"
  >,
  systems: string[],
  options?: ProviderInvokeOptions & { stream?: boolean },
): OpenAIResponsesRequest {
  const hasPrev = Boolean(options?.previousResponseId);
  const store =
    options?.store != null ? options.store : hasPrev ? true : false;

  const body: OpenAIResponsesRequest = {
    ...base,
    store,
  };
  if (systems.length > 0) body.instructions = systems.join("\n");
  if (options?.stream) body.stream = true;
  if (options?.previousResponseId) {
    body.previous_response_id = options.previousResponseId;
  }
  if (options?.conversation != null) {
    body.conversation = options.conversation;
  }
  if (options?.background != null) body.background = options.background;
  if (options?.include && options.include.length > 0) {
    body.include = options.include;
  }
  if (options?.maxToolCalls != null) {
    body.max_tool_calls = options.maxToolCalls;
  }
  if (options?.topP != null) body.top_p = options.topP;
  if (options?.tools && options.tools.length > 0) {
    body.tools = options.tools;
  }
  if (options?.toolChoice != null) {
    body.tool_choice = options.toolChoice;
  }
  if (options?.parallelToolCalls != null) {
    body.parallel_tool_calls = options.parallelToolCalls;
  }
  if (options?.textFormat || options?.verbosity) {
    body.text = {
      format: options?.textFormat ?? { type: "text" },
      ...(options?.verbosity ? { verbosity: options.verbosity } : {}),
    };
  }
  if (options?.reasoning || options?.reasoningEffort) {
    body.reasoning = {
      ...(options?.reasoningEffort
        ? { effort: options.reasoningEffort }
        : {}),
      ...(options?.reasoning ?? {}),
    };
  }
  if (options?.metadata) body.metadata = options.metadata;
  if (options?.serviceTier != null) body.service_tier = options.serviceTier;
  if (options?.safetyIdentifier != null) {
    body.safety_identifier = options.safetyIdentifier;
  }
  if (options?.promptCacheKey != null) {
    body.prompt_cache_key = options.promptCacheKey;
  }
  if (options?.promptCacheOptions) {
    body.prompt_cache_options = options.promptCacheOptions;
  }
  if (options?.prompt) body.prompt = options.prompt;
  if (options?.truncation != null) body.truncation = options.truncation;
  if (options?.moderation) body.moderation = options.moderation;
  if (options?.contextManagement != null) {
    body.context_management = options.contextManagement;
  }
  if (options?.stream && options?.streamOptions) {
    body.stream_options = options.streamOptions;
  }
  if (options?.extraBody) {
    Object.assign(body, options.extraBody);
  }
  return body;
}

/** Maestro Message → 官方 chat message */
function toChatMessage(m: Message): ChatMessage {
  // tool 回灌：role=tool + tool_call_id
  if (m.role === "tool" || (m.callId && m.role !== "assistant")) {
    return {
      role: "tool",
      content: m.toolOutput ?? m.content,
      tool_call_id: m.callId ?? m.name ?? "",
    };
  }

  const msg: ChatMessage = {
    role: m.role,
    content: chatContentFromMessage(m),
  };
  if (m.name) msg.name = m.name;

  // assistant 历史回放 tool_calls
  if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
    msg.tool_calls = m.toolCalls.map((t, i) => ({
      id: t.callId,
      type: t.type ?? "function",
      function: {
        name: t.name,
        arguments: t.arguments,
      },
      index: t.index ?? i,
    }));
    // 官方允许 content 为 null；有 tool_calls 时空串改 null 更标准
    if (msg.content === "") msg.content = null;
  }
  // 多轮音频：引用先前 audio.id
  if (m.role === "assistant" && m.audioId) {
    msg.audio = { id: m.audioId };
  }
  return msg;
}

/** Message → chat content（string 或官方 content parts） */
function chatContentFromMessage(m: Message): unknown {
  if (!m.parts || m.parts.length === 0) return m.content;
  return m.parts.map((p) => {
    if (p.type === "text" || p.type === "input_text") {
      return { type: "text", text: (p as { text: string }).text };
    }
    if (p.type === "image_url" || p.type === "input_image") {
      const img = p as {
        image_url: string | { url: string; detail?: string };
      };
      const url =
        typeof img.image_url === "string" ? img.image_url : img.image_url.url;
      const detail =
        typeof img.image_url === "string" ? undefined : img.image_url.detail;
      return {
        type: "image_url",
        image_url: detail ? { url, detail } : { url },
      };
    }
    if (p.type === "input_audio") {
      const a = p as {
        input_audio: { data: string; format: string };
      };
      return { type: "input_audio", input_audio: a.input_audio };
    }
    if (p.type === "input_file" || p.type === "file") {
      const f = p as {
        file_id?: string;
        file_url?: string;
        filename?: string;
        file_data?: string;
      };
      // Chat 官方 file part
      const file: Record<string, unknown> = {};
      if (f.file_id) file.file_id = f.file_id;
      if (f.filename) file.filename = f.filename;
      if (f.file_data) file.file_data = f.file_data;
      if (f.file_url && !f.file_id && !f.file_data) {
        // 部分网关接受 url；官方更常见 file_id/file_data
        file.file_url = f.file_url;
      }
      return { type: "file", file };
    }
    // 未知 part 原样透传，避免丢字段
    const { type, ...rest } = p as { type: string; [k: string]: unknown };
    return { type, ...rest };
  });
}

/**
 * Responses 扁平 tools → Chat 嵌套 tools。
 * 官方 chat: { type:"function", function:{ name, description, parameters, strict } }
 * 跳过 web_search 等 chat 不支持的内置 tool（避免非法请求）。
 */
export function toChatTools(
  tools: ResponsesToolDefinition[],
): ChatTool[] {
  const out: ChatTool[] = [];
  for (const t of tools) {
    if (t.type === "function") {
      // 已是扁平 function
      if ("name" in t && typeof (t as { name?: string }).name === "string") {
        const f = t as {
          type: "function";
          name: string;
          description?: string;
          parameters?: Record<string, unknown>;
          strict?: boolean;
        };
        out.push({
          type: "function",
          function: {
            name: f.name,
            description: f.description,
            parameters: f.parameters,
            strict: f.strict,
          },
        });
        continue;
      }
      // 已是嵌套 {type,function:{...}}
      const nested = t as unknown as {
        type: "function";
        function?: {
          name: string;
          description?: string;
          parameters?: Record<string, unknown>;
          strict?: boolean;
        };
      };
      if (nested.function?.name) {
        out.push({
          type: "function",
          function: {
            name: nested.function.name,
            description: nested.function.description,
            parameters: nested.function.parameters,
            strict: nested.function.strict,
          },
        });
      }
      continue;
    }
    // chat 无内置 web_search 等 → 跳过
  }
  return out;
}

/** textFormat → chat response_format */
export function toChatResponseFormat(
  fmt: ResponsesTextFormat,
): Record<string, unknown> {
  if (fmt.type === "json_object") {
    return { type: "json_object" };
  }
  if (fmt.type === "text") {
    return { type: "text" };
  }
  // json_schema
  return {
    type: "json_schema",
    json_schema: {
      name: fmt.name ?? "result",
      strict: fmt.strict ?? true,
      schema: fmt.schema ?? { type: "object", properties: {} },
    },
  };
}

/** 解析 chat message.tool_calls（兼容弃用 function_call） */
export function extractChatToolCalls(
  data: OpenAIChatResponse | Record<string, unknown>,
): ProviderToolCall[] {
  const d = data as OpenAIChatResponse;
  const msg = d.choices?.[0]?.message;
  if (!msg) return [];
  const out: ProviderToolCall[] = [];

  if (Array.isArray(msg.tool_calls)) {
    for (const [i, tc] of msg.tool_calls.entries()) {
      const name = tc.function?.name;
      if (!name) continue;
      out.push({
        callId: tc.id || `call_${i}`,
        name,
        arguments:
          typeof tc.function?.arguments === "string"
            ? tc.function.arguments
            : JSON.stringify(tc.function?.arguments ?? {}),
        type: tc.type ?? "function",
        index: tc.index ?? i,
      });
    }
  }

  // 兼容弃用 function_call
  if (out.length === 0 && msg.function_call?.name) {
    out.push({
      callId: "call_0",
      name: msg.function_call.name,
      arguments:
        typeof msg.function_call.arguments === "string"
          ? msg.function_call.arguments
          : JSON.stringify(msg.function_call.arguments ?? {}),
      type: "function",
      index: 0,
    });
  }
  return out;
}

/** 构造 chat tool 回灌消息（role=tool） */
export function toolResultMessage(
  callId: string,
  output: string,
): Message {
  return {
    role: "tool",
    content: output,
    callId,
    toolOutput: output,
  };
}

/** Message → Responses content parts */
function toResponsesContentParts(m: Message): ResponsesContentPart[] {
  if (m.parts && m.parts.length > 0) {
    return m.parts.map((p) => partToResponses(p, m.content));
  }
  return [{ type: "input_text", text: m.content }];
}

function partToResponses(
  p: MessageContentPart,
  fallback: string,
): ResponsesContentPart {
  if (p.type === "text" || p.type === "input_text") {
    return { type: "input_text", text: (p as { text: string }).text };
  }
  if (p.type === "image_url" || p.type === "input_image") {
    const img = p as {
      image_url: string | { url: string; detail?: "auto" | "low" | "high" };
    };
    const url =
      typeof img.image_url === "string" ? img.image_url : img.image_url.url;
    const detail =
      typeof img.image_url === "string" ? undefined : img.image_url.detail;
    return detail
      ? { type: "input_image", image_url: url, detail }
      : { type: "input_image", image_url: url };
  }
  if (p.type === "input_file" || p.type === "file") {
    const f = p as {
      file_id?: string;
      file_url?: string;
      filename?: string;
    };
    return {
      type: "input_file",
      file_id: f.file_id,
      file_url: f.file_url,
      filename: f.filename,
    };
  }
  if (p.type === "input_audio") {
    // Responses 侧无统一 input_audio part 时，降级为文本说明 + 透传
    const a = p as { input_audio?: { data?: string; format?: string } };
    return {
      type: "input_text",
      text: `[audio:${a.input_audio?.format ?? "bin"}]`,
    };
  }
  // 未知 part 尽量原样塞进 responses content
  return { ...(p as object), type: (p as { type: string }).type } as ResponsesContentPart;
}

/**
 * 提取纯文本：优先 output_text；
 * 否则只遍历 type=message 的 output_text（跳过 reasoning/tool）。
 */
export function extractResponsesText(
  data: OpenAIResponsesResponse | Record<string, unknown>,
): string {
  const d = data as OpenAIResponsesResponse;
  if (typeof d.output_text === "string" && d.output_text.length > 0) {
    return d.output_text;
  }
  const parts: string[] = [];
  for (const item of d.output ?? []) {
    if (item.type && item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type === "output_text" || c.type === "text") {
        if (typeof c.text === "string" && c.text) parts.push(c.text);
      } else if (!c.type && typeof c.text === "string" && c.text) {
        parts.push(c.text);
      }
    }
  }
  return parts.join("\n");
}

/** 提取 function_call items */
export function extractResponsesToolCalls(
  data: OpenAIResponsesResponse | Record<string, unknown>,
): ProviderToolCall[] {
  const d = data as OpenAIResponsesResponse;
  const out: ProviderToolCall[] = [];
  for (const item of d.output ?? []) {
    if (item.type !== "function_call") continue;
    if (!item.call_id || !item.name) continue;
    out.push({
      callId: item.call_id,
      name: item.name,
      arguments:
        typeof item.arguments === "string"
          ? item.arguments
          : JSON.stringify(item.arguments ?? {}),
    });
  }
  return out;
}

/**
 * 归一化 Responses output items：
 * message / reasoning / function_call /
 * file_search_call / code_interpreter_call /
 * web_search_call / computer_call / image_generation_call …
 */
export function extractResponsesOutputItems(
  data: OpenAIResponsesResponse | Record<string, unknown>,
): ProviderOutputItem[] {
  const d = data as OpenAIResponsesResponse;
  const out: ProviderOutputItem[] = [];
  for (const item of d.output ?? []) {
    if (!item || typeof item !== "object") continue;
    const type = String(item.type ?? "unknown");
    const normalized: ProviderOutputItem = {
      type,
      id: typeof item.id === "string" ? item.id : undefined,
      status: typeof item.status === "string" ? item.status : undefined,
      role: typeof item.role === "string" ? item.role : undefined,
      callId: typeof item.call_id === "string" ? item.call_id : undefined,
      name: typeof item.name === "string" ? item.name : undefined,
      arguments:
        typeof item.arguments === "string"
          ? item.arguments
          : item.arguments != null
            ? JSON.stringify(item.arguments)
            : undefined,
      summary: item.summary,
      queries: item.queries,
      results: item.results,
      code: typeof item.code === "string" ? item.code : undefined,
      outputs: item.outputs,
      action: item.action,
      content: item.content,
      raw: item,
    };
    out.push(normalized);
  }
  return out;
}

/** message content 中的 annotations */
export function extractResponsesAnnotations(
  data: OpenAIResponsesResponse | Record<string, unknown>,
): unknown[] {
  const d = data as OpenAIResponsesResponse;
  const ann: unknown[] = [];
  for (const item of d.output ?? []) {
    if (item.type && item.type !== "message") continue;
    for (const c of item.content ?? []) {
      const a = (c as { annotations?: unknown[] }).annotations;
      if (Array.isArray(a)) ann.push(...a);
    }
  }
  return ann;
}

/** 构造 function_call_output 消息，便于 tool 闭环 */
export function functionCallOutputMessage(
  callId: string,
  output: string,
): Message {
  return {
    role: "tool",
    content: output,
    callId,
    toolOutput: output,
  };
}
