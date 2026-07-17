/**
 * 内置 Tools：read_file / write_file / list_dir / run_cmd
 *
 * 安全边界：
 * - 路径必须落在 workspaceRoot 内
 * - run_cmd 禁 shell 元字符（简单白名单式拆分）
 * - 文件大小上限
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { Tool, ToolContext, ToolResult } from "./types";

const MAX_READ_BYTES = 512 * 1024;
const MAX_WRITE_BYTES = 512 * 1024;
const MAX_LIST = 500;

function resolveSafe(relOrAbs: string, ctx: ToolContext): string {
  const root = path.resolve(ctx.workspaceRoot);
  const target = path.isAbsolute(relOrAbs)
    ? path.resolve(relOrAbs)
    : path.resolve(ctx.cwd, relOrAbs);
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`路径越界 workspace: ${relOrAbs}`);
  }
  return target;
}

function ok(content: string, data?: unknown): ToolResult {
  return { ok: true, content, data };
}

function fail(error: string): ToolResult {
  return { ok: false, content: error, error };
}

export const readFileTool: Tool = {
  definition: {
    name: "read_file",
    description: "读取工作区内文本文件内容",
    parameters: [
      {
        name: "path",
        type: "string",
        description: "相对或绝对路径（须在 workspace 内）",
        required: true,
      },
    ],
  },
  async execute(args, ctx) {
    try {
      const p = resolveSafe(String(args.path ?? ""), ctx);
      if (!fs.existsSync(p)) return fail(`文件不存在: ${p}`);
      const stat = fs.statSync(p);
      if (!stat.isFile()) return fail(`不是文件: ${p}`);
      if (stat.size > MAX_READ_BYTES) {
        return fail(`文件过大 (${stat.size} > ${MAX_READ_BYTES})`);
      }
      const content = fs.readFileSync(p, "utf-8");
      return ok(content, { path: p, bytes: Buffer.byteLength(content) });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  },
};

export const writeFileTool: Tool = {
  definition: {
    name: "write_file",
    description: "写入工作区内文本文件（自动创建父目录）",
    parameters: [
      { name: "path", type: "string", description: "目标路径", required: true },
      { name: "content", type: "string", description: "文件内容", required: true },
    ],
  },
  async execute(args, ctx) {
    try {
      const p = resolveSafe(String(args.path ?? ""), ctx);
      const content = String(args.content ?? "");
      if (Buffer.byteLength(content) > MAX_WRITE_BYTES) {
        return fail(`内容过大 (> ${MAX_WRITE_BYTES})`);
      }
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content, "utf-8");
      return ok(`已写入 ${p} (${Buffer.byteLength(content)} bytes)`, { path: p });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  },
};

export const listDirTool: Tool = {
  definition: {
    name: "list_dir",
    description: "列出工作区内目录内容",
    parameters: [
      {
        name: "path",
        type: "string",
        description: "目录路径，默认 .",
        required: false,
      },
    ],
  },
  async execute(args, ctx) {
    try {
      const p = resolveSafe(String(args.path ?? "."), ctx);
      if (!fs.existsSync(p)) return fail(`目录不存在: ${p}`);
      const entries = fs.readdirSync(p, { withFileTypes: true }).slice(0, MAX_LIST);
      const lines = entries.map((e) => {
        const tag = e.isDirectory() ? "dir" : e.isFile() ? "file" : "other";
        return `${tag.padEnd(5)} ${e.name}`;
      });
      return ok(lines.join("\n") || "(空目录)", {
        path: p,
        count: entries.length,
      });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  },
};

export const runCmdTool: Tool = {
  definition: {
    name: "run_cmd",
    description: "在工作区执行简单命令（无 shell 管道/重定向）",
    parameters: [
      {
        name: "command",
        type: "string",
        description: "可执行文件名，如 bun / node / git",
        required: true,
      },
      {
        name: "args",
        type: "string",
        description: "空格分隔参数（可选）",
        required: false,
      },
    ],
  },
  async execute(args, ctx) {
    try {
      const command = String(args.command ?? "").trim();
      if (!command) return fail("command 不能为空");
      // 禁 shell 元字符
      if (/[|&;<>`$\\]/.test(command)) {
        return fail("command 含非法字符");
      }
      const rawArgs = String(args.args ?? "").trim();
      if (/[|&;<>`$\\]/.test(rawArgs)) {
        return fail("args 含非法字符（不支持管道/重定向）");
      }
      const argv = rawArgs ? splitArgs(rawArgs) : [];
      const timeout = ctx.commandTimeoutMs ?? 30_000;

      const result = await spawnCapture(command, argv, ctx.cwd, timeout);
      const text = [
        `$ ${command}${argv.length ? " " + argv.join(" ") : ""}`,
        result.stdout,
        result.stderr ? `[stderr]\n${result.stderr}` : "",
        `[exit ${result.code}]`,
      ]
        .filter(Boolean)
        .join("\n");
      return {
        ok: result.code === 0,
        content: text.slice(0, 32_000),
        data: result,
        error: result.code === 0 ? undefined : `exit ${result.code}`,
      };
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  },
};

function splitArgs(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: '"' | "'" | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      continue;
    }
    if (/\s/.test(c)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function spawnCapture(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`命令超时 (${timeoutMs}ms)`));
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

export const BUILTIN_TOOLS: Tool[] = [
  readFileTool,
  writeFileTool,
  listDirTool,
  runCmdTool,
];

export function getBuiltinTool(name: string): Tool | undefined {
  return BUILTIN_TOOLS.find((t) => t.definition.name === name);
}
