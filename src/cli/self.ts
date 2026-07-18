/**
 * CLI 自管理：version / update / doctor
 *
 * 安装形态：
 * - git-link：`bun link` 挂到本地 git 仓库（当前默认）
 * - global：`bun add -g` 装到 ~/.bun/install/global
 * - path：直接从源码路径运行
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { configPath, loadConfig, maskKey } from "../config/store";
import type { ProviderKind } from "../types";
import { DEFAULT_BASE_URLS } from "../providers/defaults";

export type InstallMode = "git-link" | "global" | "path" | "unknown";

export interface InstallInfo {
  /** package 根目录（含 package.json） */
  root: string;
  mode: InstallMode;
  isGit: boolean;
  packageName: string;
  version: string;
  entry: string;
}

export interface CommandResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

const PROVIDER_KINDS: ProviderKind[] = ["claude", "openai", "gemini", "grok"];

/** 解析 package 根目录：src/cli → 上两级 */
export function packageRootFromMeta(metaDir = import.meta.dir): string {
  // src/cli → src → root
  return path.resolve(metaDir, "..", "..");
}

export function readPackageJson(root: string): {
  name?: string;
  version?: string;
  bin?: Record<string, string>;
} {
  const p = path.join(root, "package.json");
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as {
      name?: string;
      version?: string;
      bin?: Record<string, string>;
    };
  } catch {
    return {};
  }
}

function isGitRepo(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, ".git")) ||
    run("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"]).stdout.trim() ===
      "true"
  );
}

function bunGlobalModulesDir(): string {
  return path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".bun",
    "install",
    "global",
    "node_modules",
  );
}

function detectMode(root: string): InstallMode {
  const globalDir = bunGlobalModulesDir();
  const globalPkg = path.join(globalDir, "maestro");
  let resolvedGlobal: string | undefined;
  try {
    if (fs.existsSync(globalPkg)) {
      resolvedGlobal = fs.realpathSync(globalPkg);
    }
  } catch {
    /* ignore */
  }

  const realRoot = (() => {
    try {
      return fs.realpathSync(root);
    } catch {
      return root;
    }
  })();

  if (
    resolvedGlobal &&
    path.resolve(resolvedGlobal) === path.resolve(realRoot)
  ) {
    // bun link 会在 global/node_modules/maestro 建 junction 指向仓库
    if (isGitRepo(realRoot)) return "git-link";
    return "global";
  }

  if (isGitRepo(realRoot)) return "path";
  if (realRoot.includes(`${path.sep}install${path.sep}global${path.sep}`)) {
    return "global";
  }
  return "unknown";
}

export function resolveInstallInfo(): InstallInfo {
  const root = packageRootFromMeta();
  const pkg = readPackageJson(root);
  const binRel =
    (pkg.bin && (pkg.bin.maestro || Object.values(pkg.bin)[0])) ||
    "./src/index.ts";
  return {
    root,
    mode: detectMode(root),
    isGit: isGitRepo(root),
    packageName: pkg.name ?? "maestro",
    version: pkg.version ?? "0.0.0",
    entry: path.resolve(root, binRel),
  };
}

export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): CommandResult {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    encoding: "utf-8",
    shell: process.platform === "win32",
  });
  return {
    ok: (res.status ?? 1) === 0,
    code: res.status ?? 1,
    stdout: (res.stdout ?? "").toString(),
    stderr: (res.stderr ?? "").toString(),
  };
}

function git(root: string, args: string[]): CommandResult {
  return run("git", ["-C", root, ...args]);
}

export function gitShortSha(root: string): string | undefined {
  const r = git(root, ["rev-parse", "--short", "HEAD"]);
  if (!r.ok) return undefined;
  return r.stdout.trim() || undefined;
}

export function gitDescribe(root: string): string | undefined {
  const r = git(root, ["describe", "--tags", "--always", "--dirty"]);
  if (!r.ok) return undefined;
  return r.stdout.trim() || undefined;
}

export function formatVersionLine(info = resolveInstallInfo()): string {
  const sha = info.isGit ? gitShortSha(info.root) : undefined;
  const extra = [
    sha ? `git ${sha}` : undefined,
    info.mode !== "unknown" ? info.mode : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return extra
    ? `maestro v${info.version} (${extra})`
    : `maestro v${info.version}`;
}

export function cmdVersion(): void {
  const info = resolveInstallInfo();
  console.log(formatVersionLine(info));
  console.log(`root: ${info.root}`);
  if (info.isGit) {
    const remote = git(info.root, ["remote", "get-url", "origin"]);
    if (remote.ok && remote.stdout.trim()) {
      console.log(`remote: ${remote.stdout.trim()}`);
    }
    const branch = git(info.root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (branch.ok && branch.stdout.trim()) {
      console.log(`branch: ${branch.stdout.trim()}`);
    }
  }
}

export interface UpdateOptions {
  /** 仅检查，不写入 */
  check?: boolean;
  /** 允许丢弃本地未提交改动（危险，默认 false） */
  force?: boolean;
}

export async function cmdUpdate(opts: UpdateOptions = {}): Promise<number> {
  const info = resolveInstallInfo();
  console.log(`🎼 Maestro update`);
  console.log(`   ${formatVersionLine(info)}`);
  console.log(`   root: ${info.root}`);

  if (!info.isGit) {
    console.log(`\n⚠ 当前安装不是 git 仓库（mode=${info.mode}）。`);
    console.log(`  可尝试：`);
    console.log(`    bun add -g github:hj01857655/maestro`);
    console.log(`  或重新 clone 后在仓库目录执行 bun link`);
    return 1;
  }

  // 确认 git / bun 可用
  const gitV = run("git", ["--version"]);
  if (!gitV.ok) {
    console.error("❌ 需要 git，但未找到可执行文件");
    return 1;
  }
  const bunV = run("bun", ["--version"]);
  if (!bunV.ok) {
    console.error("❌ 需要 bun，但未找到可执行文件");
    return 1;
  }

  const branch = git(info.root, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout
    .trim();
  const before = gitShortSha(info.root) ?? "?";

  // dirty 检查
  const status = git(info.root, ["status", "--porcelain"]);
  const dirty = status.stdout.trim().length > 0;
  if (dirty && !opts.force && !opts.check) {
    console.log("\n⚠ 工作区有未提交改动，拒绝自动更新以免覆盖：");
    console.log(status.stdout.trim().split("\n").slice(0, 12).map((l) => `  ${l}`).join("\n"));
    console.log("\n  提交/贮藏后再试，或 `maestro update --force`（会 stash 后 pull）");
    return 1;
  }

  console.log("\n↓ git fetch …");
  const fetch = git(info.root, ["fetch", "--prune", "origin"]);
  if (!fetch.ok) {
    console.error(`❌ git fetch 失败:\n${fetch.stderr || fetch.stdout}`);
    return 1;
  }

  // 比较本地与 upstream
  const upstreamRef = (() => {
    const r = git(info.root, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}",
    ]);
    if (r.ok && r.stdout.trim()) return r.stdout.trim();
    // 回落 origin/<branch>
    if (branch && branch !== "HEAD") return `origin/${branch}`;
    return "origin/HEAD";
  })();

  const localSha = git(info.root, ["rev-parse", "HEAD"]).stdout.trim();
  const remoteShaR = git(info.root, ["rev-parse", upstreamRef]);
  if (!remoteShaR.ok) {
    console.error(
      `❌ 无法解析上游 ${upstreamRef}。请确认已设置 remote 与 upstream。`,
    );
    return 1;
  }
  const remoteSha = remoteShaR.stdout.trim();

  if (localSha === remoteSha) {
    console.log(`\n✅ 已是最新 · ${before} · ${upstreamRef}`);
    // 仍可确保依赖完整
    if (!opts.check) {
      ensureDeps(info.root, { quiet: true });
    }
    return 0;
  }

  const count = git(info.root, [
    "rev-list",
    "--left-right",
    "--count",
    `HEAD...${upstreamRef}`,
  ]).stdout.trim();
  // "behind ahead" 格式：left=behind?  actually left-right: <left>\t<right>
  // HEAD...upstream: left = commits only in HEAD (ahead), right = only in upstream (behind)
  const [aheadStr, behindStr] = count.split(/\s+/);
  const ahead = Number(aheadStr || 0);
  const behind = Number(behindStr || 0);

  console.log(
    `\n📦 相对 ${upstreamRef}: behind ${behind} · ahead ${ahead}`,
  );
  console.log(`   local  ${localSha.slice(0, 7)}`);
  console.log(`   remote ${remoteSha.slice(0, 7)}`);

  if (opts.check) {
    console.log("\n(仅检查，未应用。去掉 --check 执行更新)");
    return behind > 0 ? 2 : 0;
  }

  if (behind === 0 && ahead > 0) {
    console.log("\n✅ 本地领先远程，无需 pull。");
    return 0;
  }

  let stashed = false;
  if (dirty && opts.force) {
    console.log("\n↓ git stash push -u …");
    const st = git(info.root, [
      "stash",
      "push",
      "-u",
      "-m",
      `maestro-update-${Date.now()}`,
    ]);
    if (!st.ok) {
      console.error(`❌ stash 失败:\n${st.stderr || st.stdout}`);
      return 1;
    }
    stashed = true;
  }

  console.log(`\n↓ git pull --ff-only origin ${branch || ""}`.trim());
  const pullArgs = branch
    ? ["pull", "--ff-only", "origin", branch]
    : ["pull", "--ff-only"];
  const pull = git(info.root, pullArgs);
  if (!pull.ok) {
    console.error(`❌ git pull 失败:\n${pull.stderr || pull.stdout}`);
    if (stashed) {
      console.log("↪ 尝试恢复 stash …");
      git(info.root, ["stash", "pop"]);
    }
    console.log("  提示: 有分叉时请手动处理，或改用 --force 前先备份");
    return 1;
  }
  if (pull.stdout.trim()) console.log(pull.stdout.trim());

  if (stashed) {
    console.log("↪ git stash pop …");
    const pop = git(info.root, ["stash", "pop"]);
    if (!pop.ok) {
      console.error(
        `⚠ stash pop 有冲突，请手动处理:\n${pop.stderr || pop.stdout}`,
      );
    }
  }

  ensureDeps(info.root, { quiet: false });

  const after = gitShortSha(info.root) ?? "?";
  const pkg = readPackageJson(info.root);
  console.log(`\n✅ 更新完成 · ${before} → ${after} · v${pkg.version ?? "?"}`);
  return 0;
}

function ensureDeps(
  root: string,
  opts: { quiet?: boolean } = {},
): void {
  if (!opts.quiet) console.log("\n↓ bun install …");
  const r = run("bun", ["install"], { cwd: root });
  if (!r.ok) {
    console.error(`⚠ bun install 失败:\n${r.stderr || r.stdout}`);
    return;
  }
  if (!opts.quiet) {
    const out = (r.stdout || r.stderr).trim();
    if (out) console.log(out.split("\n").slice(-5).join("\n"));
    console.log("✅ 依赖就绪");
  }
}

export async function cmdDoctor(): Promise<number> {
  const info = resolveInstallInfo();
  let issues = 0;

  console.log("🩺 Maestro doctor\n");

  // runtime
  const bunV = run("bun", ["--version"]);
  const gitV = run("git", ["--version"]);
  console.log("Runtime");
  console.log(`  bun: ${bunV.ok ? bunV.stdout.trim() : "❌ 未找到"}`);
  console.log(
    `  git: ${gitV.ok ? gitV.stdout.trim().replace(/^git version /i, "") : "❌ 未找到"}`,
  );
  console.log(`  node platform: ${process.platform} ${process.arch}`);
  console.log(`  tty: stdin=${Boolean(process.stdin.isTTY)} stdout=${Boolean(process.stdout.isTTY)}`);
  if (!bunV.ok) issues++;
  if (!gitV.ok) issues++;

  // install
  console.log("\nInstall");
  console.log(`  ${formatVersionLine(info)}`);
  console.log(`  root: ${info.root}`);
  console.log(`  mode: ${info.mode}`);
  console.log(`  entry: ${info.entry}`);
  const which = run(
    process.platform === "win32" ? "where.exe" : "which",
    ["maestro"],
  );
  if (which.ok) {
    const lines = which.stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    console.log(`  PATH maestro: ${lines[0] ?? "(none)"}`);
    if (lines.length > 1) {
      console.log(`  PATH others: ${lines.slice(1).join(" | ")}`);
    }
  } else {
    console.log("  PATH maestro: ❌ 未找到（请在仓库目录执行 bun link）");
    issues++;
  }

  if (info.isGit) {
    const branch = git(info.root, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout
      .trim();
    const remote = git(info.root, ["remote", "get-url", "origin"]).stdout.trim();
    const dirty = git(info.root, ["status", "--porcelain"]).stdout.trim();
    console.log(`  branch: ${branch || "?"}`);
    console.log(`  remote: ${remote || "❌ 无 origin"}`);
    console.log(
      `  dirty: ${dirty ? `yes (${dirty.split("\n").length} paths)` : "clean"}`,
    );
    if (!remote) issues++;
  }

  // config
  console.log("\nConfig");
  const cfgPath = configPath();
  console.log(`  path: ${cfgPath}`);
  console.log(`  exists: ${fs.existsSync(cfgPath) ? "yes" : "no"}`);
  const sessionsPath = path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".maestro",
    "sessions",
  );
  console.log(
    `  sessions: ${fs.existsSync(sessionsPath) ? sessionsPath : `${sessionsPath} (empty)`}`,
  );
  const cfg = loadConfig();
  for (const kind of PROVIDER_KINDS) {
    const e = cfg.providers[kind];
    const envKey = process.env[`${kind.toUpperCase()}_API_KEY`]?.trim();
    const key = e?.apiKey || envKey;
    const model =
      e?.model ||
      process.env[`${kind.toUpperCase()}_MODEL`] ||
      "(default)";
    const url =
      e?.baseUrl ||
      process.env[`${kind.toUpperCase()}_BASE_URL`] ||
      DEFAULT_BASE_URLS[kind];
    const fmt =
      kind === "openai" || kind === "grok"
        ? e?.apiFormat ||
          process.env[`${kind.toUpperCase()}_API_FORMAT`] ||
          "chat"
        : undefined;
    const status = key ? `key=${maskKey(key)}` : "key=❌ missing";
    if (!key) {
      // missing key 不算致命，只提示
    }
    console.log(
      `  ${kind}: ${status} · ${model} · ${url}${fmt ? ` · ${fmt}` : ""}`,
    );
  }

  // deps quick check
  console.log("\nDependencies");
  const nm = path.join(info.root, "node_modules");
  console.log(`  node_modules: ${fs.existsSync(nm) ? "yes" : "❌ missing → bun install"}`);
  if (!fs.existsSync(nm)) issues++;
  for (const dep of ["ink", "yaml", "zod", "react"]) {
    const p = path.join(nm, dep);
    console.log(`  ${dep}: ${fs.existsSync(p) ? "ok" : "❌ missing"}`);
    if (!fs.existsSync(p)) issues++;
  }

  console.log(
    issues === 0
      ? "\n✅ doctor: 未发现阻塞问题"
      : `\n⚠ doctor: ${issues} 个问题需要处理`,
  );
  return issues === 0 ? 0 : 1;
}
