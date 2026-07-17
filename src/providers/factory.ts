/**
 * Provider 工厂 — 统一构造，填默认 baseUrl / model / apiKey。
 */

import type { ProviderConfig, ProviderKind } from "../types";
import { BaseProvider } from "./base";
import { ClaudeProvider } from "./claude";
import { OpenAIProvider } from "./openai";
import { GeminiProvider } from "./gemini";
import { GrokProvider } from "./grok";
import {
  resolveApiKeyWithConfig as resolveApiKey,
  resolveBaseUrlWithConfig as resolveBaseUrl,
  resolveModelWithConfig as resolveModel,
} from "./resolve";

export interface CreateProviderOptions {
  /** 覆盖 name */
  name?: string;
  /** 显式 baseUrl（优先于环境变量） */
  baseUrl?: string;
  /** 显式 apiKey */
  apiKey?: string;
  /** 显式 model */
  model?: string;
  /** 角色推荐 model（次于环境变量） */
  roleModel?: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
  extraHeaders?: Record<string, string>;
}

export function buildProviderConfig(
  kind: ProviderKind,
  opts: CreateProviderOptions = {},
): ProviderConfig {
  return {
    name: opts.name ?? kind,
    baseUrl: resolveBaseUrl(kind, opts.baseUrl),
    apiKey: resolveApiKey(kind, opts.apiKey),
    model: resolveModel(kind, opts.model, opts.roleModel),
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    timeout: opts.timeout,
    extraHeaders: opts.extraHeaders,
  };
}

export function createProvider(
  kind: ProviderKind,
  opts: CreateProviderOptions = {},
): BaseProvider {
  const config = buildProviderConfig(kind, opts);
  switch (kind) {
    case "claude":
      return new ClaudeProvider(config);
    case "openai":
      return new OpenAIProvider(config);
    case "gemini":
      return new GeminiProvider(config);
    case "grok":
      return new GrokProvider(config);
  }
}
