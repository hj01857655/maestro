/**
 * Agent 原生 function calling 闭环
 */
import { describe, expect, it } from "bun:test";
import { Agent } from "../../src/core/agent";
import { OpenAIProvider } from "../../src/providers/openai";
import type { AgentConfig } from "../../src/types";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const baseConfig: AgentConfig = {
  name: "coder",
  role: "coder",
  provider: "openai",
  model: "gpt",
  systemPrompt: "你是 coder",
  enableTools: true,
};

describe("Agent native tool loop", () => {
  it("toolCalls → 本地执行 → role=tool 回灌 → 最终回答", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-agent-"));
    const file = path.join(tmp, "hello.txt");
    fs.writeFileSync(file, "hello-native", "utf-8");

    const originalFetch = globalThis.fetch;
    let round = 0;
    const bodies: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<
        string,
        unknown
      >;
      bodies.push(body);
      round += 1;
      if (round === 1) {
        return new Response(
          JSON.stringify({
            id: "chat_1",
            model: "gpt",
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_rf",
                      type: "function",
                      function: {
                        name: "read_file",
                        arguments: JSON.stringify({ path: "hello.txt" }),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 2 },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          id: "chat_2",
          model: "gpt",
          choices: [
            {
              message: {
                role: "assistant",
                content: "文件内容是 hello-native",
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 4 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    try {
      const provider = new OpenAIProvider({
        name: "oai",
        baseUrl: "https://api.openai.com",
        apiKey: "sk",
        model: "gpt",
        apiFormat: "chat",
      });
      const agent = new Agent(baseConfig, provider);
      const toolLog: string[] = [];
      const result = await agent.run(
        [{ role: "user", content: "读 hello.txt" }],
        {
          tools: true,
          toolMode: "native",
          toolContext: { cwd: tmp, workspaceRoot: tmp },
          onTool: (info) => toolLog.push(`${info.name}:${info.ok}:${info.callId}`),
        },
      );

      expect(result.content).toBe("文件内容是 hello-native");
      expect(toolLog).toEqual(["read_file:true:call_rf"]);
      expect(round).toBe(2);

      // 第一轮带 tools
      const tools = bodies[0]?.tools as Array<Record<string, unknown>>;
      expect(Array.isArray(tools)).toBe(true);
      expect(
        tools.some(
          (t) =>
            (t as { function?: { name?: string } }).function?.name ===
            "read_file",
        ),
      ).toBe(true);

      // 第二轮含 assistant.tool_calls + tool 回灌
      const msgs = bodies[1]?.messages as Array<Record<string, unknown>>;
      const asst = msgs.find(
        (m) => m.role === "assistant" && Array.isArray(m.tool_calls),
      );
      expect(asst?.tool_calls).toEqual([
        {
          id: "call_rf",
          type: "function",
          function: {
            name: "read_file",
            arguments: JSON.stringify({ path: "hello.txt" }),
          },
          index: 0,
        },
      ]);
      const toolMsg = msgs.find((m) => m.role === "tool");
      expect(toolMsg).toMatchObject({
        role: "tool",
        tool_call_id: "call_rf",
      });
      expect(String(toolMsg?.content)).toContain("hello-native");
    } finally {
      globalThis.fetch = originalFetch;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("无 toolCalls 时回落 ```tool markdown", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-agent-md-"));
    fs.writeFileSync(path.join(tmp, "a.txt"), "via-md", "utf-8");
    const originalFetch = globalThis.fetch;
    let round = 0;
    globalThis.fetch = (async () => {
      round += 1;
      if (round === 1) {
        return new Response(
          JSON.stringify({
            id: "c1",
            model: "gpt",
            choices: [
              {
                message: {
                  role: "assistant",
                  content:
                    '先读一下\n```tool\n{"name":"read_file","arguments":{"path":"a.txt"}}\n```',
                },
                finish_reason: "stop",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          id: "c2",
          model: "gpt",
          choices: [
            {
              message: { role: "assistant", content: "读到 via-md" },
              finish_reason: "stop",
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    try {
      const provider = new OpenAIProvider({
        name: "oai",
        baseUrl: "https://api.openai.com",
        apiKey: "sk",
        model: "gpt",
      });
      const agent = new Agent(baseConfig, provider);
      const result = await agent.run([{ role: "user", content: "读 a.txt" }], {
        tools: true,
        toolContext: { cwd: tmp, workspaceRoot: tmp },
      });
      expect(result.content).toBe("读到 via-md");
      expect(round).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
