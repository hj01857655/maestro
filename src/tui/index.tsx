/**
 * Maestro TUI 入口
 *
 *   bun src/index.ts tui
 *   bun src/tui/index.tsx
 *   maestro -c / maestro -r <id>
 */

import React from "react";
import { render } from "ink";
import { App } from "./App";
import type { TuiBootstrap } from "./state";
import {
  createSession,
  loadSession,
  saveSession,
  touchSession,
  type SessionRecord,
} from "../session";

export interface StartTuiOptions {
  /** 恢复的会话 */
  session?: SessionRecord;
  /** 新建会话名（-n） */
  name?: string;
  mock?: boolean;
}

function bootstrapFromSession(session: SessionRecord): TuiBootstrap {
  return {
    sessionId: session.id,
    sessionName: session.name,
    commandHistory: session.commandHistory ?? [],
    mock: session.mock,
    workflowName: session.workflowName,
    statusLine: `续会话 ${session.id}${session.name ? ` "${session.name}"` : ""} · ${session.status} · /help`,
    logs: (session.logs ?? []).map((l, i) => ({
      id: i + 1,
      time: l.time,
      level: l.level,
      message: l.message,
    })),
    steps: (session.steps ?? []).map((s) => ({
      name: s.name,
      agent: s.agent,
      status: (s.status as "pending" | "running" | "success" | "failed" | "skipped") || "pending",
      summary: s.summary,
      error: s.error,
      attempts: s.attempts ?? 0,
    })),
  };
}

export async function startTui(opts: StartTuiOptions = {}): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error(
      "Maestro TUI 需要交互式终端（TTY）。请在 Windows Terminal、PowerShell 或 Git Bash 中运行 `maestro`。",
    );
  }

  let session = opts.session;
  if (session) {
    // 续跑：刷新状态为 active
    session = touchSession(session, {
      status: "active",
      name: opts.name ?? session.name,
      kind: "tui",
    });
  } else {
    session = createSession({
      kind: "tui",
      name: opts.name,
      mock: opts.mock,
    });
    saveSession(session);
  }

  const bootstrap = bootstrapFromSession(session);
  const instance = render(
    <App bootstrap={bootstrap} session={session} />,
  );
  await instance.waitUntilExit();

  // 退出时标记 idle（App 内也会写；双写无害）
  const latest = loadSession(session.id);
  if (latest && latest.status === "active") {
    touchSession(latest, { status: "idle" });
  }
}

// 直接运行本文件时启动
if (import.meta.main) {
  startTui().catch((err) => {
    console.error("TUI 启动失败:", err);
    process.exit(1);
  });
}
