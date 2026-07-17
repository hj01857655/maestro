/**
 * DAG 分层布局 — 按拓扑深度分组，供 TUI 可视化。
 */

import type { StepConfig, WorkflowConfig } from "../types";
import type { StepUiState } from "./state";
import { statusColor, statusIcon } from "./state";

/** 计算每个 step 的层（最长上游路径） */
export function computeLayers(steps: StepConfig[]): string[][] {
  const byName = new Map(steps.map((s) => [s.name, s]));
  const depth = new Map<string, number>();

  function d(name: string, stack: Set<string>): number {
    if (depth.has(name)) return depth.get(name)!;
    if (stack.has(name)) return 0; // 环：按 0 处理（校验阶段应已拦）
    stack.add(name);
    const step = byName.get(name);
    const inputs = step?.inputs ?? [];
    let max = 0;
    for (const i of inputs) {
      if (byName.has(i)) max = Math.max(max, d(i, stack) + 1);
    }
    stack.delete(name);
    depth.set(name, max);
    return max;
  }

  for (const s of steps) d(s.name, new Set());

  const maxD = Math.max(0, ...Array.from(depth.values()));
  const layers: string[][] = Array.from({ length: maxD + 1 }, () => []);
  // 保持定义顺序
  for (const s of steps) {
    layers[depth.get(s.name) ?? 0].push(s.name);
  }
  return layers.filter((l) => l.length > 0);
}

/** 从 WorkflowConfig 生成 ASCII DAG（纯文本，无状态） */
export function formatDagAscii(config: WorkflowConfig): string[] {
  const layers = computeLayers(config.steps);
  const lines: string[] = [];
  for (let i = 0; i < layers.length; i++) {
    lines.push(layers[i].join("  │  "));
    if (i < layers.length - 1) {
      lines.push(
        " ".repeat(Math.max(0, Math.floor(layers[i].join("  │  ").length / 2) - 1)) +
          "↓",
      );
    }
  }
  return lines;
}

/** TUI 用：带状态的分层行 */
export function formatDagLayers(
  steps: StepUiState[],
  deps?: Map<string, string[]>,
): Array<{ depth: number; items: StepUiState[] }> {
  if (!deps || deps.size === 0) {
    return steps.length ? [{ depth: 0, items: steps }] : [];
  }

  const depMap = deps;
  const depth = new Map<string, number>();
  const byName = new Map(steps.map((s) => [s.name, s]));

  function d(name: string, stack: Set<string>): number {
    if (depth.has(name)) return depth.get(name)!;
    if (stack.has(name)) return 0;
    stack.add(name);
    const inputs = depMap.get(name) ?? [];
    let max = 0;
    for (const i of inputs) {
      if (byName.has(i)) max = Math.max(max, d(i, stack) + 1);
    }
    stack.delete(name);
    depth.set(name, max);
    return max;
  }

  for (const s of steps) d(s.name, new Set());
  const maxD = Math.max(0, ...Array.from(depth.values()), 0);
  const layers: StepUiState[][] = Array.from({ length: maxD + 1 }, () => []);
  for (const s of steps) {
    layers[depth.get(s.name) ?? 0].push(s);
  }
  return layers
    .map((items, depthIdx) => ({ depth: depthIdx, items }))
    .filter((l) => l.items.length > 0);
}

export function stepBadge(step: StepUiState): string {
  return `${statusIcon(step.status)} ${step.name}`;
}

export { statusColor, statusIcon };
