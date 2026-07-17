/**
 * Core 核心模块测试
 */
import { describe, it, expect } from "bun:test";
import { Context } from "../../src/core/context";
import { Workflow } from "../../src/core/workflow";

/* ---- Context ---- */

describe("Context", () => {
  it("应该正确存储和读取", () => {
    const ctx = new Context();
    ctx.set("name", "Maestro");
    expect(ctx.get("name")).toBe("Maestro");
    expect(ctx.has("name")).toBe(true);
    expect(ctx.has("nonexist")).toBe(false);
  });

  it("应该正确渲染模板变量", () => {
    const ctx = new Context();
    ctx.set("result", "这是一段输出");
    ctx.set("stats", { tokens: 150, time: "2s" });

    const rendered = ctx.render("上一步输出: {{ result }}");
    expect(rendered).toBe("上一步输出: 这是一段输出");
  });

  it("应该支持嵌套字段访问", () => {
    const ctx = new Context();
    ctx.set("stats", { tokens: 150, model: "opus-4" });

    expect(ctx.render("消耗 {{ stats.tokens }} tokens")).toBe("消耗 150 tokens");
  });

  it("未找到的变量应该保留原始模板", () => {
    const ctx = new Context();
    expect(ctx.render("{{ unknown }} 未定义")).toBe("{{ unknown }} 未定义");
  });

  it("应该支持 snapshot/load", () => {
    const ctx = new Context();
    ctx.set("a", 1);
    ctx.set("b", 2);
    const snap = ctx.snapshot();
    ctx.set("c", 3);
    ctx.load(snap);
    expect(ctx.has("c")).toBe(false);
    expect(ctx.get("a")).toBe(1);
  });
});

/* ---- Workflow ---- */

describe("Workflow", () => {
  it("应该正确构建 DAG", () => {
    const wf = new Workflow({
      name: "test",
      steps: [
        { name: "step1", agent: "researcher", prompt: "search" },
        { name: "step2", agent: "designer", prompt: "design", inputs: ["step1"] },
        { name: "step3", agent: "coder", prompt: "code", inputs: ["step2"] },
      ],
    });

    expect(wf.steps.size).toBe(3);
    expect(wf.entrySteps.map((s) => s.name)).toEqual(["step1"]);
  });

  it("应该正确计算可运行节点", () => {
    const wf = new Workflow({
      name: "test",
      steps: [
        { name: "a", agent: "agent1", prompt: "do a" },
        { name: "b", agent: "agent2", prompt: "do b", inputs: ["a"] },
        { name: "c", agent: "agent3", prompt: "do c", inputs: ["a"] },
        { name: "d", agent: "agent4", prompt: "do d", inputs: ["b", "c"] },
      ],
    });

    const ctx = {};

    // 只有 a（入口节点）可运行
    expect(wf.getNextRunnable(ctx)?.name).toBe("a");
    expect(wf.getRunnableSteps(ctx).runnable.map((s) => s.name)).toEqual(["a"]);

    // 标记 a 完成，b 和 c 应变成可运行
    wf.steps.get("a")!.status = "success";
    const ctx2 = { a: "done" };
    const next = wf.getNextRunnable(ctx2)!;
    expect(["b", "c"]).toContain(next.name);
    const batch = wf.getRunnableSteps(ctx2).runnable.map((s) => s.name).sort();
    expect(batch).toEqual(["b", "c"]);

    // 标记 b 完成，c 仍然可运行，d 还需要 c
    wf.steps.get("b")!.status = "success";
    const ctx3 = { a: "done", b: "done" };
    expect(wf.getNextRunnable(ctx3)?.name).toBe("c");

    // 标记 c 完成，d 变为可运行
    wf.steps.get("c")!.status = "success";
    const ctx4 = { a: "done", b: "done", c: "done" };
    expect(wf.getNextRunnable(ctx4)?.name).toBe("d");
  });

  it("条件不满足应进入 toSkip", () => {
    const wf = new Workflow({
      name: "cond",
      steps: [
        { name: "a", agent: "agent1", prompt: "a" },
        {
          name: "b",
          agent: "agent2",
          prompt: "b",
          inputs: ["a"],
          conditions: [{ sourceStep: "a", when: "contains:YES" }],
        },
      ],
    });
    wf.steps.get("a")!.status = "success";
    const { runnable, toSkip } = wf.getRunnableSteps({ a: "NOPE" });
    expect(runnable).toEqual([]);
    expect(toSkip.map((t) => t.step.name)).toEqual(["b"]);
  });

  it("应该正确获取下游依赖", () => {
    const wf = new Workflow({
      name: "test",
      steps: [
        { name: "a", agent: "agent1", prompt: "do a" },
        { name: "b", agent: "agent2", prompt: "do b", inputs: ["a"] },
        { name: "c", agent: "agent3", prompt: "do c", inputs: ["a"] },
      ],
    });

    const deps = wf.getDependents("a");
    expect(deps.map((s) => s.name).sort()).toEqual(["b", "c"]);
  });
});
