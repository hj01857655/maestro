/**
 * OpenAI Chat Completions 协议适配测试
 * 对照官方：create chat completion / function calling / streaming
 */
import { describe, expect, it } from "bun:test";
import {
  OpenAIProvider,
  extractChatToolCalls,
  toChatTools,
  toChatResponseFormat,
  toolResultMessage,
} from "../../src/providers/openai";
import type { Message } from "../../src/types";

describe("toChatTools / toChatResponseFormat / extractChatToolCalls", () => {
  it("扁平 function tool 嵌套为 chat 形态", () => {
    const tools = toChatTools([
      {
        type: "function",
        name: "read_file",
        description: "read",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
        strict: true,
      },
      { type: "web_search" },
    ]);
    expect(tools).toHaveLength(1);
    expect(tools[0]).toEqual({
      type: "function",
      function: {
        name: "read_file",
        description: "read",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
        strict: true,
      },
    });
  });

  it("已嵌套 function tool 原样保留", () => {
    const tools = toChatTools([
      {
        type: "function",
        function: {
          name: "x",
          description: "d",
          parameters: { type: "object" },
        },
      } as never,
    ]);
    expect(tools[0]?.function.name).toBe("x");
  });

  it("textFormat → response_format", () => {
    expect(toChatResponseFormat({ type: "json_object" })).toEqual({
      type: "json_object",
    });
    expect(toChatResponseFormat({ type: "text" })).toEqual({ type: "text" });
    expect(
      toChatResponseFormat({
        type: "json_schema",
        name: "answer",
        strict: true,
        schema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      }),
    ).toEqual({
      type: "json_schema",
      json_schema: {
        name: "answer",
        strict: true,
        schema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
    });
  });

  it("提取 tool_calls + 兼容 function_call", () => {
    expect(
      extractChatToolCalls({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "call_a",
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: '{"path":"a.ts"}',
                  },
                },
              ],
            },
          },
        ],
      }),
    ).toEqual([
      {
        callId: "call_a",
        name: "read_file",
        arguments: '{"path":"a.ts"}',
        type: "function",
        index: 0,
      },
    ]);

    expect(
      extractChatToolCalls({
        choices: [
          {
            message: {
              function_call: {
                name: "legacy",
                arguments: "{}",
              },
            },
          },
        ],
      }),
    ).toEqual([
      {
        callId: "call_0",
        name: "legacy",
        arguments: "{}",
        type: "function",
        index: 0,
      },
    ]);
  });
});

describe("OpenAIProvider chat 请求", () => {
  it("默认 max_completion_tokens；tools 嵌套；response_format", async () => {
    const originalFetch = globalThis.fetch;
    let hitUrl = "";
    let hitBody: Record<string, unknown> | null = null;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      hitUrl = String(input);
      hitBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({
          id: "chatcmpl_1",
          model: "gpt-5.6-sol",
          choices: [
            {
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 3 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const p = new OpenAIProvider({
        name: "oai",
        baseUrl: "https://api.openai.com",
        apiKey: "sk",
        model: "gpt-5.6-sol",
        apiFormat: "chat",
      });
      const result = await p.invoke([{ role: "user", content: "hi" }], {
        maxTokens: 64,
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
        parallelToolCalls: false,
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

      expect(hitUrl).toBe("https://api.openai.com/v1/chat/completions");
      expect(hitBody?.model).toBe("gpt-5.6-sol");
      expect(hitBody?.max_completion_tokens).toBe(64);
      expect(hitBody?.max_tokens).toBeUndefined();
      expect(hitBody?.tool_choice).toBe("auto");
      expect(hitBody?.parallel_tool_calls).toBe(false);
      const tools = hitBody?.tools as Array<Record<string, unknown>>;
      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({
        type: "function",
        function: { name: "get_weather" },
      });
      expect(hitBody?.response_format).toEqual({
        type: "json_schema",
        json_schema: {
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
      expect(result.content).toBe("ok");
      expect(result.responseId).toBe("chatcmpl_1");
      expect(result.status).toBe("stop");
      expect(result.usage).toEqual({ inputTokens: 2, outputTokens: 3 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("chatMaxTokensField=legacy / both", async () => {
    const originalFetch = globalThis.fetch;
    const bodies: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(
        JSON.stringify({
          id: "c",
          model: "m",
          choices: [{ message: { content: "x" }, finish_reason: "stop" }],
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
      });
      await p.invoke([{ role: "user", content: "a" }], {
        maxTokens: 10,
        chatMaxTokensField: "legacy",
      });
      await p.invoke([{ role: "user", content: "b" }], {
        maxTokens: 20,
        chatMaxTokensField: "both",
      });
      expect(bodies[0]?.max_tokens).toBe(10);
      expect(bodies[0]?.max_completion_tokens).toBeUndefined();
      expect(bodies[1]?.max_tokens).toBe(20);
      expect(bodies[1]?.max_completion_tokens).toBe(20);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("多模态 image_url + tool_call_id 回灌 + assistant.tool_calls 历史", async () => {
    const originalFetch = globalThis.fetch;
    let hitBody: Record<string, unknown> | null = null;

    globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      hitBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({
          id: "chatcmpl_2",
          model: "gpt-5.6",
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_9",
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: '{"path":"x"}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 8 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    try {
      const p = new OpenAIProvider({
        name: "oai",
        baseUrl: "https://api.openai.com",
        apiKey: "sk",
        model: "gpt-5.6",
      });
      const messages: Message[] = [
        {
          role: "user",
          content: "看图",
          parts: [
            { type: "text", text: "描述图片" },
            {
              type: "image_url",
              image_url: { url: "https://example.com/a.png", detail: "high" },
            },
          ],
        },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              callId: "call_8",
              name: "read_file",
              arguments: '{"path":"prev"}',
            },
          ],
        },
        toolResultMessage("call_8", '{"ok":true}'),
      ];
      const result = await p.invoke(messages);

      const msgs = hitBody?.messages as Array<Record<string, unknown>>;
      expect(msgs).toHaveLength(3);

      // multimodal user
      const user = msgs[0];
      expect(user.role).toBe("user");
      expect(Array.isArray(user.content)).toBe(true);
      const parts = user.content as Array<Record<string, unknown>>;
      expect(parts[0]).toMatchObject({ type: "text", text: "描述图片" });
      expect(parts[1]).toMatchObject({
        type: "image_url",
        image_url: { url: "https://example.com/a.png", detail: "high" },
      });

      // assistant with tool_calls
      const asst = msgs[1];
      expect(asst.role).toBe("assistant");
      expect(asst.content).toBeNull();
      expect(asst.tool_calls).toEqual([
        {
          id: "call_8",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"prev"}' },
          index: 0,
        },
      ]);

      // tool result
      const tool = msgs[2];
      expect(tool).toMatchObject({
        role: "tool",
        tool_call_id: "call_8",
        content: '{"ok":true}',
      });

      expect(result.content).toBe("");
      expect(result.status).toBe("tool_calls");
      expect(result.toolCalls?.[0]).toMatchObject({
        callId: "call_9",
        name: "read_file",
        arguments: '{"path":"x"}',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("refusal 作为 content；error.message 抛错", async () => {
    const originalFetch = globalThis.fetch;
    let n = 0;
    globalThis.fetch = (async () => {
      n += 1;
      if (n === 1) {
        return new Response(
          JSON.stringify({
            id: "c1",
            model: "m",
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  refusal: "I can't help with that.",
                },
                finish_reason: "stop",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          error: { message: "rate limited", type: "rate_limit" },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    try {
      const p = new OpenAIProvider({
        name: "oai",
        baseUrl: "https://api.example.com",
        apiKey: "sk",
        model: "gpt",
      });
      const r = await p.invoke([{ role: "user", content: "x" }]);
      expect(r.content).toBe("I can't help with that.");

      let err: unknown;
      try {
        await p.invoke([{ role: "user", content: "y" }]);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Error);
      expect(String(err)).toMatch(/rate limited/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("chat 流式：delta.content + stream_options + [DONE]", async () => {
    const originalFetch = globalThis.fetch;
    let hitBody: Record<string, unknown> | null = null;
    const sse = [
      'data: {"choices":[{"delta":{"role":"assistant"}}]}',
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      "data: [DONE]",
      "",
    ].join("\n");

    globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      hitBody = JSON.parse(String(init?.body ?? "{}"));
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
      });
      const stream = await p.invokeStream([{ role: "user", content: "x" }]);
      let text = "";
      for await (const chunk of stream) text += chunk;
      expect(text).toBe("Hello");
      expect(hitBody?.stream).toBe(true);
      expect(hitBody?.stream_options).toEqual({ include_usage: true });
      expect(hitBody?.max_completion_tokens).toBe(4096);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("官方可选字段透传：top_p / reasoning_effort / metadata / extraBody", async () => {
    const originalFetch = globalThis.fetch;
    let hitBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      hitBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({
          id: "c",
          model: "m",
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
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
      });
      await p.invoke([{ role: "user", content: "x" }], {
        topP: 0.9,
        frequencyPenalty: 0.1,
        presencePenalty: 0.2,
        stop: ["END"],
        seed: 42,
        n: 1,
        reasoningEffort: "high",
        verbosity: "low",
        metadata: { run: "t1" },
        serviceTier: "auto",
        safetyIdentifier: "u1",
        promptCacheKey: "pc1",
        modalities: ["text"],
        webSearchOptions: { search_context_size: "low" },
        extraBody: { logit_bias: { "123": 1 } },
      });
      expect(hitBody?.top_p).toBe(0.9);
      expect(hitBody?.frequency_penalty).toBe(0.1);
      expect(hitBody?.presence_penalty).toBe(0.2);
      expect(hitBody?.stop).toEqual(["END"]);
      expect(hitBody?.seed).toBe(42);
      expect(hitBody?.n).toBe(1);
      expect(hitBody?.reasoning_effort).toBe("high");
      expect(hitBody?.verbosity).toBe("low");
      expect(hitBody?.metadata).toEqual({ run: "t1" });
      expect(hitBody?.service_tier).toBe("auto");
      expect(hitBody?.safety_identifier).toBe("u1");
      expect(hitBody?.prompt_cache_key).toBe("pc1");
      expect(hitBody?.modalities).toEqual(["text"]);
      expect(hitBody?.web_search_options).toEqual({
        search_context_size: "low",
      });
      expect(hitBody?.logit_bias).toEqual({ "123": 1 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("audio / prediction / logprobs / file / input_audio parts", async () => {
    const originalFetch = globalThis.fetch;
    let hitBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      hitBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({
          id: "c",
          model: "m",
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
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
      });
      await p.invoke(
        [
          {
            role: "user",
            content: "multi",
            parts: [
              { type: "text", text: "听这段" },
              {
                type: "input_audio",
                input_audio: { data: "AAAA", format: "wav" },
              },
              {
                type: "file",
                file_id: "file-1",
                filename: "a.pdf",
              },
            ],
          },
        ],
        {
          modalities: ["text", "audio"],
          audio: { voice: "alloy", format: "wav" },
          prediction: { type: "content", content: "prefill" },
          logitBias: { "42": 1 },
          logprobs: true,
          topLogprobs: 3,
          store: true,
          user: "u-legacy",
          promptCacheOptions: { mode: "implicit", ttl: "30m" },
          streamOptions: { include_obfuscation: false },
        },
      );

      expect(hitBody?.modalities).toEqual(["text", "audio"]);
      expect(hitBody?.audio).toEqual({ voice: "alloy", format: "wav" });
      expect(hitBody?.prediction).toEqual({
        type: "content",
        content: "prefill",
      });
      expect(hitBody?.logit_bias).toEqual({ "42": 1 });
      expect(hitBody?.logprobs).toBe(true);
      expect(hitBody?.top_logprobs).toBe(3);
      expect(hitBody?.store).toBe(true);
      expect(hitBody?.user).toBe("u-legacy");
      expect(hitBody?.prompt_cache_options).toEqual({
        mode: "implicit",
        ttl: "30m",
      });

      const msgs = hitBody?.messages as Array<Record<string, unknown>>;
      const parts = msgs[0]?.content as Array<Record<string, unknown>>;
      expect(parts).toEqual([
        { type: "text", text: "听这段" },
        {
          type: "input_audio",
          input_audio: { data: "AAAA", format: "wav" },
        },
        {
          type: "file",
          file: { file_id: "file-1", filename: "a.pdf" },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("audio 响应解析 + moderation 请求 + audioId 历史", async () => {
    const originalFetch = globalThis.fetch;
    let hitBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      hitBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({
          id: "chatcmpl_audio",
          model: "gpt-audio",
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                audio: {
                  id: "audio_abc",
                  data: "UklGRg==",
                  transcript: "你好世界",
                  expires_at: 1729000000,
                },
              },
              finish_reason: "stop",
              logprobs: { content: [] },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
            prompt_tokens_details: { cached_tokens: 2, audio_tokens: 1 },
            completion_tokens_details: {
              reasoning_tokens: 0,
              audio_tokens: 15,
            },
          },
          moderation: {
            output: { results: [{ flagged: false }] },
          },
          service_tier: "default",
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    try {
      const p = new OpenAIProvider({
        name: "oai",
        baseUrl: "https://api.openai.com",
        apiKey: "sk",
        model: "gpt-audio",
      });
      const result = await p.invoke(
        [
          { role: "user", content: "hi" },
          {
            role: "assistant",
            content: "",
            audioId: "audio_prev",
          },
          { role: "user", content: "again" },
        ],
        {
          modalities: ["text", "audio"],
          audio: { voice: "alloy", format: "wav" },
          moderation: {
            model: "omni-moderation-latest",
            policy: { output: { mode: "score" } },
          },
        },
      );

      expect(hitBody?.moderation).toEqual({
        model: "omni-moderation-latest",
        policy: { output: { mode: "score" } },
      });
      const msgs = hitBody?.messages as Array<Record<string, unknown>>;
      expect(msgs[1]).toMatchObject({
        role: "assistant",
        audio: { id: "audio_prev" },
      });

      expect(result.content).toBe("你好世界");
      expect(result.audio).toEqual({
        id: "audio_abc",
        data: "UklGRg==",
        transcript: "你好世界",
        expiresAt: 1729000000,
      });
      expect(result.usage).toMatchObject({
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        audioTokens: 15,
        cachedTokens: 2,
      });
      expect(result.moderation).toEqual({
        output: { results: [{ flagged: false }] },
      });
      expect(result.serviceTier).toBe("default");
      expect(result.logprobs).toEqual({ content: [] });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
