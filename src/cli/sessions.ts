/**
 * Session CLI — list / resume / continue / delete
 */

import * as path from "node:path";
import {
  deleteSession,
  formatSessionLine,
  latestSessionForCwd,
  listSessions,
  loadSession,
  resolveSessionRef,
  sessionsDir,
  type SessionRecord,
} from "../session";

export function cmdSessions(args: string[]): number {
  const sub = args[0];

  if (sub === "show") return showCmd(args[1]);
  if (sub === "rm" || sub === "delete" || sub === "remove") return rmCmd(args[1]);
  if (sub === "path") {
    console.log(sessionsDir());
    return 0;
  }
  if (sub === "help" || sub === "--help" || sub === "-h") {
    printSessionsHelp();
    return 0;
  }

  // list / ls / 无参 / --all / query
  if (!sub || sub === "list" || sub === "ls" || sub.startsWith("-")) {
    return listCmd(sub === "list" || sub === "ls" ? args.slice(1) : args);
  }

  // sessions <id|query>
  if (args.length === 1) {
    const exact = resolveSessionRef(sub) ?? loadSession(sub);
    if (exact) return showCmd(sub);
  }
  return listCmd(args);
}

function printSessionsHelp(): void {
  console.log(`用法:
  maestro sessions [list] [--all] [--limit N] [query]
  maestro sessions show <id|name>
  maestro sessions rm <id>
  maestro sessions path

全局:
  maestro -c / --continue          续当前目录最近会话（进 TUI）
  maestro -r / --resume [id|query] 恢复会话
  maestro resume [id|query]        同上
  maestro continue                 同上 -c
`);
}

function listCmd(args: string[]): number {
  let all = false;
  let limit = 20;
  const queryParts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--all" || a === "-a") all = true;
    else if (a === "--limit" || a === "-n") {
      limit = Number(args[++i] ?? 20) || 20;
    } else if (!a.startsWith("-")) {
      queryParts.push(a);
    }
  }
  const query = queryParts.join(" ").trim() || undefined;
  const cwd = process.cwd();
  const entries = listSessions({
    cwdOnly: !all && !query,
    cwd,
    limit,
    query,
  });

  if (entries.length === 0) {
    console.log(
      all
        ? "（无会话）"
        : `当前目录无会话 · 用 maestro sessions --all 查看全部\n目录: ${cwd}`,
    );
    return 0;
  }

  console.log(
    all || query
      ? `会话（${entries.length}）· ${sessionsDir()}`
      : `当前目录会话（${entries.length}）· ${cwd}`,
  );
  for (const e of entries) {
    console.log(`  ${formatSessionLine(e, cwd)}`);
  }
  return 0;
}

function showCmd(ref: string | undefined): number {
  if (!ref) {
    console.log("用法: maestro sessions show <id|name>");
    return 1;
  }
  const s = resolveSessionRef(ref) ?? loadSession(ref);
  if (!s) {
    const hits = listSessions({ query: ref, limit: 10 });
    if (hits.length === 0) {
      console.error(`未找到会话: ${ref}`);
      return 1;
    }
    console.error(`未精确匹配 "${ref}"，候选:`);
    for (const e of hits) console.error(`  ${formatSessionLine(e)}`);
    return 1;
  }
  printSessionDetail(s);
  return 0;
}

function rmCmd(ref: string | undefined): number {
  if (!ref) {
    console.log("用法: maestro sessions rm <id>");
    return 1;
  }
  const s = resolveSessionRef(ref) ?? loadSession(ref);
  if (!s) {
    console.error(`未找到会话: ${ref}`);
    return 1;
  }
  deleteSession(s.id);
  console.log(`✅ 已删除会话 ${s.id}`);
  return 0;
}

export function printSessionDetail(s: SessionRecord): void {
  console.log(`id:       ${s.id}`);
  if (s.name) console.log(`name:     ${s.name}`);
  console.log(`kind:     ${s.kind}`);
  console.log(`status:   ${s.status}`);
  console.log(`cwd:      ${s.cwd}`);
  console.log(`created:  ${s.createdAt}`);
  console.log(`updated:  ${s.updatedAt}`);
  if (s.mock) console.log(`mock:     true`);
  if (s.model) console.log(`model:    ${s.model}`);
  if (s.workflowName) console.log(`workflow: ${s.workflowName}`);
  if (s.lastRequest) console.log(`request:  ${s.lastRequest}`);
  if (s.artifactDir) console.log(`artifacts:${s.artifactDir}`);
  if (s.steps?.length) {
    console.log("steps:");
    for (const st of s.steps) {
      console.log(
        `  - ${st.name} [${st.status}] ${st.agent}${st.summary ? ` · ${st.summary.slice(0, 60)}` : ""}`,
      );
    }
  }
  if (s.commandHistory?.length) {
    console.log(`history:  ${s.commandHistory.length} commands`);
  }
}

/** 解析 continue/resume 目标会话 */
export function resolveResumeTarget(opts: {
  continue?: boolean;
  resume?: boolean | string;
}): {
  session: SessionRecord | null;
  error?: string;
  ambiguous?: SessionRecord[];
} {
  if (opts.continue) {
    const s = latestSessionForCwd();
    if (!s) {
      return {
        session: null,
        error: `当前目录无会话可 continue: ${process.cwd()}`,
      };
    }
    return { session: s };
  }

  if (opts.resume === true) {
    const s = latestSessionForCwd() ?? null;
    if (s) return { session: s };
    const all = listSessions({ limit: 10 });
    if (all.length === 0) {
      return { session: null, error: "没有可 resume 的会话" };
    }
    return {
      session: null,
      error: "请指定会话 id，或在该目录下先跑一次工作流",
      ambiguous: all
        .map((e) => loadSession(e.id))
        .filter((x): x is SessionRecord => Boolean(x)),
    };
  }

  if (typeof opts.resume === "string") {
    const s = resolveSessionRef(opts.resume);
    if (s) return { session: s };
    const hits = listSessions({ query: opts.resume, limit: 10 });
    if (hits.length === 0) {
      return { session: null, error: `未找到会话: ${opts.resume}` };
    }
    return {
      session: null,
      error: `会话引用不唯一: ${opts.resume}`,
      ambiguous: hits
        .map((e) => loadSession(e.id))
        .filter((x): x is SessionRecord => Boolean(x)),
    };
  }

  return { session: null };
}

export function printResumeHint(session: SessionRecord): void {
  const rel =
    path.resolve(session.cwd) === path.resolve(process.cwd())
      ? "当前目录"
      : session.cwd;
  console.log(
    `↩ resume ${session.id}${session.name ? ` "${session.name}"` : ""} · ${session.status} · ${rel}`,
  );
  if (session.workflowName) console.log(`  workflow: ${session.workflowName}`);
  if (session.lastRequest) {
    console.log(`  request:  ${session.lastRequest.slice(0, 80)}`);
  }
  if (session.artifactDir) console.log(`  artifacts:${session.artifactDir}`);
}
