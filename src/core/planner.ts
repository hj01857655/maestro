/**
 * Planner — 从自然语言需求生成 WorkflowConfig。
 *
 * 两种路径：
 * 1. 模板流水线（无需模型）：research → design → code → review
 * 2. 模型生成 YAML/JSON（可选 Agent）
 */

import type { AgentConfig, StepConfig, WorkflowConfig } from "../types";
import { validateWorkflowConfig } from "./validate";
import type { Agent } from "./agent";

export interface PlanOptions {
  /** 工作流名称 */
  name?: string;
  /** 产物目录 */
  outputDir?: string;
  /** 是否包含 research 步 */
  research?: boolean;
  /** 是否包含 tester 步 */
  test?: boolean;
  /** maxGlobalRetries */
  maxGlobalRetries?: number;
  /** 用户原始需求（注入各 step prompt） */
  request: string;
}

/** 标准软件工程流水线模板（确定性，不依赖模型） */
export function planFromTemplate(opts: PlanOptions): WorkflowConfig {
  const name = opts.name ?? "auto-pipeline";
  const req = opts.request.trim() || "（未提供需求）";
  const steps: StepConfig[] = [];

  if (opts.research !== false) {
    steps.push({
      name: "research",
      agent: "researcher",
      prompt: `用户需求：\n${req}\n\n请搜索相关最佳实践、风险与参考实现。`,
    });
  }

  steps.push({
    name: "design",
    agent: "designer",
    inputs: opts.research !== false ? ["research"] : undefined,
    prompt:
      opts.research !== false
        ? `用户需求：\n${req}\n\n研究结论：\n{{ research }}\n\n请给出架构设计与接口定义。`
        : `用户需求：\n${req}\n\n请给出架构设计与接口定义。`,
  });

  steps.push({
    name: "code",
    agent: "coder",
    inputs: ["design"],
    maxRetries: 1,
    prompt: `按设计实现代码：\n{{ design }}\n\n请用 markdown 代码块输出完整文件，第一行注释写路径。`,
  });

  if (opts.test) {
    steps.push({
      name: "test",
      agent: "tester",
      inputs: ["code"],
      prompt: `为以下代码编写测试：\n{{ code }}\n\n覆盖正常路径与边界情况。`,
    });
  }

  steps.push({
    name: "review",
    agent: "reviewer",
    inputs: opts.test ? ["code", "design", "test"] : ["code", "design"],
    prompt: `审查实现是否符合设计。\n设计：\n{{ design }}\n代码：\n{{ code }}${
      opts.test ? "\n测试：\n{{ test }}" : ""
    }`,
  });

  return {
    name,
    description: `由 Planner 模板生成 · ${req.slice(0, 80)}`,
    maxGlobalRetries: opts.maxGlobalRetries ?? 0,
    outputDir: opts.outputDir,
    steps,
  };
}

/**
 * 尝试从模型输出解析 WorkflowConfig。
 * 支持：```yaml / ```json / 纯 JSON。
 */
export function parseWorkflowFromModel(text: string): WorkflowConfig | null {
  // fenced block
  const fence = text.match(/```(?:ya?ml|json)\s*\n([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : text.trim();

  // JSON first
  try {
    const jsonStart = body.indexOf("{");
    const jsonEnd = body.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const obj = JSON.parse(body.slice(jsonStart, jsonEnd + 1));
      const v = validateWorkflowConfig(obj);
      if (v.ok && v.config) return v.config;
    }
  } catch {
    // fallthrough
  }

  // YAML via dynamic import would be heavy; try minimal line-based? Use JSON only for model path.
  // Caller can pass yaml through validate after external parse.
  return null;
}

export async function planWithAgent(
  agent: Agent,
  opts: PlanOptions,
): Promise<{ config: WorkflowConfig; raw: string; source: "model" | "template-fallback" }> {
  const prompt = `将以下需求拆解为 Maestro 工作流 JSON（不要 markdown 说明，只输出 JSON 对象）：
{
  "name": "工作流名",
  "steps": [
    { "name": "step名", "agent": "planner|researcher|designer|coder|reviewer|tester", "prompt": "...", "inputs": ["上游step"] }
  ]
}

规则：
- agent 只能是预置角色之一
- 用 inputs 表达依赖，禁止循环
- prompt 里用 {{ stepName }} 引用上游输出
- 至少包含 design → code → review

用户需求：
${opts.request}`;

  try {
    const result = await agent.run([{ role: "user", content: prompt }]);
    const parsed = parseWorkflowFromModel(result.content);
    if (parsed) {
      if (opts.outputDir) parsed.outputDir = opts.outputDir;
      if (opts.maxGlobalRetries != null) parsed.maxGlobalRetries = opts.maxGlobalRetries;
      if (opts.name) parsed.name = opts.name;
      return { config: parsed, raw: result.content, source: "model" };
    }
  } catch {
    // fallback
  }

  return {
    config: planFromTemplate(opts),
    raw: "",
    source: "template-fallback",
  };
}

/** Planner 角色配置快捷引用 */
export function plannerAgentConfig(): AgentConfig {
  return {
    name: "planner",
    role: "planner",
    provider: "claude",
    model: "claude-sonnet-4-6",
    systemPrompt:
      "你是 Planner。只输出合法 JSON 工作流定义，不要解释。agent 仅限 planner/researcher/designer/coder/reviewer/tester。",
    temperature: 0.2,
  };
}
