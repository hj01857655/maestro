#!/usr/bin/env bun
/**
 * Maestro CLI 入口。
 *
 * 用法:
 *   maestro                                 启动 TUI（默认）
 *   maestro tui                             同上
 *   maestro -c / --continue                 续当前目录最近会话
 *   maestro -r / --resume [id]              恢复会话
 *   maestro -p / --print "prompt"           非交互单次调用
 *   maestro sessions …                      列出会话
 *   maestro run <workflow.yaml> [--mock]
 *   maestro plan "<需求>" [--mock] [--out file.yaml] [--run]
 *   maestro validate <workflow.yaml>
 *   maestro config [show|set|path]
 *   maestro list-roles
 *   maestro register <kind> <name> <url> <key> [model]
 *   maestro update [--check] [--force]
 *   maestro doctor
 *   maestro version | -V | --version
 *   maestro help | --help | -h
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
  resolvePermissionMode,
  resolvePermissionRules,
  type MaestroConfig,
} from "./config/store";
import type { ProviderKind, WorkflowConfig } from "./types";
import type { PermissionMode } from "./permissions";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { stringify as stringifyYaml } from "yaml";
import {
  cmdDoctor,
  cmdUpdate,
  cmdVersion,
  formatVersionLine,
} from "./cli/self";
import { parseGlobalArgs } from "./cli/args";
import { runPrint, readStdinText } from "./cli/print";
import {
  cmdSessions,
  printResumeHint,
  resolveResumeTarget,
} from "./cli/sessions";
import {
  createSession,
  saveSession,
  touchSession,
} from "./session";

function log(msg: string) {
  console.log(msg);
}

function debugLog(verbose: boolean, msg: string) {
  if (verbose) console.error(`[maestro] ${msg}`);
}

function resolvePerm(globalMode?: string): PermissionMode {
  return resolvePermissionMode(globalMode);
}

function printHelp() {
  console.log(`
Maestro 🎼 — 多模型 Agent 编排平台  ·  ${formatVersionLine()}

用法:
  maestro                                     启动交互式终端界面（默认）
  maestro tui                                 同上
  maestro -c, --continue                      续当前目录最近会话
  maestro -r, --resume [id|query]             恢复会话（进 TUI）
  maestro -p, --print [prompt] [选项]         非交互单次调用并退出
      --role|--agent <role>   角色（默认 coder）
      --model <model>         覆盖模型
      --output-format text|json
      --mock                  模拟响应
      -d, --verbose           调试日志
  maestro sessions [list|show|rm|path]        会话管理
  maestro continue | resume [id]              同 -c / -r
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
  maestro update [--check] [--force]          从 git 远程更新（bun link 安装）
  maestro doctor                              检查运行环境 / 配置 / 依赖
  maestro version | -V | --version            显示版本
  maestro help | --help | -h                  显示本帮助

全局旗标（多数命令可用）:
  -n, --name <name>     会话显示名
  --model <model>       覆盖模型（print / 部分路径）
  --mock                模拟响应
  -d, --verbose         调试日志到 stderr
  --permission-mode <m> plan|default|accept-edits|auto
  --perm <m>            同上

环境变量（优先于配置文件）:
  CLAUDE_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY / GROK_API_KEY
  *_BASE_URL  *_MODEL  *_API_FORMAT
  MAESTRO_PERMISSION_MODE

默认 baseUrl:
  claude  ${DEFAULT_BASE_URLS.claude}
  openai  ${DEFAULT_BASE_URLS.openai}
  gemini  ${DEFAULT_BASE_URLS.gemini}
  grok    ${DEFAULT_BASE_URLS.grok}

示例:
  maestro
  maestro -c
  maestro -r abc123
  maestro --permission-mode plan
  maestro -p "写一个 hello world" --role coder --mock
  maestro sessions
  maestro update
  maestro doctor
  maestro run src/examples/demo-mock.yaml --mock
  maestro plan "实现用户登录" --out .maestro/login.yaml --run --mock
  maestro config set claude apiKey=sk-ant-xxx model=claude-sonnet-4-6
  maestro validate src/examples/dev-workflow.yaml
`);
}

async function startTuiOrExplain(opts: {
  session?: import("./session").SessionRecord;
  name?: string;
  mock?: boolean;
  permissionMode?: import("./permissions").PermissionMode;
} = {}): Promise<void> {
  const { startTui } = await import("./tui");
  await startTui(opts);
}

async function handleResumeContinue(opts: {
  continue?: boolean;
  resume?: boolean | string;
  name?: string;
  mock?: boolean;
  verbose?: boolean;
  permissionMode?: import("./permissions").PermissionMode;
}): Promise<number> {
  const resolved = resolveResumeTarget({
    continue: opts.continue,
    resume: opts.resume,
  });
  if (resolved.error) {
    console.error(`❌ ${resolved.error}`);
    if (resolved.ambiguous?.length) {
      for (const s of resolved.ambiguous) {
        console.error(
          `  ${s.id}${s.name ? ` "${s.name}"` : ""}  ${s.status}  ${s.updatedAt.slice(0, 19)}  ${s.workflowName ?? ""}`,
        );
      }
    }
    return 1;
  }
  if (!resolved.session) {
    console.error("❌ 没有可恢复的会话");
    return 1;
  }
  printResumeHint(resolved.session);
  debugLog(Boolean(opts.verbose), `resume session=${resolved.session.id}`);
  await startTuiOrExplain({
    session: resolved.session,
    name: opts.name,
    mock: opts.mock ?? resolved.session.mock,
    permissionMode: opts.permissionMode,
  });
  return 0;
}

async function main() {
  let global;
  try {
    global = parseGlobalArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
    return;
  }

  const args = global.rest;
  debugLog(global.verbose, `argv rest=${JSON.stringify(args)} flags=${JSON.stringify({
    continue: global.continue,
    resume: global.resume,
    print: global.print,
    mock: global.mock,
    model: global.model,
    name: global.name,
    role: global.role,
  })}`);

  // -p / --print 优先（可无子命令）
  if (global.print) {
    let prompt = global.printPrompt ?? "";
    if (!prompt) prompt = await readStdinText();
    const code = await runPrint({
      prompt,
      role: global.role,
      model: global.model,
      mock: global.mock,
      verbose: global.verbose,
      outputFormat: global.outputFormat,
      name: global.name,
      permissionMode: resolvePerm(global.permissionMode),
    });
    process.exitCode = code;
    return;
  }

  // -c / -r 无子命令时直接 resume
  if ((global.continue || global.resume) && args.length === 0) {
    const code = await handleResumeContinue({
      continue: global.continue,
      resume: global.resume,
      name: global.name,
      mock: global.mock,
      verbose: global.verbose,
      permissionMode: resolvePerm(global.permissionMode),
    });
    process.exitCode = code;
    return;
  }

  // 无参数：像 claude / codex 一样直接进 TUI；非 TTY 时打印帮助
  if (args.length === 0) {
    if (process.stdin.isTTY) {
      await startTuiOrExplain({
        name: global.name,
        mock: global.mock,
        permissionMode: resolvePerm(global.permissionMode),
      });
    } else {
      printHelp();
    }
    return;
  }

  const command = args[0]!;

  switch (command) {
    case "tui": {
      // tui 也可带 -c/-r（若之前没被全局吃掉）
      if (global.continue || global.resume) {
        const code = await handleResumeContinue({
          continue: global.continue,
          resume: global.resume,
          name: global.name,
          mock: global.mock,
          verbose: global.verbose,
          permissionMode: resolvePerm(global.permissionMode),
        });
        process.exitCode = code;
      } else {
        await startTuiOrExplain({
          name: global.name,
          mock: global.mock,
          permissionMode: resolvePerm(global.permissionMode),
        });
      }
      break;
    }
    case "continue": {
      const code = await handleResumeContinue({
        continue: true,
        name: global.name,
        mock: global.mock,
        verbose: global.verbose,
        permissionMode: resolvePerm(global.permissionMode),
      });
      process.exitCode = code;
      break;
    }
    case "resume": {
      const ref = args[1];
      const code = await handleResumeContinue({
        resume: ref ?? true,
        name: global.name,
        mock: global.mock,
        verbose: global.verbose,
        permissionMode: resolvePerm(global.permissionMode),
      });
      process.exitCode = code;
      break;
    }
    case "print":
    case "ask": {
      const prompt =
        args.slice(1).filter((a) => !a.startsWith("--")).join(" ").trim() ||
        global.printPrompt ||
        (await readStdinText());
      const code = await runPrint({
        prompt,
        role: global.role,
        model: global.model,
        mock: global.mock || args.includes("--mock"),
        verbose: global.verbose,
        outputFormat: global.outputFormat,
        name: global.name,
        permissionMode: resolvePerm(global.permissionMode),
      });
      process.exitCode = code;
      break;
    }
    case "sessions":
    case "session": {
      process.exitCode = cmdSessions(args.slice(1));
      break;
    }
    case "help":
    case "--help":
    case "-h": {
      printHelp();
      break;
    }
    case "version":
    case "--version":
    case "-V": {
      cmdVersion();
      break;
    }
    case "update": {
      const check = args.includes("--check");
      const force = args.includes("--force");
      const code = await cmdUpdate({ check, force });
      process.exitCode = code;
      break;
    }
    case "doctor": {
      const code = await cmdDoctor();
      process.exitCode = code;
      break;
    }
    case "run": {
      const isMock = global.mock || args.includes("--mock");
      const wfPath = args.slice(1).find((a) => !a.startsWith("--"));
      await runWorkflow(wfPath, isMock, "CLI 任务", {
        name: global.name,
        verbose: global.verbose,
        permissionMode: global.permissionMode,
      });
      break;
    }
    case "plan": {
      await cmdPlan(args.slice(1), {
        name: global.name,
        mock: global.mock,
        verbose: global.verbose,
        permissionMode: global.permissionMode,
      });
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
      console.error(`未知命令: ${command}\n`);
      printHelp();
      process.exitCode = 1;
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

async function cmdPlan(
  args: string[],
  g: {
    name?: string;
    mock?: boolean;
    verbose?: boolean;
    permissionMode?: string;
  } = {},
) {
  const requestParts: string[] = [];
  let outFile: string | undefined;
  let doRun = false;
  let isMock = Boolean(g.mock);
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
      await runWorkflow(outFile, isMock, request, {
        name: g.name,
        verbose: g.verbose,
        permissionMode: g.permissionMode,
      });
    } else {
      await runWorkflowConfig(config, isMock, request, {
        name: g.name,
        verbose: g.verbose,
        permissionMode: g.permissionMode,
      });
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
  g: { name?: string; verbose?: boolean; permissionMode?: string } = {},
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

  await runWorkflowConfig(validated.config, isMock, request, g);
}

async function runWorkflowConfig(
  config: WorkflowConfig,
  isMock: boolean,
  request: string,
  g: { name?: string; verbose?: boolean; permissionMode?: string } = {},
) {
  console.log(`\n📄 加载工作流: ${config.name}`);
  if (isMock) {
    console.log(`   🎭 Mock 模式 — 所有模型使用模拟响应\n`);
  }

  const session = createSession({
    kind: "cli",
    name: g.name,
    mock: isMock,
    lastRequest: request,
  });
  session.workflowName = config.name;
  session.lastWorkflow = config;
  session.status = "active";
  saveSession(session);
  debugLog(Boolean(g.verbose), `session=${session.id}`);
  console.log(`   🧾 session: ${session.id}${g.name ? ` "${g.name}"` : ""}`);

  const fileCfg = loadConfig();
  const permMode = resolvePermissionMode(g.permissionMode);
  const permRules = resolvePermissionRules();
  const orchestrator = new Orchestrator({
    maxGlobalRetries: config.maxGlobalRetries ?? fileCfg.maxGlobalRetries ?? 1,
    outputDir: config.outputDir ?? fileCfg.outputDir,
    permissionMode: permMode,
    permissionRules: permRules,
    onLog: log,
  });
  log(`   🔐 permission: ${permMode}`);

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

  const finish =
    result.error === "cancelled"
      ? "cancelled"
      : result.status === "completed"
        ? "completed"
        : "failed";
  touchSession(session, {
    status: finish,
    artifactDir: orchestrator.artifactDir,
    workflowName: config.name,
    lastWorkflow: config,
    lastRequest: request,
    mock: isMock,
    steps: [...result.stepStates.entries()].map(([name, st]) => ({
      name,
      agent: config.steps.find((s) => s.name === name)?.agent ?? "?",
      status: st.status,
      summary:
        typeof st.result === "string" ? st.result.slice(0, 200) : undefined,
      error: st.error,
      attempts: st.attempts,
    })),
  });

  console.log("\n📊 执行摘要:");
  console.log(`   状态: ${result.status}`);
  console.log(
    `   耗时: ${(((result.completedAt ?? Date.now()) - result.startedAt) / 1000).toFixed(1)}s`,
  );
  console.log(`   步骤: ${result.stepStates.size} 个`);
  console.log(`   会话: ${session.id}`);
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
