/**
 * SessionStore — ~/.maestro/sessions
 *
 * 布局:
 *   ~/.maestro/sessions/<sessionId>.json
 *   ~/.maestro/sessions/index.json   （轻量索引，按 updatedAt 倒序）
 *
 * 项目维度：用 cwd 过滤（对齐 Claude 的 project-scoped continue）。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  SessionIndexEntry,
  SessionListOptions,
  SessionRecord,
  SessionStatus,
} from "./types";

const MAX_LOGS = 200;
const MAX_HISTORY = 100;
const INDEX_NAME = "index.json";

export function sessionsDir(): string {
  return path.join(os.homedir(), ".maestro", "sessions");
}

function indexPath(): string {
  return path.join(sessionsDir(), INDEX_NAME);
}

function sessionPath(id: string): string {
  // 防止路径穿越
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe || safe !== id) {
    throw new Error(`非法 session id: ${id}`);
  }
  return path.join(sessionsDir(), `${safe}.json`);
}

function ensureDir(): void {
  fs.mkdirSync(sessionsDir(), { recursive: true });
}

function normalizeCwd(cwd?: string): string {
  return path.resolve(cwd ?? process.cwd());
}

export function newSessionId(): string {
  // 短 id，便于手打 resume
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

export function createSession(input: {
  kind: SessionRecord["kind"];
  name?: string;
  cwd?: string;
  mock?: boolean;
  model?: string;
  lastRequest?: string;
}): SessionRecord {
  const now = new Date().toISOString();
  return {
    id: newSessionId(),
    name: input.name,
    kind: input.kind,
    cwd: normalizeCwd(input.cwd),
    createdAt: now,
    updatedAt: now,
    status: "active",
    mock: input.mock,
    model: input.model,
    lastRequest: input.lastRequest,
    commandHistory: [],
    logs: [],
    steps: [],
  };
}

export function loadSession(id: string): SessionRecord | null {
  try {
    const p = sessionPath(id);
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as SessionRecord;
    if (!raw?.id) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveSession(session: SessionRecord): string {
  ensureDir();
  const next: SessionRecord = {
    ...session,
    updatedAt: new Date().toISOString(),
    commandHistory: (session.commandHistory ?? []).slice(-MAX_HISTORY),
    logs: (session.logs ?? []).slice(-MAX_LOGS),
  };
  const p = sessionPath(next.id);
  fs.writeFileSync(p, JSON.stringify(next, null, 2) + "\n", "utf-8");
  upsertIndex(toIndexEntry(next));
  return p;
}

export function deleteSession(id: string): boolean {
  const p = sessionPath(id);
  let ok = false;
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    ok = true;
  }
  const idx = readIndex().filter((e) => e.id !== id);
  writeIndex(idx);
  return ok;
}

function toIndexEntry(s: SessionRecord): SessionIndexEntry {
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    cwd: s.cwd,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    status: s.status,
    workflowName: s.workflowName,
    lastRequest: s.lastRequest,
    mock: s.mock,
  };
}

function readIndex(): SessionIndexEntry[] {
  const p = indexPath();
  if (!fs.existsSync(p)) return rebuildIndexFromDisk();
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as SessionIndexEntry[];
    return Array.isArray(raw) ? raw : rebuildIndexFromDisk();
  } catch {
    return rebuildIndexFromDisk();
  }
}

function writeIndex(entries: SessionIndexEntry[]): void {
  ensureDir();
  const sorted = [...entries].sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
  );
  fs.writeFileSync(indexPath(), JSON.stringify(sorted, null, 2) + "\n", "utf-8");
}

function upsertIndex(entry: SessionIndexEntry): void {
  const idx = readIndex().filter((e) => e.id !== entry.id);
  idx.push(entry);
  writeIndex(idx);
}

function rebuildIndexFromDisk(): SessionIndexEntry[] {
  ensureDir();
  const dir = sessionsDir();
  const entries: SessionIndexEntry[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json") || name === INDEX_NAME) continue;
    const id = name.slice(0, -".json".length);
    const s = loadSession(id);
    if (s) entries.push(toIndexEntry(s));
  }
  writeIndex(entries);
  return readIndex();
}

export function listSessions(
  opts: SessionListOptions = {},
): SessionIndexEntry[] {
  let entries = readIndex();
  if (opts.cwdOnly) {
    const cwd = normalizeCwd(opts.cwd);
    entries = entries.filter((e) => path.resolve(e.cwd) === cwd);
  } else if (opts.cwd) {
    const cwd = normalizeCwd(opts.cwd);
    entries = entries.filter((e) => path.resolve(e.cwd) === cwd);
  }
  if (opts.query) {
    const q = opts.query.toLowerCase();
    entries = entries.filter((e) => {
      const hay = [e.id, e.name, e.workflowName, e.lastRequest, e.cwd]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }
  // 已按 updatedAt 倒序
  if (opts.limit && opts.limit > 0) {
    return entries.slice(0, opts.limit);
  }
  return entries;
}

/** 当前目录最近会话（continue） */
export function latestSessionForCwd(cwd?: string): SessionRecord | null {
  const entries = listSessions({ cwd: normalizeCwd(cwd), cwdOnly: true, limit: 1 });
  if (entries.length === 0) return null;
  return loadSession(entries[0]!.id);
}

/** 全局最近会话 */
export function latestSession(): SessionRecord | null {
  const entries = listSessions({ limit: 1 });
  if (entries.length === 0) return null;
  return loadSession(entries[0]!.id);
}

/** 按 id 前缀或 name 模糊解析 */
export function resolveSessionRef(ref: string): SessionRecord | null {
  const exact = loadSession(ref);
  if (exact) return exact;

  const entries = listSessions();
  const q = ref.toLowerCase();

  // id 前缀
  const byId = entries.filter((e) => e.id.startsWith(q) || e.id.includes(q));
  if (byId.length === 1) return loadSession(byId[0]!.id);

  // name 精确 / 包含
  const byNameExact = entries.filter(
    (e) => e.name && e.name.toLowerCase() === q,
  );
  if (byNameExact.length === 1) return loadSession(byNameExact[0]!.id);

  const byName = entries.filter(
    (e) =>
      (e.name && e.name.toLowerCase().includes(q)) ||
      (e.workflowName && e.workflowName.toLowerCase().includes(q)) ||
      (e.lastRequest && e.lastRequest.toLowerCase().includes(q)),
  );
  if (byName.length === 1) return loadSession(byName[0]!.id);

  if (byId.length > 1 || byName.length > 1) {
    return null; // 歧义，由调用方 list
  }
  return null;
}

export function touchSession(
  session: SessionRecord,
  patch: Partial<SessionRecord>,
): SessionRecord {
  const next: SessionRecord = {
    ...session,
    ...patch,
    id: session.id,
    createdAt: session.createdAt,
    cwd: patch.cwd ?? session.cwd,
  };
  saveSession(next);
  return next;
}

export function appendSessionLog(
  session: SessionRecord,
  level: SessionLogEntryLevel,
  message: string,
): SessionRecord {
  const logs = [...(session.logs ?? [])];
  logs.push({
    time: new Date().toISOString().slice(11, 19),
    level,
    message,
  });
  return touchSession(session, { logs: logs.slice(-MAX_LOGS) });
}

type SessionLogEntryLevel = "info" | "success" | "error" | "warn";

export function setSessionStatus(
  session: SessionRecord,
  status: SessionStatus,
): SessionRecord {
  return touchSession(session, { status });
}

export function formatSessionLine(e: SessionIndexEntry, cwd?: string): string {
  const when = e.updatedAt.replace("T", " ").slice(0, 19);
  const name = e.name ? ` "${e.name}"` : "";
  const wf = e.workflowName ? ` · ${e.workflowName}` : "";
  const req = e.lastRequest
    ? ` · ${e.lastRequest.slice(0, 40).replace(/\s+/g, " ")}`
    : "";
  const mock = e.mock ? " [mock]" : "";
  const here =
    cwd && path.resolve(e.cwd) === path.resolve(cwd) ? " · cwd" : "";
  return `${e.id}${name}  ${e.status.padEnd(10)} ${when}${mock}${here}${wf}${req}`;
}
