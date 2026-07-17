/**
 * Maestro TUI 主应用
 *
 * 架构对照 Grok Build：
 *   input → Action → reduce(state) → Effect → runner
 *   Orchestrator 结构化事件 → Action → reduce
 *
 * 布局:
 * ┌─ Header ─────────────────────────────────┐
 * │ Workflow DAG          │ Roles            │
 * ├───────────────────────┴──────────────────┤
 * │ Logs (实时) / Help                        │
 * ├──────────────────────────────────────────┤
 * │ [SlashDropdown]                           │
 * │ > /run ...                               │
 * └──────────────────────────────────────────┘
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";

import { Header } from "./components/Header";
import { WorkflowPanel } from "./components/WorkflowPanel";
import { LogPanel } from "./components/LogPanel";
import { RolesPanel } from "./components/RolesPanel";
import { CommandInput } from "./components/CommandInput";
import { SlashDropdown } from "./components/SlashDropdown";
import { InspectPanel } from "./components/InspectPanel";
import { createInitialState, type StepUiState, type TuiState } from "./state";
import { reduce } from "./reducer";
import type { TuiAction, TuiEffect } from "./actions";
import { CommandRegistry, parseSlashLine, builtinCommands } from "./slash";

import { Orchestrator } from "../core/orchestrator";
import type { OrchestratorEvent } from "../core/events";
import { Workflow } from "../core/workflow";
import { validateWorkflowConfig } from "../core/validate";
import { planFromTemplate } from "../core/planner";
import { MockProvider } from "../testing/MockProvider";
import { createProvider, apiKeyEnvName } from "../providers";
import { loadConfig } from "../config/store";
import { BUILTIN_ROLES } from "../roles";
import type { ProviderKind, WorkflowConfig } from "../types";

const registry = new CommandRegistry();
registry.registerAll(builtinCommands);

export function App() {
  const { exit } = useApp();
  const [state, setState] = useState<TuiState>(createInitialState);
  const abortRef = useRef<AbortController | null>(null);
  const orchRef = useRef<Orchestrator | null>(null);
  // 用 ref 读最新 state，避免 useInput 闭包过期
  const stateRef = useRef(state);
  stateRef.current = state;

  const dispatch = useCallback((action: TuiAction) => {
    setState((s) => reduce(s, action));
  }, []);

  const dispatchMany = useCallback((actions: TuiAction[]) => {
    setState((s) => actions.reduce((acc, a) => reduce(acc, a), s));
  }, []);

  const onOrchestratorEvent = useCallback(
    (event: OrchestratorEvent) => {
      dispatch({ type: "orchestrator/event", event });
    },
    [dispatch],
  );

  const executeConfig = useCallback(
    async (config: WorkflowConfig, isMock: boolean, request: string) => {
      const steps: StepUiState[] = config.steps.map((s) => ({
        name: s.name,
        agent: s.agent,
        status: "pending",
        attempts: 0,
      }));
      const stepDeps: Record<string, string[]> = {};
      for (const s of config.steps) {
        stepDeps[s.name] = s.inputs ?? [];
      }

      dispatch({
        type: "workflow/prepare",
        workflowName: config.name,
        steps,
        mock: isMock,
        stepDeps,
      });

      const abort = new AbortController();
      abortRef.current = abort;

      const fileCfg = loadConfig();
      const orch = new Orchestrator({
        maxGlobalRetries: config.maxGlobalRetries ?? fileCfg.maxGlobalRetries ?? 1,
        outputDir: config.outputDir ?? fileCfg.outputDir,
        onEvent: onOrchestratorEvent,
      });
      orchRef.current = orch;

      const kinds = new Set<ProviderKind>();
      for (const step of config.steps) {
        const role = BUILTIN_ROLES[step.agent];
        if (role) kinds.add(role.provider);
      }

      if (isMock) {
        for (const kind of kinds) {
          orch.registerProvider(
            kind,
            new MockProvider({ name: kind, model: `${kind}-mock` }, { delayMs: 80 }),
          );
        }
      } else {
        for (const kind of kinds) {
          const envKey = apiKeyEnvName(kind);
          const cfgKey = loadConfig().providers[kind]?.apiKey;
          if (!process.env[envKey] && !cfgKey) {
            dispatch({
              type: "logs/push",
              level: "warn",
              message: `未设置 ${envKey} 且配置无 apiKey`,
            });
          }
          const roleModel = Object.values(BUILTIN_ROLES).find(
            (r) => r.provider === kind,
          )?.model;
          const provider = createProvider(kind, { roleModel });
          orch.registerProvider(kind, provider);
          dispatch({
            type: "logs/push",
            level: "info",
            message: `  📡 ${kind} → ${provider.config.baseUrl}`,
          });
        }
      }

      for (const step of config.steps) {
        const role = BUILTIN_ROLES[step.agent];
        if (role) {
          orch.registerAgent({
            ...role,
            name: step.agent,
            temperature: step.temperature ?? role.temperature,
            maxTokens: step.maxTokens ?? role.maxTokens,
          });
        } else {
          dispatch({
            type: "logs/push",
            level: "warn",
            message: `未知角色: ${step.agent}`,
          });
        }
      }

      const workflow = Workflow.fromConfig(config);
      const startedAt = Date.now();

      try {
        const result = await orch.run(
          workflow,
          { request },
          { mock: isMock, signal: abort.signal },
        );

        const cancelled = result.error === "cancelled";
        dispatch({
          type: "workflow/finished",
          status: cancelled
            ? "cancelled"
            : result.status === "completed"
              ? "completed"
              : "failed",
          durationMs: Date.now() - startedAt,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        dispatchMany([
          { type: "logs/push", level: "error", message },
          {
            type: "workflow/finished",
            status: "failed",
            durationMs: Date.now() - startedAt,
          },
          { type: "status/set", statusLine: `错误: ${message}` },
        ]);
      } finally {
        abortRef.current = null;
        orchRef.current = null;
      }
    },
    [dispatch, dispatchMany, onOrchestratorEvent],
  );

  const runWorkflow = useCallback(
    async (workflowPath: string, isMock: boolean) => {
      const filePath = path.resolve(workflowPath);
      if (!fs.existsSync(filePath)) {
        dispatchMany([
          { type: "logs/push", level: "error", message: `文件不存在: ${filePath}` },
          { type: "status/set", statusLine: `文件不存在: ${workflowPath}` },
        ]);
        return;
      }

      let raw: unknown;
      try {
        raw = parseYaml(fs.readFileSync(filePath, "utf-8"));
      } catch (err) {
        dispatch({
          type: "logs/push",
          level: "error",
          message: `YAML 解析失败: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }

      const validated = validateWorkflowConfig(raw);
      for (const issue of validated.issues) {
        dispatch({
          type: "logs/push",
          level: issue.level === "error" ? "error" : "warn",
          message: `[${issue.path}] ${issue.message}`,
        });
      }
      if (!validated.ok || !validated.config) {
        dispatch({
          type: "status/set",
          statusLine: "工作流校验失败",
        });
        return;
      }

      await executeConfig(validated.config, isMock, "TUI 演示任务");
    },
    [dispatch, dispatchMany, executeConfig],
  );

  const planAndRun = useCallback(
    async (request: string, isMock: boolean, withTest?: boolean) => {
      const fileCfg = loadConfig();
      const config = planFromTemplate({
        request,
        test: withTest,
        outputDir: fileCfg.outputDir ?? ".maestro/runs",
        maxGlobalRetries: fileCfg.maxGlobalRetries ?? 0,
        name: `plan-tui`,
      });
      dispatch({
        type: "logs/push",
        level: "info",
        message: `🧭 Planner 模板: ${config.steps.map((s) => s.name).join(" → ")}`,
      });
      await executeConfig(config, isMock, request);
    },
    [dispatch, executeConfig],
  );

  const runEffect = useCallback(
    (effect: TuiEffect) => {
      switch (effect.type) {
        case "run-workflow":
          void runWorkflow(effect.path, effect.mock);
          break;
        case "plan-and-run":
          void planAndRun(effect.request, effect.mock, effect.test);
          break;
        case "stop-workflow":
          abortRef.current?.abort();
          orchRef.current?.cancel();
          break;
        case "exit":
          abortRef.current?.abort();
          orchRef.current?.cancel();
          exit();
          break;
        case "none":
          break;
      }
    },
    [exit, runWorkflow, planAndRun],
  );

  const slashMatches = useMemo(() => {
    if (!state.slashOpen) return [];
    return registry.match(state.slashQuery);
  }, [state.slashOpen, state.slashQuery]);

  // 钳制 selected，避免越界
  const slashSelected = Math.min(
    state.slashSelected,
    Math.max(0, slashMatches.length - 1),
  );

  const handleCommand = useCallback(
    (raw: string) => {
      const line = raw.trim();
      if (!line) return;

      dispatchMany([
        { type: "history/push", command: line },
        { type: "input/clear" },
        { type: "help/hide" },
        { type: "slash/close" },
      ]);

      if (line === "q") {
        runEffect({ type: "exit" });
        return;
      }

      const parsed = parseSlashLine(line);
      if (!parsed) {
        dispatch({
          type: "logs/push",
          level: "error",
          message: `未知命令: ${line}  (输入 /help)`,
        });
        return;
      }

      const cmd = registry.get(parsed.name);
      if (!cmd) {
        dispatch({
          type: "logs/push",
          level: "error",
          message: `未知命令: /${parsed.name}  (输入 /help)`,
        });
        return;
      }

      setState((current) => {
        if (current.mode === "running" && !cmd.allowWhileRunning) {
          return reduce(current, {
            type: "logs/push",
            level: "warn",
            message: `运行中不可用: /${cmd.name} · 先 /stop`,
          });
        }

        const result = cmd.run({
          state: current,
          args: parsed.args,
          raw: line,
        });

        let next = current;
        if (result.kind === "actions") {
          next = result.actions.reduce((acc, a) => reduce(acc, a), next);
        } else if (result.kind === "effect") {
          if (result.actions) {
            next = result.actions.reduce((acc, a) => reduce(acc, a), next);
          }
          queueMicrotask(() => runEffect(result.effect));
        } else if (result.kind === "message") {
          next = reduce(next, {
            type: "logs/push",
            level: result.level,
            message: result.message,
          });
        }
        return next;
      });
    },
    [dispatch, dispatchMany, runEffect],
  );

  useInput((inputKey, key) => {
    const current = stateRef.current;
    const matches = current.slashOpen ? registry.match(current.slashQuery) : [];
    const selected = Math.min(
      current.slashSelected,
      Math.max(0, matches.length - 1),
    );

    // Esc 关闭下拉 / 预览
    if (key.escape) {
      if (current.slashOpen) {
        dispatch({ type: "slash/close" });
        return;
      }
      if (current.inspectStep) {
        dispatch({ type: "inspect/close" });
        return;
      }
    }

    // 下拉打开时：↑↓ 选择，Tab 接受，Enter 已由 TextInput 处理
    if (current.slashOpen && matches.length > 0) {
      if (key.upArrow) {
        dispatch({
          type: "slash/set-selected",
          index: selected <= 0 ? matches.length - 1 : selected - 1,
        });
        return;
      }
      if (key.downArrow) {
        dispatch({
          type: "slash/set-selected",
          index: selected >= matches.length - 1 ? 0 : selected + 1,
        });
        return;
      }
      if (key.tab) {
        const chosen = matches[selected];
        if (chosen) {
          // 需要参数的命令补全后带空格
          const needsArgs = chosen.usage.includes("<") || chosen.name === "run";
          dispatch({
            type: "input/set",
            value: needsArgs ? `/${chosen.name} ` : `/${chosen.name}`,
          });
          if (!needsArgs) {
            dispatch({ type: "slash/close" });
          }
        }
        return;
      }
    }

    if (key.ctrl && inputKey === "c") {
      if (current.mode === "running") {
        abortRef.current?.abort();
        orchRef.current?.cancel();
        dispatchMany([
          { type: "logs/push", level: "warn", message: "Ctrl+C · 取消工作流" },
          { type: "status/set", statusLine: "取消中…" },
        ]);
      } else {
        exit();
      }
      return;
    }

    // 下拉关闭时，↑↓ 走命令历史
    if (!current.slashOpen) {
      if (key.upArrow) {
        dispatch({ type: "history/prev" });
        return;
      }
      if (key.downArrow) {
        dispatch({ type: "history/next" });
        return;
      }
    }
  });

  const helpText = useMemo(() => registry.helpText(), []);

  const duration = useMemo(() => {
    if (!state.startedAt) return "";
    const end = state.completedAt ?? Date.now();
    return `${((end - state.startedAt) / 1000).toFixed(1)}s`;
  }, [state.startedAt, state.completedAt, state.mode]);

  const stepDepsMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [k, v] of Object.entries(state.stepDeps)) m.set(k, v);
    return m;
  }, [state.stepDeps]);

  return (
    <Box flexDirection="column" padding={1}>
      <Header state={state} />

      <Box marginTop={1} gap={1}>
        <WorkflowPanel
          workflowName={state.workflowName}
          steps={state.steps}
          deps={stepDepsMap}
        />
        <RolesPanel />
      </Box>

      {state.showHelp ? (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="yellow"
          paddingX={1}
          marginTop={1}
        >
          <Text bold color="yellow">
            Commands
          </Text>
          {helpText.map((line, i) => (
            <Text key={i} color="white">
              {line || " "}
            </Text>
          ))}
        </Box>
      ) : state.inspectStep ? (
        (() => {
          const step = state.steps.find((s) => s.name === state.inspectStep);
          return step ? (
            <InspectPanel step={step} />
          ) : (
            <Box marginTop={1}>
              <Text color="red">未找到 step: {state.inspectStep}</Text>
            </Box>
          );
        })()
      ) : (
        <Box marginTop={1}>
          <LogPanel logs={state.logs} maxLines={10} />
        </Box>
      )}

      {state.startedAt && (
        <Box marginTop={0}>
          <Text color="gray">
            {duration && `elapsed ${duration}`}
            {state.mock ? " · mock" : ""}
          </Text>
        </Box>
      )}

      {state.slashOpen && (
        <Box marginTop={1}>
          <SlashDropdown
            items={slashMatches}
            selected={slashSelected}
            query={state.slashQuery}
          />
        </Box>
      )}

      <Box marginTop={1}>
        <CommandInput
          value={state.input}
          onChange={(v) => dispatch({ type: "input/set", value: v })}
          onSubmit={handleCommand}
          statusLine={state.statusLine}
          running={state.mode === "running"}
        />
      </Box>
    </Box>
  );
}
