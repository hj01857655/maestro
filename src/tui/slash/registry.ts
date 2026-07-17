/**
 * Slash 命令注册表。
 *
 * 对照 Grok Build `CommandRegistry` + `SlashCommand`：
 * - 命令对象声明式注册
 * - 统一 lookup / list / help
 * - run() 返回 Action 或 Effect，不直接做副作用
 */

import type { TuiAction, TuiEffect } from "../actions";
import type { TuiState } from "../state";

export interface SlashContext {
  state: TuiState;
  args: string[];
  raw: string;
}

export type SlashResult =
  | { kind: "actions"; actions: TuiAction[] }
  | { kind: "effect"; effect: TuiEffect; actions?: TuiAction[] }
  | { kind: "message"; level: "info" | "success" | "error" | "warn"; message: string };

export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  usage: string;
  /** 是否在运行中仍可执行 */
  allowWhileRunning?: boolean;
  run(ctx: SlashContext): SlashResult;
}

export class CommandRegistry {
  private commands: SlashCommand[] = [];
  private byKey = new Map<string, SlashCommand>();

  register(cmd: SlashCommand): void {
    this.commands.push(cmd);
    const keys = [cmd.name, ...(cmd.aliases ?? [])].map((k) => k.toLowerCase());
    for (const key of keys) {
      if (this.byKey.has(key)) {
        throw new Error(`Slash 命令冲突: /${key}`);
      }
      this.byKey.set(key, cmd);
    }
  }

  registerAll(cmds: SlashCommand[]): void {
    for (const cmd of cmds) this.register(cmd);
  }

  get(name: string): SlashCommand | undefined {
    return this.byKey.get(name.toLowerCase().replace(/^\//, ""));
  }

  list(): SlashCommand[] {
    return [...this.commands];
  }

  /** 前缀匹配（用于未来 dropdown） */
  match(query: string): SlashCommand[] {
    const q = query.toLowerCase().replace(/^\//, "");
    if (!q) return this.list();
    return this.list().filter(
      (c) =>
        c.name.startsWith(q) ||
        (c.aliases ?? []).some((a) => a.startsWith(q)),
    );
  }

  helpText(): string[] {
    const lines = this.list().map((c) => {
      const pad = c.usage.padEnd(34);
      return `${pad}${c.description}`;
    });
    return [
      ...lines,
      "",
      "示例:",
      "  /run src/examples/demo-mock.yaml --mock",
      "  /stop",
    ];
  }
}

export function parseSlashLine(raw: string): { name: string; args: string[] } | null {
  const line = raw.trim();
  if (!line.startsWith("/")) return null;
  const parts = line.slice(1).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { name: "", args: [] };
  return { name: parts[0].toLowerCase(), args: parts.slice(1) };
}
