/**
 * 全局 CLI 参数解析。
 *
 * 支持（对齐 Claude 常用旗标的 Maestro 子集）:
 *   -c / --continue
 *   -r / --resume [id|query]
 *   -n / --name <name>
 *   -p / --print [prompt...]
 *   --model <model>
 *   -d / --debug / --verbose
 *   --output-format text|json
 *   --mock
 *   --role / --agent <role>
 */

export type OutputFormat = "text" | "json";

export interface GlobalCliOptions {
  continue: boolean;
  /** resume 引用；true = 列表/最近；string = id/query */
  resume: boolean | string;
  name?: string;
  print: boolean;
  printPrompt?: string;
  model?: string;
  verbose: boolean;
  outputFormat: OutputFormat;
  mock: boolean;
  role?: string;
  /** 去掉全局旗标后的剩余 argv */
  rest: string[];
}

export function parseGlobalArgs(argv: string[]): GlobalCliOptions {
  const opts: GlobalCliOptions = {
    continue: false,
    resume: false,
    print: false,
    verbose: false,
    outputFormat: "text",
    mock: false,
    rest: [],
  };

  const printParts: string[] = [];
  let i = 0;
  let capturingPrint = false;

  while (i < argv.length) {
    const a = argv[i]!;

    if (capturingPrint) {
      // print 模式下：已知全局旗标仍解析，其余并入 prompt
      if (
        a === "-c" ||
        a === "--continue" ||
        a === "-r" ||
        a === "--resume" ||
        a.startsWith("--resume=") ||
        a === "-n" ||
        a === "--name" ||
        a.startsWith("--name=") ||
        a === "--model" ||
        a.startsWith("--model=") ||
        a === "-d" ||
        a === "--debug" ||
        a === "--verbose" ||
        a === "--output-format" ||
        a.startsWith("--output-format=") ||
        a === "--mock" ||
        a === "--role" ||
        a === "--agent" ||
        a.startsWith("--role=") ||
        a.startsWith("--agent=")
      ) {
        // fall through to flag handlers below
      } else if (a === "--") {
        i++;
        continue;
      } else {
        printParts.push(a);
        i++;
        continue;
      }
    }

    if (a === "-c" || a === "--continue") {
      opts.continue = true;
      i++;
      continue;
    }

    if (a === "-r" || a === "--resume") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        opts.resume = next;
        i += 2;
      } else {
        opts.resume = true;
        i++;
      }
      continue;
    }
    if (a.startsWith("--resume=")) {
      const v = a.slice("--resume=".length);
      opts.resume = v || true;
      i++;
      continue;
    }

    if (a === "-n" || a === "--name") {
      const v = argv[i + 1];
      if (!v || v.startsWith("-")) throw new Error(`${a} 需要名称参数`);
      opts.name = v;
      i += 2;
      continue;
    }
    if (a.startsWith("--name=")) {
      opts.name = a.slice("--name=".length);
      i++;
      continue;
    }

    if (a === "-p" || a === "--print") {
      opts.print = true;
      capturingPrint = true;
      i++;
      continue;
    }
    if (a.startsWith("--print=")) {
      opts.print = true;
      printParts.push(a.slice("--print=".length));
      i++;
      continue;
    }

    if (a === "--model") {
      const v = argv[i + 1];
      if (!v || v.startsWith("-")) throw new Error("--model 需要参数");
      opts.model = v;
      i += 2;
      continue;
    }
    if (a.startsWith("--model=")) {
      opts.model = a.slice("--model=".length);
      i++;
      continue;
    }

    if (a === "-d" || a === "--debug" || a === "--verbose") {
      opts.verbose = true;
      i++;
      continue;
    }

    if (a === "--output-format") {
      const v = argv[i + 1];
      if (v !== "text" && v !== "json") {
        throw new Error("--output-format 仅支持 text|json");
      }
      opts.outputFormat = v;
      i += 2;
      continue;
    }
    if (a.startsWith("--output-format=")) {
      const v = a.slice("--output-format=".length);
      if (v !== "text" && v !== "json") {
        throw new Error("--output-format 仅支持 text|json");
      }
      opts.outputFormat = v;
      i++;
      continue;
    }

    if (a === "--mock") {
      opts.mock = true;
      i++;
      continue;
    }

    if (a === "--role" || a === "--agent") {
      const v = argv[i + 1];
      if (!v || v.startsWith("-")) throw new Error(`${a} 需要角色名`);
      opts.role = v;
      i += 2;
      continue;
    }
    if (a.startsWith("--role=") || a.startsWith("--agent=")) {
      opts.role = a.slice(a.indexOf("=") + 1);
      i++;
      continue;
    }

    opts.rest.push(a);
    i++;
  }

  if (printParts.length) {
    opts.printPrompt = printParts.join(" ").trim() || undefined;
  }

  return opts;
}
