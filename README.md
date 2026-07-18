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

# 全局安装 CLI（任意目录可敲 maestro，像 claude / codex）
bun link

# 启动交互式 TUI
maestro
# 或显式
maestro tui
# 开发时也可用
bun run tui
```

卸载全局命令：`bun unlink maestro`（在本仓库目录执行 `bun unlink`）。

### TUI 命令

```text
/help                              显示帮助
/roles                             列出预置角色
/providers                         查看 provider 配置
/model [kind] [model]              查看/设置 provider 默认 model
/config                            配置路径与会话目录
/version                           版本与安装模式
/doctor                            快速健康检查
/cost                              本次运行 step 摘要
/plan <需求> [--mock] [--test]     模板生成流水线并执行
/run <workflow.yaml> [--mock]      运行工作流
/rerun                             重跑当前会话上次工作流
/show [step]                       查看 step 完整输出
/show close                        关闭预览
/stop                              取消当前工作流
/clear [--all]                     清空日志（--all 重置工作流面板）
/session                           当前会话信息
/sessions [--all] [query]          列出会话
/resume [id|query|latest]          加载历史会话
/export [path]                     导出当前会话摘要 JSON
/permissions [mode] [--save]       权限模式 plan|default|accept-edits|auto
/allow [always|tool|path|cmd]      确认当前 tool（always=会话记住）
/deny                              拒绝当前 tool
/always list|tool|path|cmd|…       会话/持久 always·deny 规则
/quit                              退出
```

快捷键：`Ctrl+C` 运行中取消 / 空闲退出；`↑` `↓` 命令历史或下拉选择；`Tab` 补全；`Esc` 关闭下拉 / 拒绝权限；待确认时 `y`/`n`/`a`（allow always tool）。

输入 `/` 会弹出 Slash 命令下拉（前缀过滤）。

### 权限模式

对齐 Claude / Grok 的 tool 门闸（默认 `auto`，兼容旧行为）：

| 模式 | 读 | 写 | 执行 |
|------|----|----|------|
| `plan` | ✓ | ✗ | ✗ |
| `default` | ✓ | 确认 | 确认 |
| `accept-edits` | ✓ | ✓ | 确认 |
| `auto` | ✓ | ✓ | ✓ |

```bash
maestro --permission-mode plan
maestro run wf.yaml --mock --perm default
# 或 env
set MAESTRO_PERMISSION_MODE=accept-edits
# 或写入 ~/.maestro/config.json → permissionMode
# TUI: /permissions plan --save
```

无交互（CLI / CI）下，`default`/`accept-edits` 的「确认」在无 handler 时拒绝。TUI 会弹出确认条，可用 `/allow` `/deny` 或 `y`/`n`/`a`。

#### Always / Deny 规则

叠加在 mode 之上（检查顺序：硬拒绝 → plan 风险拒绝 → always → mode → ask）：

| 规则 | 作用 |
|------|------|
| `alwaysAllowTools` | 跳过确认（`plan` 下写/执行仍拒绝） |
| `alwaysAllowPaths` | 路径前缀匹配时跳过确认 |
| `alwaysAllowCommands` | `run_cmd` 可执行名跳过确认 |
| `deniedPaths` | 硬拒绝（含 `auto`） |
| `deniedCommands` | 硬拒绝命令名（含 `auto`） |

```text
# TUI — 会话级（当前 Orchestrator）
/allow always                 # 放行并记住该 tool
/always tool write_file
/always path src/ tests/
/always cmd bun git
/always list
/always clear

# TUI — 写入 ~/.maestro/config.json → permissionRules
/always tool write_file --save
/always deny-path .env secrets/ --save
/always deny-cmd rm --save
/always clear --save
```

配置示例：

```json
{
  "version": 1,
  "permissionMode": "default",
  "permissionRules": {
    "alwaysAllowTools": ["write_file"],
    "alwaysAllowPaths": ["src/", ".maestro/"],
    "alwaysAllowCommands": ["bun", "git"],
    "deniedPaths": [".env", "secrets/"],
    "deniedCommands": ["rm"]
  }
}
```

无需 API Key 的完整演示：

```text
/run src/examples/demo-mock.yaml --mock
/plan 实现用户登录 --mock
/sessions
/resume latest
/rerun
/permissions plan
/always list
```

### CLI

```bash
maestro                    # 默认进 TUI
maestro help
maestro version
maestro doctor             # 检查 bun/git/配置/依赖
maestro update             # git pull + bun install（bun link 安装）
maestro update --check     # 只检查是否有更新

# 会话（对齐 claude -c / -r）
maestro -c                 # continue：当前目录最近会话
maestro -r [id|query]      # resume
maestro continue
maestro resume <id>
maestro sessions           # 列出当前目录会话
maestro sessions --all
maestro sessions show <id>
maestro sessions rm <id>

# 非交互 print（对齐 claude -p）
maestro -p "写一个 hello" --role coder --mock
maestro -p "总结 diff" --output-format json
maestro print "..." --model gpt-x

maestro list-roles
maestro validate src/examples/dev-workflow.yaml
maestro plan "实现用户登录" --out .maestro/login.yaml --run --mock
maestro config set claude apiKey=sk-ant-xxx model=claude-sonnet-4-6
maestro config set openai apiKey=sk-xxx model=gpt-5.6-sol apiFormat=responses
maestro config show
```

会话落盘：`~/.maestro/sessions/<id>.json`。

配置文件：`~/.maestro/config.json`（优先级：CLI 显式 > 环境变量 > 配置文件 > 默认）。

真实模型工作流：

```bash
export CLAUDE_API_KEY=sk-ant-xxx
export OPENAI_API_KEY=sk-xxx
export OPENAI_API_FORMAT=responses   # 可选：chat（默认）| responses
export GEMINI_API_KEY=xxx
export GROK_API_KEY=xxx
# 或 maestro config set <kind> apiKey=... [apiFormat=chat|responses]

maestro run src/examples/dev-workflow.yaml
```

默认 baseUrl：

| Provider | 默认端点 |
|----------|----------|
| claude | `https://api.anthropic.com` |
| openai | `https://api.openai.com` |
| gemini | `https://generativelanguage.googleapis.com` |
| grok | `https://api.x.ai` |

OpenAI / Grok 协议（`apiFormat`）：

| 值 | 端点 | 说明 |
|----|------|------|
| `chat`（默认） | `POST /v1/chat/completions` | 官方 Chat Completions |
| `responses` | `POST /v1/responses` | 官方 OpenAI Responses API |

`chat` 对齐官方字段：

- 请求：`model` · `messages`(system|user|assistant|tool|developer) · `max_completion_tokens`（默认；`chatMaxTokensField=legacy|both` 可发 `max_tokens`）· `temperature` · `top_p` · `frequency_penalty` · `presence_penalty` · `stop` · `seed` · `n` · `stream` · `stream_options` · `tools` · `tool_choice` · `parallel_tool_calls` · `response_format` · `reasoning_effort` · `verbosity` · `modalities` · `audio` · `prediction` · `logit_bias` · `logprobs` · `top_logprobs` · `metadata` · `service_tier` · `safety_identifier` · `prompt_cache_key` · `prompt_cache_options` · `web_search_options` · `store` · `user` · `extraBody`
- tools：统一扁平定义自动嵌套为 `{type:function,function:{name,description,parameters,strict}}`；跳过 chat 不支持的内置 tool（如 `web_search`）
- 多模态：`Message.parts` → `text` / `image_url` / `input_audio` / `file`
- 工具闭环：输出 `message.tool_calls` → 回灌 `role=tool` + `tool_call_id`（`toolResultMessage`）；历史回放 `assistant.tool_calls`
- 响应：`choices[0].message.content` / `refusal` / `tool_calls`；`finish_reason` → `status`；兼容弃用 `function_call`
- 流式：`choices[0].delta.content` · `delta.tool_calls` 按 index 聚合（`invokeStreamEvents`）· `data: [DONE]`

`responses` 对齐官方字段：

- 请求：`model` · `input` · `instructions` · `max_output_tokens` · `temperature` · `top_p` · `stream` · `stream_options` · `store` · `previous_response_id` · `conversation` · `background` · `include` · `max_tool_calls` · `tools` · `tool_choice` · `parallel_tool_calls` · `text.format` · `text.verbosity` · `reasoning` · `prompt` · `truncation` · `metadata` · `service_tier` · `safety_identifier` · `prompt_cache_key` · `prompt_cache_options` · `extraBody`
- 多模态：`input_text` / `input_image` / `input_file`（`Message.parts`）
- 工具闭环：输出 `function_call` → 回灌 `function_call_output`（`functionCallOutputMessage`）；历史 `assistant.toolCalls` → `function_call` items
- 响应：优先 `output_text`；遍历 `output[type=message].content[type=output_text]`；解析 `toolCalls` / `responseId`
- 流式：`response.output_text.delta` · `function_call_arguments.delta` 聚合 · `response.completed` / `failed`

也接受别名：`openai_responses` / `chat_completions`。环境变量：`OPENAI_API_FORMAT` / `GROK_API_FORMAT`。

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

默认走**原生 function calling**（Chat `tool_calls` / Responses `function_call`）：
Provider 下发 tools schema → 模型返回 `toolCalls` → Agent 本地执行 → 回灌
`role=tool` / `function_call_output`。无原生 `toolCalls` 时回落 markdown 块：

```text
```tool
{"name":"read_file","arguments":{"path":"src/index.ts"}}
```
```

内置：`read_file` · `write_file` · `list_dir` · `run_cmd`。
路径限制在 workspace 内。`toolMode: markdown` 可强制仅用 markdown。

## Planner

```bash
# 确定性模板：research → design → code → review
bun src/index.ts plan "实现搜索" --test --out .maestro/search.yaml

# 用 Planner 模型生成（失败回落模板）；可加 --mock 测通路
bun src/index.ts plan "实现搜索" --llm --mock --out .maestro/search.yaml
```

TUI：`/plan 实现搜索 --mock`。运行中非 tool 角色会推送 `step:stream`，`/show` 可看累积输出。Workflow 面板按依赖分层显示。

