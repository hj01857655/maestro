/**
 * Provider 默认值 / 工厂 / Grok 搜索参数测试
 */
import { describe, expect, it } from "bun:test";
import {
  DEFAULT_BASE_URLS,
  buildProviderConfig,
  createProvider,
  resolveBaseUrl,
  resolveModel,
  apiKeyEnvName,
} from "../../src/providers";
import { GrokProvider } from "../../src/providers/grok";
import { ClaudeProvider } from "../../src/providers/claude";
import { Agent } from "../../src/core/agent";
import type { Message, ProviderResult } from "../../src/types";

describe("Provider defaults", () => {
  it("空 baseUrl 应回落到官方默认", () => {
    expect(resolveBaseUrl("claude", "")).toBe(DEFAULT_BASE_URLS.claude);
    expect(resolveBaseUrl("openai")).toBe(DEFAULT_BASE_URLS.openai);
    expect(resolveBaseUrl("gemini")).toBe(DEFAULT_BASE_URLS.gemini);
    expect(resolveBaseUrl("grok", "  ")).toBe(DEFAULT_BASE_URLS.grok);
  });

  it("显式 baseUrl 优先", () => {
    expect(resolveBaseUrl("claude", "https://proxy.local/")).toBe(
      "https://proxy.local",
    );
  });

  it("createProvider 应填满默认字段", () => {
    const p = createProvider("claude", { apiKey: "sk-test" });
    expect(p).toBeInstanceOf(ClaudeProvider);
    expect(p.config.baseUrl).toBe(DEFAULT_BASE_URLS.claude);
    expect(p.config.apiKey).toBe("sk-test");
    expect(p.model).toBeTruthy();
  });

  it("buildProviderConfig 尊重 roleModel", () => {
    const cfg = buildProviderConfig("openai", {
      roleModel: "gpt-custom",
      apiKey: "k",
    });
    expect(cfg.model).toBe("gpt-custom");
    expect(cfg.baseUrl).toBe(DEFAULT_BASE_URLS.openai);
  });

  it("apiKeyEnvName 正确", () => {
    expect(apiKeyEnvName("openai")).toBe("OPENAI_API_KEY");
    expect(apiKeyEnvName("claude")).toBe("CLAUDE_API_KEY");
    expect(apiKeyEnvName("grok")).toBe("GROK_API_KEY");
  });

  it("resolveModel 有默认", () => {
    expect(resolveModel("grok")).toBe("grok-4.5");
  });
});

describe("Grok live search", () => {
  it("普通 invoke 默认不带 search_parameters", () => {
    const grok = new GrokProvider({
      name: "g",
      baseUrl: "",
      apiKey: "x",
      model: "grok-4.5",
    });
    expect(grok.config.baseUrl).toBe(DEFAULT_BASE_URLS.grok);
    const params = grok.peekSearchParameters();
    expect(params).toBeUndefined();
  });

  it("invokeWithSearch 应注入 mode=on 与 return_citations", () => {
    const grok = new GrokProvider({
      name: "g",
      baseUrl: "https://api.x.ai",
      apiKey: "x",
      model: "grok-4.5",
    });
    const params = grok.peekSearchParameters(
      [{ role: "user", content: "最新 Rust 版本" }],
      { mode: "on", returnCitations: true, maxSearchResults: 8 },
    );
    expect(params).toEqual({
      mode: "on",
      return_citations: true,
      max_search_results: 8,
    });
  });

  it("Researcher Agent 应对 Grok 走 invokeWithSearch", async () => {
    const calls: Array<{ method: string; search?: unknown }> = [];

    class SpyGrok extends GrokProvider {
      override async invoke(
        messages: Message[],
        options?: { temperature?: number; maxTokens?: number },
      ): Promise<ProviderResult> {
        calls.push({
          method: "invoke",
          search: this["pendingSearch"],
        });
        return {
          content: "evidence",
          model: this.model,
          provider: "grok",
        };
      }

      override async invokeWithSearch(
        messages: Message[],
        searchQuery?: string,
        options?: {
          temperature?: number;
          maxTokens?: number;
          search?: { mode?: string };
        },
      ): Promise<ProviderResult> {
        calls.push({ method: "invokeWithSearch", search: options?.search });
        return super.invokeWithSearch(messages, searchQuery, options);
      }
    }

    const provider = new SpyGrok({
      name: "spy",
      baseUrl: "https://api.x.ai",
      apiKey: "x",
      model: "grok-4.5",
    });

    const agent = new Agent(
      {
        name: "researcher",
        role: "researcher",
        provider: "grok",
        model: "grok-4.5",
        systemPrompt: "research",
      },
      provider,
    );

    const result = await agent.run([{ role: "user", content: "查 xAI 最新公告" }]);
    expect(result.content).toBe("evidence");
    expect(calls.some((c) => c.method === "invokeWithSearch")).toBe(true);
    const searchCall = calls.find((c) => c.method === "invokeWithSearch");
    expect(searchCall?.search).toMatchObject({ mode: "on" });
  });

  it("非 researcher 不走 search", async () => {
    const calls: string[] = [];
    class SpyGrok extends GrokProvider {
      override async invoke(): Promise<ProviderResult> {
        calls.push("invoke");
        return { content: "ok", model: this.model, provider: "grok" };
      }
      override async invokeWithSearch(): Promise<ProviderResult> {
        calls.push("invokeWithSearch");
        return { content: "search", model: this.model, provider: "grok" };
      }
    }

    const agent = new Agent(
      {
        name: "coder",
        role: "coder",
        provider: "grok",
        model: "grok-4.5",
        systemPrompt: "code",
      },
      new SpyGrok({
        name: "spy",
        baseUrl: "https://api.x.ai",
        apiKey: "x",
        model: "grok-4.5",
      }),
    );

    await agent.run([{ role: "user", content: "写代码" }]);
    expect(calls).toEqual(["invoke"]);
  });
});
