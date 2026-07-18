/**
 * 将配置文件并入 defaults 解析链：
 * 显式 > 环境变量 > ~/.maestro/config.json > 内置默认
 */

import type { OpenAIApiFormat, ProviderKind } from "../types";
import {
  DEFAULT_BASE_URLS,
  DEFAULT_MODELS,
  apiFormatEnvName,
  apiKeyEnvName,
  baseUrlEnvName,
  modelEnvName,
  normalizeApiFormat,
} from "./defaults";
import { getProviderEntry } from "../config/store";

export function resolveBaseUrlWithConfig(
  kind: ProviderKind,
  explicit?: string,
): string {
  const fromEnv = process.env[baseUrlEnvName(kind)]?.trim();
  const fromCfg = getProviderEntry(kind).baseUrl?.trim();
  const raw = (
    explicit?.trim() ||
    fromEnv ||
    fromCfg ||
    DEFAULT_BASE_URLS[kind]
  ).replace(/\/+$/, "");
  return raw;
}

export function resolveApiKeyWithConfig(
  kind: ProviderKind,
  explicit?: string,
): string {
  const fromEnv = process.env[apiKeyEnvName(kind)]?.trim();
  const fromCfg = getProviderEntry(kind).apiKey?.trim();
  return explicit?.trim() || fromEnv || fromCfg || "";
}

export function resolveModelWithConfig(
  kind: ProviderKind,
  explicit?: string,
  roleDefault?: string,
): string {
  const fromEnv = process.env[modelEnvName(kind)]?.trim();
  const fromCfg = getProviderEntry(kind).model?.trim();
  return (
    explicit?.trim() ||
    fromEnv ||
    fromCfg ||
    roleDefault ||
    DEFAULT_MODELS[kind]
  );
}

/** apiFormat：显式 > env > config file > chat */
export function resolveApiFormatWithConfig(
  kind: ProviderKind,
  explicit?: string | OpenAIApiFormat,
): OpenAIApiFormat {
  if (kind !== "openai" && kind !== "grok") return "chat";
  const fromEnv = process.env[apiFormatEnvName(kind)];
  const fromCfg = getProviderEntry(kind).apiFormat;
  return (
    normalizeApiFormat(explicit) ??
    normalizeApiFormat(fromEnv) ??
    (fromCfg === "chat" || fromCfg === "responses" ? fromCfg : undefined) ??
    "chat"
  );
}
