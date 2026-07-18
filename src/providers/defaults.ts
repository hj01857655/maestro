/**
 * Provider 默认配置。
 *
 * 环境变量可覆盖：
 *   CLAUDE_BASE_URL / OPENAI_BASE_URL / GEMINI_BASE_URL / GROK_BASE_URL
 *   CLAUDE_API_KEY  / OPENAI_API_KEY  / GEMINI_API_KEY  / GROK_API_KEY
 *   CLAUDE_MODEL    / OPENAI_MODEL    / GEMINI_MODEL    / GROK_MODEL
 *   OPENAI_API_FORMAT / GROK_API_FORMAT  (chat | responses)
 */

import type { OpenAIApiFormat, ProviderKind } from "../types";

export const DEFAULT_BASE_URLS: Record<ProviderKind, string> = {
  claude: "https://api.anthropic.com",
  openai: "https://api.openai.com",
  gemini: "https://generativelanguage.googleapis.com",
  grok: "https://api.x.ai",
};

export const DEFAULT_MODELS: Record<ProviderKind, string> = {
  claude: "claude-sonnet-4-6",
  openai: "gpt-5.6-sol",
  gemini: "gemini-2.5-pro",
  grok: "grok-4.5",
};

/** API Key 环境变量名 */
export function apiKeyEnvName(kind: ProviderKind): string {
  return kind === "openai" ? "OPENAI_API_KEY" : `${kind.toUpperCase()}_API_KEY`;
}

export function baseUrlEnvName(kind: ProviderKind): string {
  return `${kind.toUpperCase()}_BASE_URL`;
}

export function modelEnvName(kind: ProviderKind): string {
  return `${kind.toUpperCase()}_MODEL`;
}

export function apiFormatEnvName(kind: ProviderKind): string {
  return `${kind.toUpperCase()}_API_FORMAT`;
}

/** 解析 baseUrl：显式 > 环境变量 > 默认 */
export function resolveBaseUrl(kind: ProviderKind, explicit?: string): string {
  const fromEnv = process.env[baseUrlEnvName(kind)]?.trim();
  const raw = (explicit?.trim() || fromEnv || DEFAULT_BASE_URLS[kind]).replace(/\/+$/, "");
  return raw;
}

export function resolveApiKey(kind: ProviderKind, explicit?: string): string {
  return explicit?.trim() || process.env[apiKeyEnvName(kind)]?.trim() || "";
}

export function resolveModel(
  kind: ProviderKind,
  explicit?: string,
  roleDefault?: string,
): string {
  return (
    explicit?.trim() ||
    process.env[modelEnvName(kind)]?.trim() ||
    roleDefault ||
    DEFAULT_MODELS[kind]
  );
}

/** 归一化 apiFormat 字符串 */
export function normalizeApiFormat(
  raw?: string | null,
): OpenAIApiFormat | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "chat" || v === "chat_completions" || v === "openai_chat") {
    return "chat";
  }
  if (
    v === "responses" ||
    v === "openai_responses" ||
    v === "response" ||
    v === "openai-responses"
  ) {
    return "responses";
  }
  return undefined;
}

/** 解析 OpenAI 系协议：显式 > 环境变量 > 默认 chat */
export function resolveApiFormat(
  kind: ProviderKind,
  explicit?: string | OpenAIApiFormat,
): OpenAIApiFormat {
  // claude/gemini 不走此字段
  if (kind !== "openai" && kind !== "grok") return "chat";
  const fromEnv = process.env[apiFormatEnvName(kind)];
  return (
    normalizeApiFormat(explicit) ??
    normalizeApiFormat(fromEnv) ??
    "chat"
  );
}
