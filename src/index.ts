/**
 * Maestro CLI 入口。
 *
 * 用法:
 *   maestro tui
 *   maestro run <workflow.yaml> [--mock]
 *   maestro plan "<需求>" [--mock] [--out file.yaml] [--run]
 *   maestro validate <workflow.yaml>
 *   maestro config [show|set|path]
 *   maestro list-roles
 *   maestro register <kind> <name> <url> <key> [model]
 */

import { Orchestrator } from "./core/orchestrator";
import { Workflow } from "./core/workflow";
import { validateWorkflowConfig } from "./core/validate";
import { planFromTemplate, planWithAgent, plannerAgentConfig } from "./core/planner";
import { Agent } from "./core/agent";
import {
  createProvider,
  apiKeyEnvName,
  DEFAULT_BASE_URLS,
} from "./providers";
import { MockProvider } from "./testing/MockProvider";
import { BUILTIN_ROLES } from "./roles";
import {
  configPath,
  loadConfig,
  setProviderEntry,
  maskKey,
  type MaestroConfig,
} from "./config/store";
import type { ProviderKind, WorkflowConfig } from "./types";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { stringify as stringifyYaml } from "yaml";

function log(msg: string) {
  console.log(msg);
}

function printHelp() {
  console.log(`
Maestro 🎼 — 多模型 Agent 编排平台

用法:
  maestro tui                                 启动交互式终端界面
  maestro run <workflow.yaml> [--mock]        运行工作流
  maestro plan "<需求>" [选项]                 从需求生成流水线
      --out <file.yaml>   写出 YAML
      --run               生成后立即执行
      --mock              与 --run 联用
      --llm               用 Planner 模型生成（失败回落模板）
      --no-research       跳过 research 步（仅模板）
      --test              加入 tester 步（仅模板）
  maestro validate <workflow.yaml>            校验 YAML + 环检测
  maestro config show                         显示 ~/.maestro/config.json
  maestro config path                         打印配置路径
  maestro config set <kind> key=val ...       写入 provider（baseUrl/apiKey/model/apiFormat）
  maestro list-roles                          列出预置角色
  maestro register <kind> <name> <url> <key> [model]  会话内构造（不持久化）

环境变量（优先于配置文件）:
  CLAUDE_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY / GROK_API_KEY
  *_BASE_URL  *_MODEL

默认 baseUrl:
  claude  ${DEFAULT_BASE_URLS.claude}
  openai  ${DEFAULT_BASE_URLS.openai}
  gemini  ${DEFAULT_BASE_URLS.gemini}
  grok    ${DEFAULT_BASE_URLS.grok}

示例:
  maestro tui
  maestro run src/examples/demo-mock.yaml --mock
  maestro plan "实现用户登录" --out .maestro/login.yaml --run --mock
  maestro config set claude apiKey=sk-ant-xxx model=claude-sonnet-4-6
  maestro validate src/examples/dev-workflow.yaml
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printHelp();
    return;
  }

  const command = args[0];

  switch (command) {
    case "tui": {
      const { startTui } = await import("./tui");
      await startTui();
      break;
    }
    case "run": {
      const isMock = args.includes("--mock");
      const wfPath = args.slice(1).find((a) => !a.startsWith("--"));
      await runWorkflow(wfPath, isMock);
      break;
    }
    case "plan": {
      await cmdPlan(args.slice(1));
      break;
    }
    case "validate": {
      cmdValidate(args[1]);
      break;
    }
    case "config": {
      cmdConfig(args.slice(1));
      break;
    }
    case "list-roles":
      listRoles();
      break;
    case "register":
      await registerProvider(args.slice(1));
      break;
    default:
      printHelp();
  }
}

function listRoles() {
  console.log("\n📋 预置角色:\n");
  for (const [name, role] of Object.entries(BUILTIN_ROLES)) {
    console.log(`  ${name.padEnd(12)} → ${role.provider.padEnd(8)} ${role.model}`);
    console.log(`  ${" ".repeat(14)} ${role.systemPrompt.slice(0, 60)}...`);
    console.log();
  }
}

function cmdValidate(workflowPath: string | undefined) {
  if (!workflowPath) {
    console.log("用法: maestro validate <workflow.yaml>");
    return;
  }
  const filePath = path.resolve(workflowPath);
  if (!fs.existsSync(filePath)) {
    console.log(`文件不存在: ${filePath}`);
    process.exitCode = 1;
    return;
  }
  const raw = parseYaml(fs.readFileSync(filePath, "utf-8"));
  const result = validateWorkflowConfig(raw);
  for (const issue of result.issues) {
    const icon = issue.level === "error" ? "❌" : "⚠";
    console.log(`${icon} [${issue.path}] ${issue.message}`);
  }
  if (result.ok) {
    console.log(`\n✅ 校验通过 · ${result.config!.steps.length} 个步骤 · ${result.config!.name}`);
  } else {
    console.log(`\n❌ 校验失败 · ${result.issues.filter((i) => i.level === "error").length} 个错误`);
    process.exitCode = 1;
  }
}

function cmdConfig(args: string[]) {
  const sub = args[0] ?? "show";
  if (sub === "path") {
    console.log(configPath());
    return;
  }
  if (sub === "show" || sub === "list") {
    const cfg = loadConfig();
    console.log(`配置: ${configPath()}\n`);
    console.log(JSON.stringify(redactConfig(cfg), null, 2));
    return;
  }
  if (sub === "set") {
    // config set <kind> key=val key=val
    const kind = args[1] as ProviderKind;
    if (!kind || !["claude", "openai", "gemini", "grok"].includes(kind)) {
      console.log(
        "用法: maestro config set <claude|openai|gemini|grok> apiKey=... [baseUrl=...] [model=...] [apiFormat=chat|responses]",
      );
      return;
    }
    const entry: {
      apiKey?: string;
      baseUrl?: string;
      model?: string;
      apiFormat?: "chat" | "responses";
    } = {};
    for (const pair of args.slice(2)) {
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const k = pair.slice(0, eq);
      const v = pair.slice(eq + 1);
      if (k === "apiKey" || k === "key") entry.apiKey = v;
      else if (k === "baseUrl" || k === "url") entry.baseUrl = v;
      else if (k === "model") entry.model = v;
      else if (k === "apiFormat" || k === "format") {
        const f = v.trim().toLowerCase();
        if (
          f === "chat" ||
          f === "chat_completions" ||
          f === "openai_chat"
        ) {
          entry.apiFormat = "chat";
        } else if (
          f === "responses" ||
          f === "openai_responses" ||
          f === "response"
        ) {
          entry.apiFormat = "responses";
        } else {
          console.log(`未知 apiFormat=${v} · 可用: chat | responses`);
          return;
        }
      }
    }
    if (!entry.apiKey && !entry.baseUrl && !entry.model && !entry.apiFormat) {
      console.log("至少提供 apiKey= / baseUrl= / model= / apiFormat= 之一");
      return;
    }
    setProviderEntry(kind, entry);
    console.log(`✅ 已写入 ${kind} → ${configPath()}`);
    console.log(`   apiKey: ${maskKey(loadConfig().providers[kind]?.apiKey)}`);
    console.log(`   baseUrl: ${loadConfig().providers[kind]?.baseUrl ?? "(默认)"}`);
    console.log(`   model: ${loadConfig().providers[kind]?.model ?? "(默认)"}`);
    console.log(
      `   apiFormat: ${loadConfig().providers[kind]?.apiFormat ?? "(chat)"}`,
    );
    return;
  }
  console.log("用法: maestro config show | path | set <kind> key=val ...");
}

function redactConfig(cfg: MaestroConfig): MaestroConfig {
  const providers: MaestroConfig["providers"] = {};
  for (const [k, v] of Object.entries(cfg.providers)) {
    if (!v) continue;
    providers[k as ProviderKind] = {
      ...v,
      apiKey: v.apiKey ? maskKey(v.apiKey) : undefined,
    };
  }
  return { ...cfg, providers };
}

async function cmdPlan(args: string[]) {
  const requestParts: string[] = [];
  let outFile: string | undefined;
  let doRun = false;
  let isMock = false;
  let research = true;
  let test = false;
  let useLlm = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--out" || a === "-o") {
      outFile = args[++i];
    } else if (a === "--run") {
      doRun = true;
    } else if (a === "--mock") {
      isMock = true;
    } else if (a === "--no-research") {
      research = false;
    } else if (a === "--test") {
      test = true;
    } else if (a === "--llm") {
      useLlm = true;
    } else if (!a.startsWith("--")) {
      requestParts.push(a);
    }
  }

  const request = requestParts.join(" ").trim();
  if (!request) {
    console.log(
      '用法: maestro plan "<需求>" [--out file.yaml] [--run] [--mock] [--llm]',
    );
    return;
  }

  const cfg = loadConfig();
  const planOpts = {
    request,
    research,
    test,
    outputDir: cfg.outputDir ?? ".maestro/runs",
    maxGlobalRetries: cfg.maxGlobalRetries ?? 0,
    name: `plan-${slug(request).slice(0, 32)}`,
  };

  let config;
  let source: "template" | "model" | "template-fallback" = "template";

  if (useLlm) {
    const role = plannerAgentConfig();
    const provider = isMock
      ? new MockProvider({ name: "planner-mock", model: "planner-mock" })
      : createProvider(role.provider, { roleModel: role.model });
    if (!isMock) {
      const envName = apiKeyEnvName(role.provider);
      if (!process.env[envName] && !cfg.providers[role.provider]?.apiKey) {
        console.log(`⚠ 无 ${envName}，--llm 将回落模板`);
      }
    }
    const agent = new Agent({ ...role, enableTools: false }, provider);
    const planned = await planWithAgent(agent, planOpts);
    config = planned.config;
    source = planned.source;
    console.log(
      source === "model"
        ? "\n🧠 Planner 模型生成工作流"
        : "\n📋 Planner 回落模板流水线",
    );
  } else {
    config = planFromTemplate(planOpts);
    console.log("\n📋 Planner 模板流水线");
  }

  const yamlText = stringifyYaml(config);
  console.log("\n📄 生成工作流:\n");
  console.log(yamlText);

  if (outFile) {
    const p = path.resolve(outFile);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, yamlText, "utf-8");
    console.log(`✅ 已写出: ${p}`);
  }

  if (doRun) {
    if (outFile) {
      await runWorkflow(outFile, isMock, request);
    } else {
      await runWorkflowConfig(config, isMock, request);
    }
  }
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

async function registerProvider(args: string[]) {
  if (args.length < 4) {
    console.log("用法: maestro register <kind> <name> <url> <key> [model]");
    console.log("  kind: claude | openai | gemini | grok");
    console.log("  提示: 持久化请用 maestro config set <kind> apiKey=...");
    return;
  }

  const [kindRaw, name, baseUrl, apiKey, model] = args;
  const kind = kindRaw as ProviderKind;
  if (!["claude", "openai", "gemini", "grok"].includes(kind)) {
    console.log(`未知 Provider kind: ${kind}`);
    return;
  }

  const provider = createProvider(kind, {
    name,
    baseUrl,
    apiKey,
    model,
  });

  console.log(`\n✅ 已构造 ${kind} provider: ${name}`);
  console.log(`   Model: ${provider.model}`);
  console.log(`   URL:   ${provider.config.baseUrl}`);
  console.log(`   ⚠ 仅在当前会话有效（未持久化）· 持久化请用 config set`);
}

async function runWorkflow(
  workflowPath: string | undefined,
  isMock: boolean,
  request = "CLI 任务",
) {
  if (!workflowPath) {
    console.log("请指定工作流文件路径");
    return;
  }

  const filePath = path.resolve(workflowPath);
  if (!fs.existsSync(filePath)) {
    console.log(`文件不存在: ${filePath}`);
    return;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const raw = parseYaml(content);
  const validated = validateWorkflowConfig(raw);
  for (const issue of validated.issues) {
    const icon = issue.level === "error" ? "❌" : "⚠";
    console.log(`${icon} [${issue.path}] ${issue.message}`);
  }
  if (!validated.ok || !validated.config) {
    console.log("工作流校验失败，中止");
    process.exitCode = 1;
    return;
  }

  await runWorkflowConfig(validated.config, isMock, request);
}

async function runWorkflowConfig(
  config: WorkflowConfig,
  isMock: boolean,
  request: string,
) {
  console.log(`\n📄 加载工作流: ${config.name}`);
  if (isMock) {
    console.log(`   🎭 Mock 模式 — 所有模型使用模拟响应\n`);
  }

  const fileCfg = loadConfig();
  const orchestrator = new Orchestrator({
    maxGlobalRetries: config.maxGlobalRetries ?? fileCfg.maxGlobalRetries ?? 1,
    outputDir: config.outputDir ?? fileCfg.outputDir,
    onLog: log,
  });

  if (isMock) {
    const allKinds = new Set<ProviderKind>();
    for (const step of config.steps) {
      const role = BUILTIN_ROLES[step.agent];
      if (role) allKinds.add(role.provider);
    }
    for (const kind of allKinds) {
      orchestrator.registerProvider(
        kind,
        new MockProvider({
          name: kind,
          model: `${kind}-mock`,
        }),
      );
    }
  } else {
    const registeredProviders = new Set<ProviderKind>();
    for (const step of config.steps) {
      const role = BUILTIN_ROLES[step.agent];
      const providerKind = role?.provider ?? "claude";

      if (!registeredProviders.has(providerKind)) {
        registeredProviders.add(providerKind);
        const envName = apiKeyEnvName(providerKind);
        if (!process.env[envName] && !loadConfig().providers[providerKind]?.apiKey) {
          console.log(`⚠ 未设置 ${envName} 且配置文件无 apiKey，此 provider 调用将失败`);
        }
        const provider = createProvider(providerKind, {
          roleModel: role?.model,
        });
        orchestrator.registerProvider(providerKind, provider);
        console.log(
          `   📡 ${providerKind} → ${provider.config.baseUrl} · ${provider.model}`,
        );
      }
    }
  }

  for (const step of config.steps) {
    const role = BUILTIN_ROLES[step.agent];
    if (role) {
      orchestrator.registerAgent({
        ...role,
        name: step.agent,
        temperature: step.temperature ?? role.temperature,
        maxTokens: step.maxTokens ?? role.maxTokens,
      });
    } else {
      console.log(`⚠ 未知角色 "${step.agent}"，跳过注册`);
    }
  }

  const workflow = Workflow.fromConfig(config);
  const result = await orchestrator.run(workflow, { request }, {
    mock: isMock,
  });

  console.log("\n📊 执行摘要:");
  console.log(`   状态: ${result.status}`);
  console.log(
    `   耗时: ${(((result.completedAt ?? Date.now()) - result.startedAt) / 1000).toFixed(1)}s`,
  );
  console.log(`   步骤: ${result.stepStates.size} 个`);
  if (orchestrator.artifactDir) {
    console.log(`   产物: ${orchestrator.artifactDir}`);
  }

  for (const [name, state] of result.stepStates) {
    const icon =
      state.status === "success"
        ? "✅"
        : state.status === "failed"
          ? "❌"
          : state.status === "skipped"
            ? "⏭"
            : "⏳";
    const contentPreview =
      typeof state.result === "string"
        ? ` ${state.result.slice(0, 60).replace(/\n/g, " ")}...`
        : "";
    console.log(
      `   ${icon} ${name}: ${state.status}${contentPreview}${state.error ? ` (${state.error})` : ""}`,
    );
  }
}

main().catch((err) => {
  console.error("❌ Maestro 错误:", err instanceof Error ? err.message : err);
  process.exit(1);
});
