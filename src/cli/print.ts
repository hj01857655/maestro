/**
 * Headless print / ask — 对齐 Claude `-p/--print`。
 *
 *   maestro -p "解释这段代码" [--role coder] [--model xxx] [--mock]
 *   maestro print "..."
 *   echo "hi" | maestro -p
 */

import { Agent } from "../core/agent";
import { createProvider, apiKeyEnvName } from "../providers";
import { MockProvider } from "../testing/MockProvider";
import { loadConfig } from "../config/store";
import { BUILTIN_ROLES } from "../roles";
import type { AgentConfig, ProviderKind, ProviderResult } from "../types";
import {
  createSession,
  saveSession,
  setSessionStatus,
  touchSession,
} from "../session";
import type { OutputFormat } from "./args";

export interface PrintOptions {
  prompt: string;
  role?: string;
  model?: string;
  mock?: boolean;
  verbose?: boolean;
  outputFormat?: OutputFormat;
  name?: string;
  /** 续跑时复用 session id */
  sessionId?: string;
  tools?: boolean;
}

function resolveRole(roleName?: string): AgentConfig {
  const name = roleName ?? "coder";
  const role = BUILTIN_ROLES[name];
  if (!role) {
    const known = Object.keys(BUILTIN_ROLES).join(", ");
    throw new Error(`未知角色 "${name}" · 可用: ${known}`);
  }
  return { ...role, name };
}

export async function runPrint(opts: PrintOptions): Promise<number> {
  const prompt = opts.prompt.trim();
  if (!prompt) {
    console.error('用法: maestro -p "prompt" [--role coder] [--model m] [--mock]');
    return 1;
  }

  const role = resolveRole(opts.role);
  const cfg = loadConfig();
  const isMock = Boolean(opts.mock);

  const provider = isMock
    ? new MockProvider({
        name: `${role.provider}-mock`,
        model: opts.model ?? `${role.provider}-mock`,
      })
    : createProvider(role.provider as ProviderKind, {
        roleModel: role.model,
        model: opts.model,
      });

  if (!isMock) {
    const envName = apiKeyEnvName(role.provider);
    if (!process.env[envName] && !cfg.providers[role.provider]?.apiKey) {
      console.error(`⚠ 未设置 ${envName} 且配置无 apiKey，调用可能失败`);
    }
  }

  if (opts.verbose) {
    console.error(
      `[maestro] print role=${role.name} provider=${role.provider} model=${provider.model} mock=${isMock}`,
    );
  }

  const session = createSession({
    kind: "print",
    name: opts.name,
    mock: isMock,
    model: opts.model ?? provider.model,
    lastRequest: prompt,
  });
  if (opts.sessionId) session.id = opts.sessionId;
  session.status = "active";
  session.workflowName = `print:${role.name}`;
  saveSession(session);

  const agent = new Agent(
    {
      ...role,
      model: opts.model ?? role.model,
      enableTools: opts.tools ?? false,
    },
    provider,
  );

  let result: ProviderResult;
  try {
    result = await agent.run([{ role: "user", content: prompt }], {
      tools: opts.tools ?? false,
      stream: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setSessionStatus(session, "failed");
    touchSession(session, {
      note: message,
      logs: [
        ...(session.logs ?? []),
        {
          time: new Date().toISOString().slice(11, 19),
          level: "error",
          message,
        },
      ],
    });
    if (opts.outputFormat === "json") {
      console.log(
        JSON.stringify(
          {
            ok: false,
            error: message,
            sessionId: session.id,
            role: role.name,
            model: provider.model,
          },
          null,
          2,
        ),
      );
    } else {
      console.error(`❌ ${message}`);
    }
    return 1;
  }

  setSessionStatus(session, "completed");
  touchSession(
    { ...session, status: "completed" },
    {
      status: "completed",
      steps: [
        {
          name: "print",
          agent: role.name,
          status: "success",
          summary: result.content.slice(0, 200),
        },
      ],
      logs: [
        ...(session.logs ?? []),
        {
          time: new Date().toISOString().slice(11, 19),
          level: "success",
          message: `print ok · model=${result.model || provider.model}`,
        },
      ],
    },
  );

  if (opts.outputFormat === "json") {
    console.log(
      JSON.stringify(
        {
          ok: true,
          sessionId: session.id,
          role: role.name,
          provider: role.provider,
          model: result.model || provider.model,
          content: result.content,
          usage: result.usage,
          status: result.status,
          toolCalls: result.toolCalls,
        },
        null,
        2,
      ),
    );
  } else {
    process.stdout.write(result.content);
    if (!result.content.endsWith("\n")) process.stdout.write("\n");
  }

  if (opts.verbose) {
    console.error(
      `[maestro] session=${session.id} model=${result.model || provider.model}`,
    );
  }

  return 0;
}

/** 从 stdin 读完 prompt（非 TTY 管道） */
export async function readStdinText(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}
