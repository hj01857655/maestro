/**
 * Maestro TUI 入口
 *
 *   bun src/index.ts tui
 *   bun src/tui/index.tsx
 */

import React from "react";
import { render } from "ink";
import { App } from "./App";

export async function startTui(): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error(
      "Maestro TUI 需要交互式终端（TTY）。请在 Windows Terminal、PowerShell 或 Git Bash 中运行 `bun run tui`。",
    );
  }

  const instance = render(<App />);
  await instance.waitUntilExit();
}

// 直接运行本文件时启动
if (import.meta.main) {
  startTui().catch((err) => {
    console.error("TUI 启动失败:", err);
    process.exit(1);
  });
}
