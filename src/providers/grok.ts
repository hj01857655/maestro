/**
 * Grok Provider — xAI Grok API 适配器。
 *
 * 协议：OpenAI 兼容 chat/completions（https://api.x.ai/v1/chat/completions）
 * 搜索：通过 search_parameters 开启 live search（mode: on/auto/off）
 * 文档：https://docs.x.ai/docs/api-reference
 *
 * Researcher 角色应走 invokeWithSearch，拿到带 citations 的一手证据。
 */

import { OpenAIProvider, type OpenAIRequest } from "./openai";
import type { Message, ProviderConfig, ProviderResult } from "../types";
import { resolveBaseUrl } from "./defaults";

export type GrokSearchMode = "off" | "on" | "auto";

export interface GrokSearchOptions {
  /** on = 强制搜索；auto = 模型决定；off = 关闭 */
  mode?: GrokSearchMode;
  /** 是否返回 citations URL */
  returnCitations?: boolean;
  maxSearchResults?: number;
  fromDate?: string;
  toDate?: string;
  /** 可选：限定来源类型，如 web / x / news */
  sources?: Array<{ type: string }>;
}

export class GrokProvider extends OpenAIProvider {
  /** 下一次 invoke 使用的搜索参数（invokeWithSearch 设置） */
  private pendingSearch?: GrokSearchOptions;
  /** 默认搜索策略：普通 invoke 不搜索，除非显式开启 */
  defaultSearch: GrokSearchOptions = { mode: "off" };

  constructor(config: ProviderConfig) {
    super({
      ...config,
      name: config.name || "Grok",
      baseUrl: config.baseUrl?.trim()
        ? config.baseUrl.replace(/\/+$/, "")
        : resolveBaseUrl("grok"),
      model: config.model || "grok-4.5",
    });
    // OpenAIProvider 会把 kind 设成 openai；这里修正语义标签
    // kind 字段在 BaseProvider 是 readonly，通过 providerLabel 覆盖结果
  }

  protected override get providerLabel(): string {
    return "grok";
  }

  /**
   * 构建 chat completions 请求体。
   * 若 pendingSearch / defaultSearch 开启搜索，注入 search_parameters。
   */
  protected override buildRequestBody(
    messages: Message[],
    options?: { temperature?: number; maxTokens?: number },
  ): OpenAIRequest {
    const body = super.buildRequestBody(messages, options);
    const search = this.pendingSearch ?? this.defaultSearch;
    const mode = search.mode ?? "off";

    if (mode !== "off") {
      const params: Record<string, unknown> = {
        mode,
        return_citations: search.returnCitations ?? true,
      };
      if (search.maxSearchResults != null) {
        params.max_search_results = search.maxSearchResults;
      }
      if (search.fromDate) params.from_date = search.fromDate;
      if (search.toDate) params.to_date = search.toDate;
      if (search.sources) params.sources = search.sources;
      body.search_parameters = params;
    }

    return body;
  }

  /**
   * 带 live search 的调用 — 真正走 xAI search_parameters，不是假 system prompt。
   *
   * @param messages 对话
   * @param searchQuery 可选：把查询强化进 user 消息（便于定向搜）
   * @param options 温度 / tokens / 搜索细节
   */
  async invokeWithSearch(
    messages: Message[],
    searchQuery?: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
      search?: GrokSearchOptions;
    },
  ): Promise<ProviderResult> {
    const search: GrokSearchOptions = {
      mode: "on",
      returnCitations: true,
      maxSearchResults: 10,
      ...options?.search,
    };

    let msgs = messages;
    if (searchQuery?.trim()) {
      // 定向搜索：在最后一条 user 消息前追加搜索意图
      msgs = [
        ...messages,
        {
          role: "user",
          content: [
            `请使用实时搜索，针对以下查询收集一手证据：`,
            searchQuery.trim(),
            ``,
            `要求：`,
            `1. 优先一手来源（官方文档、论文、公告、原始仓库）`,
            `2. 每条关键事实注明来源 URL`,
            `3. 区分已验证事实与推断`,
            `4. 不要编造链接或数据`,
          ].join("\n"),
        },
      ];
    } else {
      // 无显式 query：要求模型自行判断搜索点
      msgs = [
        {
          role: "system",
          content: `你是 Grok，具备 live search。回答前必须搜索可验证的一手信息，并在结论中附上来源。禁止编造。`,
        },
        ...messages.filter((m) => m.role !== "system"),
      ];
    }

    this.pendingSearch = search;
    try {
      return await this.invoke(msgs, {
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
      });
    } finally {
      this.pendingSearch = undefined;
    }
  }

  /** 暴露当前将要发出的 search_parameters（测试用） */
  peekSearchParameters(
    messages: Message[] = [{ role: "user", content: "ping" }],
    search?: GrokSearchOptions,
  ): Record<string, unknown> | undefined {
    if (search) this.pendingSearch = search;
    try {
      return this.buildRequestBody(messages).search_parameters as
        | Record<string, unknown>
        | undefined;
    } finally {
      if (search) this.pendingSearch = undefined;
    }
  }
}
