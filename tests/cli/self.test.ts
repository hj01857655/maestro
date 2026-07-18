import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import {
  formatVersionLine,
  packageRootFromMeta,
  readPackageJson,
  resolveInstallInfo,
  run,
} from "../../src/cli/self";

describe("cli/self", () => {
  it("packageRootFromMeta 应指向含 package.json 的仓库根", () => {
    // src/cli → 模拟 import.meta.dir
    const root = packageRootFromMeta(path.join(import.meta.dir, "../../src/cli"));
    const pkg = readPackageJson(root);
    expect(pkg.name).toBe("maestro");
    expect(pkg.version).toBeTruthy();
  });

  it("resolveInstallInfo 应识别当前仓库", () => {
    const info = resolveInstallInfo();
    expect(info.packageName).toBe("maestro");
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(info.isGit).toBe(true);
    expect(info.root).toContain("maestro");
  });

  it("formatVersionLine 包含版本号", () => {
    const line = formatVersionLine();
    expect(line.startsWith("maestro v")).toBe(true);
  });

  it("run 能执行简单命令", () => {
    const r = run("git", ["--version"]);
    expect(r.ok).toBe(true);
    expect(r.stdout.toLowerCase()).toContain("git");
  });
});
