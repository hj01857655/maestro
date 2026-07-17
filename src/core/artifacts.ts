/**
 * ArtifactStore — 工作流产物落盘。
 *
 * 每个 step 成功后写入:
 *   <outputDir>/<runId>/<stepName>.md
 *   <outputDir>/<runId>/manifest.json
 *   <outputDir>/<runId>/context.json
 *
 * 可选从模型输出中提取 ``` 代码块写成独立文件。
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface ArtifactWriteResult {
  dir: string;
  files: string[];
}

export interface StepArtifact {
  step: string;
  agent?: string;
  status: string;
  contentPath?: string;
  codeFiles?: string[];
  error?: string;
  attempts?: number;
}

export interface RunManifest {
  workflowName: string;
  runId: string;
  startedAt: string;
  completedAt?: string;
  status?: string;
  steps: StepArtifact[];
}

const FENCE_RE = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;

export class ArtifactStore {
  readonly rootDir: string;
  readonly runId: string;
  readonly runDir: string;
  private manifest: RunManifest;
  private written = new Set<string>();

  constructor(opts: {
    outputDir: string;
    workflowName: string;
    runId?: string;
  }) {
    this.rootDir = path.resolve(opts.outputDir);
    this.runId =
      opts.runId ??
      `${slug(opts.workflowName)}-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19)}`;
    this.runDir = path.join(this.rootDir, this.runId);
    this.manifest = {
      workflowName: opts.workflowName,
      runId: this.runId,
      startedAt: new Date().toISOString(),
      steps: [],
    };
  }

  ensureDir(): void {
    fs.mkdirSync(this.runDir, { recursive: true });
    fs.mkdirSync(path.join(this.runDir, "code"), { recursive: true });
  }

  writeStep(input: {
    step: string;
    agent?: string;
    status: string;
    content?: string;
    error?: string;
    attempts?: number;
  }): StepArtifact {
    this.ensureDir();
    const files: string[] = [];
    let contentPath: string | undefined;
    let codeFiles: string[] | undefined;

    if (input.content && input.status === "success") {
      contentPath = path.join(this.runDir, `${safeName(input.step)}.md`);
      const body = [
        `# ${input.step}`,
        ``,
        `agent: ${input.agent ?? "-"}`,
        `status: ${input.status}`,
        `attempts: ${input.attempts ?? 1}`,
        ``,
        `---`,
        ``,
        input.content,
        ``,
      ].join("\n");
      fs.writeFileSync(contentPath, body, "utf-8");
      files.push(contentPath);
      this.written.add(contentPath);

      codeFiles = this.extractCodeBlocks(input.step, input.content);
      files.push(...codeFiles);
    }

    if (input.error) {
      const errPath = path.join(this.runDir, `${safeName(input.step)}.error.txt`);
      fs.writeFileSync(errPath, input.error, "utf-8");
      files.push(errPath);
    }

    const entry: StepArtifact = {
      step: input.step,
      agent: input.agent,
      status: input.status,
      contentPath: contentPath ? path.relative(this.runDir, contentPath) : undefined,
      codeFiles: codeFiles?.map((f) => path.relative(this.runDir, f)),
      error: input.error,
      attempts: input.attempts,
    };

    const idx = this.manifest.steps.findIndex((s) => s.step === input.step);
    if (idx >= 0) this.manifest.steps[idx] = entry;
    else this.manifest.steps.push(entry);

    this.flushManifest();
    return entry;
  }

  writeContext(context: Record<string, unknown>): string {
    this.ensureDir();
    const p = path.join(this.runDir, "context.json");
    fs.writeFileSync(p, JSON.stringify(context, null, 2), "utf-8");
    return p;
  }

  finalize(status: string): ArtifactWriteResult {
    this.manifest.completedAt = new Date().toISOString();
    this.manifest.status = status;
    this.flushManifest();
    return {
      dir: this.runDir,
      files: Array.from(this.written),
    };
  }

  private flushManifest(): void {
    this.ensureDir();
    const p = path.join(this.runDir, "manifest.json");
    fs.writeFileSync(p, JSON.stringify(this.manifest, null, 2), "utf-8");
    this.written.add(p);
  }

  private extractCodeBlocks(step: string, content: string): string[] {
    const files: string[] = [];
    let match: RegExpExecArray | null;
    let index = 0;
    const re = new RegExp(FENCE_RE.source, "g");
    while ((match = re.exec(content)) !== null) {
      index++;
      const lang = (match[1] || "txt").toLowerCase();
      const code = match[2].replace(/\s+$/, "") + "\n";
      // 尝试从第一行注释提取文件名
      const named = code.match(
        /^(?:\/\/|#|\/\*)\s*([\w./\\-]+\.\w+)/,
      );
      const fileName = named
        ? safeName(path.basename(named[1]))
        : `${safeName(step)}-${index}.${extFor(lang)}`;
      const out = path.join(this.runDir, "code", fileName);
      fs.writeFileSync(out, code, "utf-8");
      files.push(out);
      this.written.add(out);
    }
    return files;
  }
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "run";
}

function safeName(name: string): string {
  return name.replace(/[^\w.一-鿿-]+/g, "_").slice(0, 80);
}

function extFor(lang: string): string {
  const map: Record<string, string> = {
    ts: "ts",
    typescript: "ts",
    js: "js",
    javascript: "js",
    tsx: "tsx",
    jsx: "jsx",
    py: "py",
    python: "py",
    rs: "rs",
    rust: "rs",
    go: "go",
    json: "json",
    yaml: "yaml",
    yml: "yml",
    md: "md",
    markdown: "md",
    sh: "sh",
    bash: "sh",
    css: "css",
    html: "html",
    sql: "sql",
  };
  return map[lang] ?? "txt";
}
