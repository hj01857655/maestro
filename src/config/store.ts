/**
 * Maestro 配置持久化。
 *
 * 路径：~/.maestro/config.json
 * 优先级：CLI 显式 > 环境变量 > 配置文件 > 默认
 *
 * 注意：不集成 cc-switch；apiKey 明文落盘由用户自行保护。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ProviderKind } from "../types";

export interface ProviderEntry {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export interface MaestroConfig {
  version: 1;
  providers: Partial<Record<ProviderKind, ProviderEntry>>;
  /** 默认产物目录 */
  outputDir?: string;
  /** 默认 maxGlobalRetries */
  maxGlobalRetries?: number;
}

const CONFIG_VERSION = 1 as const;

export function configDir(): string {
  return path.join(os.homedir(), ".maestro");
}

export function configPath(): string {
  return path.join(configDir(), "config.json");
}

export function defaultConfig(): MaestroConfig {
  return {
    version: CONFIG_VERSION,
    providers: {},
  };
}

export function loadConfig(): MaestroConfig {
  const p = configPath();
  if (!fs.existsSync(p)) return defaultConfig();
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<MaestroConfig>;
    return {
      version: CONFIG_VERSION,
      providers: raw.providers ?? {},
      outputDir: raw.outputDir,
      maxGlobalRetries: raw.maxGlobalRetries,
    };
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(config: MaestroConfig): string {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  const p = configPath();
  const toWrite: MaestroConfig = {
    version: CONFIG_VERSION,
    providers: config.providers ?? {},
    outputDir: config.outputDir,
    maxGlobalRetries: config.maxGlobalRetries,
  };
  fs.writeFileSync(p, JSON.stringify(toWrite, null, 2) + "\n", "utf-8");
  return p;
}

export function setProviderEntry(
  kind: ProviderKind,
  entry: ProviderEntry,
): MaestroConfig {
  const cfg = loadConfig();
  const prev = cfg.providers[kind] ?? {};
  cfg.providers[kind] = {
    ...prev,
    ...stripEmpty(entry),
  };
  // 清理空字段
  const e = cfg.providers[kind]!;
  if (!e.baseUrl && !e.apiKey && !e.model) {
    delete cfg.providers[kind];
  }
  saveConfig(cfg);
  return cfg;
}

export function unsetProvider(kind: ProviderKind): MaestroConfig {
  const cfg = loadConfig();
  delete cfg.providers[kind];
  saveConfig(cfg);
  return cfg;
}

/** 读取配置中某 provider 的覆盖项（可能为空） */
export function getProviderEntry(kind: ProviderKind): ProviderEntry {
  return loadConfig().providers[kind] ?? {};
}

function stripEmpty(entry: ProviderEntry): ProviderEntry {
  const out: ProviderEntry = {};
  if (entry.baseUrl?.trim()) out.baseUrl = entry.baseUrl.trim();
  if (entry.apiKey?.trim()) out.apiKey = entry.apiKey.trim();
  if (entry.model?.trim()) out.model = entry.model.trim();
  return out;
}

/** 摘要展示（隐藏 key） */
export function maskKey(key: string | undefined): string {
  if (!key) return "(未设置)";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
