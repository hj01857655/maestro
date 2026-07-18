/**
 * OpenAI Responses API 协议适配测试
 * 对照官方：migrate-to-responses / create response / streaming-responses
 */
import { describe, expect, it } from "bun:test";
import {
  OpenAIProvider,
  extractResponsesText,
  extractResponsesToolCalls,
  functionCallOutputMessage,
} from "../../src/providers/openai";
import {
  buildProviderConfig,
  createProvider,
  normalizeApiFormat,
  resolveApiFormat,
} from "../../src/providers";
import type { Message } from "../../src/types";

describe("apiFormat 解析", () => {
  it("normalizeApiFormat 识别别名", () => {
    expect(normalizeApiFormat("chat")).toBe("chat");
    expect(normalizeApiFormat("chat_completions")).toBe("chat");
    expect(normalizeApiFormat("openai_chat")).toBe("chat");
    expect(normalizeApiFormat("responses")).toBe("responses");
    expect(normalizeApiFormat("openai_responses")).toBe("responses");
    expect(normalizeApiFormat("response")).toBe("responses");
    expect(normalizeApiFormat("weird")).toBeUndefined();
  });

  it("resolveApiFormat 默认 chat；显式优先", () => {
    expect(resolveApiFormat("openai")).toBe("chat");
    expect(resolveApiFormat("openai", "responses")).toBe("responses");
    expect(resolveApiFormat("openai", "openai_responses")).toBe("responses");
    expect(resolveApiFormat("claude", "responses")).toBe("chat");
  });

  it("buildProviderConfig / createProvider 写入 apiFormat", () => {
    const cfg = buildProviderConfig("openai", {
      apiKey: "k",
      apiFormat: "responses",
    });
    expect(cfg.apiFormat).toBe("responses");
    const p = createProvider("openai", {
      apiKey: "k",
      apiFormat: "openai_responses",
    });
    expect(p).toBeInstanceOf(OpenAIProvider);
    expect((p as OpenAIProvider).apiFormat).toBe("responses");
    expect(p.config.apiFormat).toBe("responses");
  });
});

describe("extractResponsesText / toolCalls", () => {
  it("优先 output_text", () => {
    expect(extractResponsesText({ output_text: "hello" })).toBe("hello");
  });

  it("从 message.content[output_text] 拼接，跳过 reasoning", () => {
    expect(
      extractResponsesText({
        output: [
          { type: "reasoning", content: [] },
          {
            type: "message",
            role: "assistant",
            content: [
              { type: "output_text", text: "A" },
              { type: "output_text", text: "B" },
            ],
          },
        ],
      }),
    ).toBe("A\nB");
  });

  it("提取 function_call", () => {
    const calls = extractResponsesToolCalls({
      output: [
        {
          type: "function_call",
          call_id: "call_1",
          name: "read_file",
          arguments: '{"path":"a.ts"}',
        },
        {
          type: "message",
          content: [{ type: "output_text", text: "..." }],
        },
      ],
    });
    expect(calls).toEqual([
      { callId: "call_1", name: "read_file", arguments: '{"path":"a.ts"}' },
    ]);
  });
});

describe("OpenAIProvider responses 请求", () => {
  it("单轮 user：input 为 string + instructions + store:false", async () => {
    const originalFetch = globalThis.fetch;
    let hitUrl = "";
    let hitBody: Record<string, unknown> | null = null;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      hitUrl = String(input);
      hitBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({
          id: "resp_1",
          model: "gpt-5.6-sol",
          status: "completed",
          output_text: "我是 gpt-5.6-sol",
          usage: { input_tokens: 3, output_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const p = new OpenAIProvider({
        name: "mikiko",
        baseUrl: "https://api.mikiko.cc",
        apiKey: "sk-test",
        model: "gpt-5.6-sol",
        apiFormat: "responses",
      });
      const messages: Message[] = [
        { role: "system", content: "你是助手" },
        { role: "user", content: "你是谁" },
      ];
      const result = await p.invoke(messages, { maxTokens: 32 });

      expect(hitUrl).toBe("https://api.mikiko.cc/v1/responses");
      expect(hitBody?.model).toBe("gpt-5.6-sol");
      expect(hitBody?.instructions).toBe("你是助手");
      expect(hitBody?.input).toBe("你是谁");
      expect(hitBody?.max_output_tokens).toBe(32);
      expect(hitBody?.store).toBe(false);
      expect(result.content).toBe("我是 gpt-5.6-sol");
      expect(result.responseId).toBe("resp_1");
      expect(result.usage?.inputTokens).toBe(3);
      expect(result.usage?.outputTokens).toBe(5);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("previous_response_id + tools + text.format + tool_choice/reasoning", async () => {
    const originalFetch = globalThis.fetch;
    let hitBody: Record<string, unknown> | null = null;

    globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      hitBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({
          id: "resp_2",
          status: "completed",
          output_text: "ok",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const p = new OpenAIProvider({
        name: "oai",
        baseUrl: "https://api.openai.com",
        apiKey: "sk",
        model: "gpt-5.6",
        apiFormat: "responses",
      });
      await p.invoke([{ role: "user", content: "续聊" }], {
        previousResponseId: "resp_1",
        tools: [
          {
            type: "function",
            name: "get_weather",
            description: "weather",
            parameters: {
              type: "object",
              properties: { location: { type: "string" } },
              required: ["location"],
            },
          },
          { type: "web_search" },
        ],
        toolChoice: "auto",
        parallelToolCalls: true,
        topP: 0.8,
        reasoningEffort: "medium",
        reasoning: { summary: "auto" },
        verbosity: "high",
        maxToolCalls: 3,
        include: ["web_search_call.action.sources"],
        metadata: { run: "r1" },
        textFormat: {
          type: "json_schema",
          name: "answer",
          strict: true,
          schema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false,
          },
        },
      });

      expect(hitBody?.previous_response_id).toBe("resp_1");
      // 续聊默认 store=true
      expect(hitBody?.store).toBe(true);
      expect(Array.isArray(hitBody?.tools)).toBe(true);
      const tools = hitBody?.tools as Array<Record<string, unknown>>;
      expect(tools[0]).toMatchObject({ type: "function", name: "get_weather" });
      expect(tools[1]).toMatchObject({ type: "web_search" });
      expect(hitBody?.tool_choice).toBe("auto");
      expect(hitBody?.parallel_tool_calls).toBe(true);
      expect(hitBody?.top_p).toBe(0.8);
      expect(hitBody?.max_tool_calls).toBe(3);
      expect(hitBody?.include).toEqual(["web_search_call.action.sources"]);
      expect(hitBody?.metadata).toEqual({ run: "r1" });
      expect(hitBody?.reasoning).toEqual({
        effort: "medium",
        summary: "auto",
      });
      expect(hitBody?.text).toEqual({
        format: {
          type: "json_schema",
          name: "answer",
          strict: true,
          schema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false,
          },
        },
        verbosity: "high",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("prompt / truncation / conversation / prompt_cache_options", async () => {
    const originalFetch = globalThis.fetch;
    let hitBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      hitBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({
          id: "resp_p",
          status: "completed",
          output_text: "ok",
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    try {
      const p = new OpenAIProvider({
        name: "oai",
        baseUrl: "https://api.openai.com",
        apiKey: "sk",
        model: "gpt",
        apiFormat: "responses",
      });
      await p.invoke([{ role: "user", content: "x" }], {
        conversation: { id: "conv_1" },
        background: true,
        prompt: { id: "pmpt_1", version: "2", variables: { name: "A" } },
        truncation: "auto",
        promptCacheKey: "pc",
        promptCacheOptions: { mode: "explicit", ttl: "1h" },
        streamOptions: { include_obfuscation: true },
      });
      expect(hitBody?.conversation).toEqual({ id: "conv_1" });
      expect(hitBody?.background).toBe(true);
      expect(hitBody?.prompt).toEqual({
        id: "pmpt_1",
        version: "2",
        variables: { name: "A" },
      });
      expect(hitBody?.truncation).toBe("auto");
      expect(hitBody?.prompt_cache_key).toBe("pc");
      expect(hitBody?.prompt_cache_options).toEqual({
        mode: "explicit",
        ttl: "1h",
      });
      // 非 stream 时 stream_options 不强制
      expect(hitBody?.stream).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("多模态 input_image + function_call_output 回灌", async () => {
    const originalFetch = globalThis.fetch;
    let hitBody: Record<string, unknown> | null = null;

    globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      hitBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({
          id: "resp_3",
          status: "completed",
          output: [
            {
              type: "function_call",
              call_id: "call_9",
              name: "read_file",
              arguments: '{"path":"x"}',
            },
            {
              type: "message",
              content: [{ type: "output_text", text: "done" }],
            },
          ],
          usage: { input_tokens: 2, output_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const p = new OpenAIProvider({
        name: "oai",
        baseUrl: "https://api.openai.com",
        apiKey: "sk",
        model: "gpt-5.6",
        apiFormat: "responses",
      });
      const result = await p.invoke([
        {
          role: "user",
          content: "看图",
          parts: [
            { type: "input_text", text: "描述图片" },
            {
              type: "input_image",
              image_url: "https://example.com/a.png",
            },
          ],
        },
        functionCallOutputMessage("call_8", '{"ok":true}'),
      ]);

      expect(Array.isArray(hitBody?.input)).toBe(true);
      const input = hitBody?.input as Array<Record<string, unknown>>;
      // message with multimodal parts
      const msg = input.find((i) => i.type === "message" || i.role === "user");
      expect(msg).toBeTruthy();
      expect(Array.isArray(msg?.content)).toBe(true);
      const parts = msg?.content as Array<Record<string, unknown>>;
      expect(parts.some((c) => c.type === "input_text")).toBe(true);
      expect(parts.some((c) => c.type === "input_image")).toBe(true);
      // function_call_output
      const fco = input.find((i) => i.type === "function_call_output");
      expect(fco).toMatchObject({
        type: "function_call_output",
        call_id: "call_8",
        output: '{"ok":true}',
      });
      expect(result.content).toBe("done");
      expect(result.toolCalls?.[0]).toMatchObject({
        callId: "call_9",
        name: "read_file",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("多轮对话：input 为 message 数组", async () => {
    const originalFetch = globalThis.fetch;
    let hitBody: Record<string, unknown> | null = null;

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      hitBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({
          id: "resp_2",
          model: "gpt-5.6-sol",
          status: "completed",
          output: [
            { type: "reasoning", content: [] },
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "第二轮" }],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const p = new OpenAIProvider({
        name: "oai",
        baseUrl: "https://api.openai.com",
        apiKey: "sk-test",
        model: "gpt-5.6-sol",
        apiFormat: "responses",
      });
      const result = await p.invoke([
        { role: "system", content: "sys" },
        { role: "user", content: "第一问" },
        { role: "assistant", content: "第一答" },
        { role: "user", content: "第二问" },
      ]);

      expect(Array.isArray(hitBody?.input)).toBe(true);
      const input = hitBody?.input as Array<{ role: string; content: string }>;
      expect(input.map((i) => i.role)).toEqual(["user", "assistant", "user"]);
      expect(hitBody?.instructions).toBe("sys");
      expect(hitBody?.store).toBe(false);
      expect(result.content).toBe("第二轮");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("status=failed 应抛错", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          id: "resp_x",
          status: "failed",
          error: { message: "upstream down" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const p = new OpenAIProvider({
        name: "oai",
        baseUrl: "https://api.example.com",
        apiKey: "sk",
        model: "gpt",
        apiFormat: "responses",
      });
      await expect(p.invoke([{ role: "user", content: "x" }])).rejects.toThrow(
        /failed|upstream down/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("默认 chat 仍走 /v1/chat/completions", async () => {
    const originalFetch = globalThis.fetch;
    let hitUrl = "";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      hitUrl = String(input);
      return new Response(
        JSON.stringify({
          id: "chat_1",
          model: "gpt-5.6-sol",
          choices: [
            {
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const p = new OpenAIProvider({
        name: "oai",
        baseUrl: "https://api.openai.com",
        apiKey: "sk-test",
        model: "gpt-5.6-sol",
      });
      const result = await p.invoke([{ role: "user", content: "hi" }]);
      expect(hitUrl).toBe("https://api.openai.com/v1/chat/completions");
      expect(result.content).toBe("ok");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("responses 流式：只吃 output_text.delta，忽略其它事件", async () => {
    const originalFetch = globalThis.fetch;
    const sse = [
      'data: {"type":"response.created","response":{}}',
      'data: {"type":"response.output_item.added","item":{"type":"message"}}',
      'data: {"type":"response.output_text.delta","delta":"Hel"}',
      'data: {"type":"response.function_call_arguments.delta","delta":"{}"}',
      'data: {"type":"response.output_text.delta","delta":"lo"}',
      'data: {"type":"response.completed"}',
      "",
    ].join("\n");

    globalThis.fetch = (async () => {
      return new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;

    try {
      const p = new OpenAIProvider({
        name: "oai",
        baseUrl: "https://api.example.com",
        apiKey: "sk",
        model: "gpt",
        apiFormat: "responses",
      });
      const stream = await p.invokeStream([{ role: "user", content: "x" }]);
      let text = "";
      for await (const chunk of stream) text += chunk;
      expect(text).toBe("Hello");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("responses 流式 failed 应抛错", async () => {
    const originalFetch = globalThis.fetch;
    const sse = [
      'data: {"type":"response.output_text.delta","delta":"x"}',
      'data: {"type":"response.failed","error":{"message":"boom"}}',
      "",
    ].join("\n");

    globalThis.fetch = (async () => {
      return new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;

    try {
      const p = new OpenAIProvider({
        name: "oai",
        baseUrl: "https://api.example.com",
        apiKey: "sk",
        model: "gpt",
        apiFormat: "responses",
      });
      const stream = await p.invokeStream([{ role: "user", content: "x" }]);
      let err: unknown;
      try {
        for await (const _ of stream) {
          /* drain */
        }
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Error);
      expect(String(err)).toMatch(/boom|流式失败/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
