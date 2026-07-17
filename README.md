# Maestro 🎼

**多模型 Agent 编排平台** —— 让 Claude、Codex/GPT、Gemini、Grok 各展所长，协同完成软件工程流水线。

```
[需求] → Orchestrator(总管) → 拆解任务 → 分派给不同 Agent
                                       ├── Researcher (Grok)    → 搜索、一手证据
                                       ├── Designer  (Claude)   → 架构设计
                                       ├── Coder     (GPT-5.6)  → 代码实现
                                       ├── Reviewer  (Gemini)   → 审查质量
                                       └── ... 可扩展
```

## 核心理念

**模型各有所长，分工才是效率。**
- **Claude** → 复杂推理、架构设计、代码审查
- **Codex/GPT-5.6-sol** → 代码生成
- **Gemini** → 长上下文分析、文档
- **Grok** → 实时搜索、一手证据、逆向思维

## 技术栈

- **语言**：TypeScript
- **运行时**：Bun（原生 TypeScript + 高性能 I/O）
- **核心依赖**：Ink（TUI）+ zod（校验）+ yaml（工作流定义）

## 项目结构

```
maestro/
├── src/
│   ├── index.ts                # CLI 入口
│   ├── types.ts                # 核心类型定义
│   ├── core/
│   │   ├── orchestrator.ts     # 总管：任务调度、状态机
│   │   ├── agent.ts            # Agent 定义
│   │   ├── workflow.ts         # 工作流 DAG
│   │   └── context.ts          # 上下文总线
│   ├── providers/              # 模型适配层
│   │   ├── base.ts             # Provider 抽象接口
│   │   ├── claude.ts           # Anthropic Claude
│   │   ├── openai.ts           # OpenAI / Codex
│   │   ├── gemini.ts           # Google Gemini
│   │   └── grok.ts             # xAI Grok（含搜索接口）
│   ├── roles/                  # 预置角色配置
│   │   └── index.ts            # Planner / Researcher / Designer / Coder / Reviewer
│   ├── tui/                    # Ink 交互式终端界面（Action/Effect 架构）
│   │   ├── App.tsx             # 指挥台主界面 + effect runner
│   │   ├── actions.ts          # TuiAction / TuiEffect
│   │   ├── reducer.ts          # 纯函数状态更新
│   │   ├── state.ts            # TUI 可观察状态
│   │   ├── slash/              # Slash 命令注册表（对照 Grok Build）
│   │   └── components/         # 工作流、角色、日志、命令、Slash 下拉
│   ├── core/
│   │   ├── orchestrator.ts     # DAG 调度（真并行 Promise.all）+ 取消
│   │   └── events.ts           # Orchestrator 结构化事件
│   ├── testing/                # 测试与演示设施（非真实厂商）
│   │   └── MockProvider.ts
│   └── examples/
│       └── dev-workflow.yaml   # 功能开发流水线示例
└── tests/
```

## 预置角色

| 角色 | 模型 | 职责 |
|------|------|------|
| **Planner** | Claude Sonnet | 拆需求、排任务 |
| **Researcher** | Grok 4.5 | 实时搜索、一手证据 |
| **Designer** | Claude Opus 4.8 | 架构设计 |
| **Coder** | GPT-5.6-sol | 编码实现 |
| **Reviewer** | Gemini 2.5 Pro | 代码审查 |
| **Tester** | Claude Sonnet | 编写测试 |

## 快速开始

```bash
# 安装依赖
bun install

# 启动交互式 TUI（推荐）
bun run tui

# 或者直接使用 CLI
bun src/index.ts list-roles
```

### TUI 命令

```text
/help                              显示帮助
/roles                             列出预置角色
/providers                         查看 provider 配置
/config                            配置路径提示
/plan <需求> [--mock] [--test]     模板生成流水线并执行
/run <workflow.yaml> [--mock]      运行工作流
/show [step]                       查看 step 完整输出
/show close                        关闭预览
/stop                              取消当前工作流
/clear                             清空日志
/quit                              退出
```

快捷键：`Ctrl+C` 运行中取消 / 空闲退出；`↑` `↓` 命令历史或下拉选择；`Tab` 补全；`Esc` 关闭下拉。

输入 `/` 会弹出 Slash 命令下拉（前缀过滤）。

无需 API Key 的完整演示：

```text
/run src/examples/demo-mock.yaml --mock
/plan 实现用户登录 --mock
```

### CLI

```bash
bun src/index.ts validate src/examples/dev-workflow.yaml
bun src/index.ts plan "实现用户登录" --out .maestro/login.yaml --run --mock
bun src/index.ts config set claude apiKey=sk-ant-xxx model=claude-sonnet-4-6
bun src/index.ts config show
```

配置文件：`~/.maestro/config.json`（优先级：CLI 显式 > 环境变量 > 配置文件 > 默认）。

真实模型工作流：

```bash
export CLAUDE_API_KEY=sk-ant-xxx
export OPENAI_API_KEY=sk-xxx
export GEMINI_API_KEY=xxx
export GROK_API_KEY=xxx
# 或 maestro config set <kind> apiKey=...

bun src/index.ts run src/examples/dev-workflow.yaml
```

默认 baseUrl：

| Provider | 默认端点 |
|----------|----------|
| claude | `https://api.anthropic.com` |
| openai | `https://api.openai.com` |
| gemini | `https://generativelanguage.googleapis.com` |
| grok | `https://api.x.ai` |

Grok Researcher 走 **live search**（`search_parameters.mode=on` + citations），不是假 system prompt。

## 条件分支

```yaml
- name: risk_review
  agent: reviewer
  inputs: [research]
  conditions:
    - sourceStep: research
      when: "contains:risk"   # exists | status:success | contains:x | equals:x | matches:re | not:...
  prompt: "专项审查 {{ research }}"
```

条件不满足时 step 标记为 `skipped`，不阻塞无关下游。

## 产物落盘

工作流级或 CLI 设置 `outputDir`：

```yaml
outputDir: ".maestro/runs"
```

成功 step 写入：

```text
.maestro/runs/<runId>/
  manifest.json
  context.json
  <step>.md
  code/          # 从 markdown fence 提取的源文件
```

示例：

```bash
bun src/index.ts run src/examples/conditional-workflow.yaml --mock
```

## 工作流定义

工作流使用 YAML 定义，每个 step 指定 agent、prompt 模板和依赖关系：

```yaml
name: "功能开发流水线"
steps:
  - name: research
    agent: researcher
    prompt: "搜索关于 {{ request }} 的最佳实践"
  
  - name: design
    agent: designer
    inputs: [research]
    prompt: "基于 {{ research }} 设计架构方案"
  
  - name: code
    agent: coder
    inputs: [design]
    prompt: "按照 {{ design }} 实现代码"
  
  - name: review
    agent: reviewer
    inputs: [code]
    prompt: "审查以下代码：{{ code }}"
```

Step 之间通过 `{{ stepName }}` 模板语法传递上下文。

## Tools（Coder / Tester）

Agent 可输出 tool 块调用本地能力（路径限制在 workspace 内）：

```text
```tool
{"name":"read_file","arguments":{"path":"src/index.ts"}}
```
```

内置：`read_file` · `write_file` · `list_dir` · `run_cmd`。

## Planner

```bash
# 确定性模板：research → design → code → review
bun src/index.ts plan "实现搜索" --test --out .maestro/search.yaml
```

TUI：`/plan 实现搜索 --mock`。
