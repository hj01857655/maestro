/**
 * Maestro — 核心类型定义。
 *
 * 整个编排系统的类型基石，所有模块共享的类型在此定义。
 */

/* ========== 消息 ========== */

/** 多模态 content part（Chat + Responses） */
export type MessageContentPart =
  | { type: "text" | "input_text"; text: string }
  | {
      type: "image_url" | "input_image";
      /** 直接 URL 或 data: URI */
      image_url: string | { url: string; detail?: "auto" | "low" | "high" };
    }
  | {
      type: "input_file" | "file";
      file_id?: string;
      file_url?: string;
      filename?: string;
      /** Chat file part 可带 file_data */
      file_data?: string;
    }
  | {
      /** Chat input_audio */
      type: "input_audio";
      input_audio: { data: string; format: "wav" | "mp3" | string };
    }
  | { type: string; [k: string]: unknown };

export interface Message {
  role: "system" | "user" | "assistant" | "tool" | "developer";
  content: string;
  name?: string;
  /**
   * 多模态 parts。Responses 路径优先用它生成 input_text / input_image；
   * Chat 路径映射为 text / image_url parts。
   */
  parts?: MessageContentPart[];
  /**
   * tool 回灌 id：
   * - chat → tool_call_id
   * - responses → function_call_output.call_id
   */
  callId?: string;
  /** tool 消息输出正文（缺省用 content） */
  toolOutput?: string;
  /**
   * assistant 历史中的 tool_calls（chat 多轮回放）。
   * 映射为 message.tool_calls。
   */
  toolCalls?: ProviderToolCall[];
  /**
   * Chat 音频多轮：assistant 历史引用先前 audio.id
   * → message.audio = { id }
   */
  audioId?: string;
}

/* ========== Provider ========== */

/** OpenAI 兼容协议形态（仅 openai/grok 等 OpenAI 系使用） */
export type OpenAIApiFormat = "chat" | "responses";

/** Responses function / 内置 tool 定义 */
export type ResponsesToolDefinition =
  | {
      type: "function";
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
      strict?: boolean;
    }
  | { type: "web_search" | "file_search" | "code_interpreter" | "computer_use" | string; [k: string]: unknown };

/** Responses text.format（结构化输出） */
export interface ResponsesTextFormat {
  type: "json_schema" | "text" | "json_object";
  name?: string;
  strict?: boolean;
  schema?: Record<string, unknown>;
}

/** Chat Completions tool_choice */
export type ChatToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } }
  | Record<string, unknown>;

/** Responses / Chat 共用 tool_choice（字符串或对象） */
export type ProviderToolChoice = ChatToolChoice | string | Record<string, unknown>;

/** reasoning_effort（chat）/ reasoning.effort（responses） */
export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | string;

/** Responses reasoning 配置 */
export interface ResponsesReasoningOptions {
  effort?: ReasoningEffort;
  summary?: "auto" | "concise" | "detailed" | string;
  generate_summary?: boolean;
  [k: string]: unknown;
}

/** 统一 invoke 选项（各 provider 取自己认识的字段） */
export interface ProviderInvokeOptions {
  temperature?: number;
  maxTokens?: number;
  /** nucleus sampling */
  topP?: number;
  /** 停用序列（chat；部分 reasoning 模型不支持） */
  stop?: string | string[];
  frequencyPenalty?: number;
  presencePenalty?: number;
  /** 采样种子（部分模型/网关支持） */
  seed?: number;
  /** 生成条数 n（chat，默认 1） */
  n?: number;
  /**
   * reasoning 强度：
   * - chat → reasoning_effort
   * - responses → reasoning.effort（可被 reasoning 对象覆盖）
   */
  reasoningEffort?: ReasoningEffort;
  /** Responses: reasoning 对象（effort/summary…） */
  reasoning?: ResponsesReasoningOptions;
  /** 输出详略：chat verbosity / responses text.verbosity */
  verbosity?: "low" | "medium" | "high" | string;
  /** Responses: 衔接上一次 response.id */
  previousResponseId?: string;
  /** Responses: 是否在服务端存储（Maestro 默认 false） */
  store?: boolean;
  /** Responses: conversation id 或 {id}（与 previousResponseId 互斥） */
  conversation?: string | { id: string };
  /** Responses: 后台运行 */
  background?: boolean;
  /** Responses: include 额外输出字段 */
  include?: string[];
  /** Responses: 内置 tool 调用上限 */
  maxToolCalls?: number;
  /**
   * tools：
   * - responses → 扁平 {type:function,name,...} / 内置 web_search
   * - chat → 自动嵌套为 {type:function,function:{name,...}}
   */
  tools?: ResponsesToolDefinition[];
  /**
   * 结构化输出：
   * - responses → text.format
   * - chat → response_format
   */
  textFormat?: ResponsesTextFormat;
  /**
   * tool_choice：
   * - chat / responses 均透传（none|auto|required|指定函数|对象）
   */
  toolChoice?: ProviderToolChoice;
  /** parallel_tool_calls（chat + responses） */
  parallelToolCalls?: boolean;
  /**
   * Chat token 上限字段策略：
   * - completion（默认）→ max_completion_tokens（官方推荐）
   * - legacy → max_tokens（旧模型/部分中转）
   * - both → 两个都发（兼容网关）
   */
  chatMaxTokensField?: "completion" | "legacy" | "both";
  /** 元数据（最多 16 对，官方限制由服务端校验） */
  metadata?: Record<string, string>;
  /** service_tier */
  serviceTier?: "auto" | "default" | "flex" | "scale" | "priority" | string;
  /** safety_identifier */
  safetyIdentifier?: string;
  /** prompt_cache_key */
  promptCacheKey?: string;
  /** Chat: web_search_options */
  webSearchOptions?: Record<string, unknown>;
  /** Chat: modalities 如 ["text"] / ["text","audio"] */
  modalities?: Array<"text" | "audio" | string>;
  /** Chat: audio 输出配置（配合 modalities:["audio"]） */
  audio?: {
    voice?: string;
    format?: "wav" | "mp3" | "flac" | "opus" | "pcm16" | "aac" | string;
    [k: string]: unknown;
  };
  /** Chat: prediction（预测输出加速） */
  prediction?:
    | { type: "content"; content: string | Array<Record<string, unknown>> }
    | Record<string, unknown>;
  /** Chat: logit_bias token→bias */
  logitBias?: Record<string, number>;
  /** Chat: logprobs */
  logprobs?: boolean;
  /** Chat: top_logprobs 0–20 */
  topLogprobs?: number;
  /** Chat: user（旧字段；新项目优先 safetyIdentifier + promptCacheKey） */
  user?: string;
  /**
   * Chat 也支持 store（蒸馏/评估）；
   * Responses 的 store 语义更强（previous_response_id 续聊默认 true）
   */
  /** 已在上面定义 store，chat 共用 */
  /** prompt_cache_options（chat/responses） */
  promptCacheOptions?: {
    mode?: "implicit" | "explicit" | string;
    ttl?: string;
    [k: string]: unknown;
  };
  /** Responses: prompt 模板引用 */
  prompt?: { id: string; version?: string; variables?: Record<string, unknown> };
  /** Responses: truncation auto|disabled（部分文档标 deprecated 仍透传） */
  truncation?: "auto" | "disabled" | string;
  /** stream_options 附加字段（chat/responses） */
  streamOptions?: Record<string, unknown>;
  /**
   * moderation 内联审核（chat/responses）：
   * { model?, policy?: { input?: {mode}, output?: {mode} } }
   */
  moderation?: {
    model?: string;
    policy?: {
      input?: { mode?: "score" | "block" | string; [k: string]: unknown };
      output?: { mode?: "score" | "block" | string; [k: string]: unknown };
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  /**
   * context_management（responses 等）：如 compaction
   * [{ type: "compaction", compact_threshold?: number, ... }]
   */
  contextManagement?: Array<Record<string, unknown>> | Record<string, unknown>;
  /**
   * 透传额外请求字段（最后合并，可覆盖同名键；用于官网新字段快速试用）
   * 不会覆盖 model / messages / input 等核心结构，除非调用方故意传入。
   */
  extraBody?: Record<string, unknown>;
}

/** 流式事件（invokeStreamEvents） */
export type ProviderStreamEvent =
  | { type: "text"; text: string }
  | {
      type: "tool_call_delta";
      index: number;
      callId?: string;
      name?: string;
      argumentsDelta?: string;
    }
  | {
      type: "done";
      toolCalls?: ProviderToolCall[];
      responseId?: string;
      status?: string;
      usage?: { inputTokens: number; outputTokens: number };
    }
  | { type: "error"; message: string };

/** 模型发出的 tool/function call（chat tool_calls / responses function_call） */
export interface ProviderToolCall {
  callId: string;
  name: string;
  arguments: string;
  type?: "function" | string;
  index?: number;
}

/** Chat 音频响应 message.audio */
export interface ProviderAudioResult {
  id?: string;
  /** base64 音频 */
  data?: string;
  /** 文本转写 */
  transcript?: string;
  expiresAt?: number;
  format?: string;
}

/**
 * Responses output item 归一化（message / reasoning / 内置 tool call 等）。
 * 保留 raw 便于上层按需取完整结构。
 */
export interface ProviderOutputItem {
  type: string;
  id?: string;
  status?: string;
  role?: string;
  /** function_call */
  callId?: string;
  name?: string;
  arguments?: string;
  /** reasoning summary / text */
  summary?: unknown;
  /** file_search queries / results 等 */
  queries?: unknown;
  results?: unknown;
  /** code_interpreter */
  code?: string;
  outputs?: unknown;
  /** web_search / computer 等动作 */
  action?: unknown;
  /** message content parts */
  content?: unknown;
  /** 原始 item */
  raw?: unknown;
}

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
  extraHeaders?: Record<string, string>;
  /**
   * OpenAI 系协议：
   * - chat → POST /v1/chat/completions（默认）
   * - responses → POST /v1/responses（OpenAI Responses API）
   */
  apiFormat?: OpenAIApiFormat;
}

export interface ProviderResult {
  content: string;
  model: string;
  provider: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    /** 细分（若服务端返回） */
    totalTokens?: number;
    reasoningTokens?: number;
    audioTokens?: number;
    cachedTokens?: number;
  };
  raw?: unknown;
  /** response.id / chatcmpl id，供 previous_response_id 或续聊 */
  responseId?: string;
  /** status / finish_reason */
  status?: string;
  /** 模型发起的 function tool calls */
  toolCalls?: ProviderToolCall[];
  /** Chat: message.audio */
  audio?: ProviderAudioResult;
  /** Chat: message.refusal（与 content 分离保留） */
  refusal?: string;
  /** Chat: choice.logprobs */
  logprobs?: unknown;
  /** 请求带 moderation 时的审核结果 */
  moderation?: unknown;
  /**
   * Responses: 完整 output items（reasoning / file_search_call /
   * code_interpreter_call / web_search_call / computer_call / message …）
   */
  outputItems?: ProviderOutputItem[];
  /** Responses: 仅 reasoning items 摘要 */
  reasoning?: ProviderOutputItem[];
  /** message annotations（引用、文件等） */
  annotations?: unknown[];
  /** service_tier 回显等 */
  serviceTier?: string;
}

export type ProviderKind = "claude" | "openai" | "gemini" | "grok";

/* ========== Agent ========== */

export interface AgentConfig {
  /** Agent 唯一标识 */
  name: string;
  /** 角色名称，如 "designer" / "coder" / "reviewer" */
  role: string;
  /** 绑定哪个 provider */
  provider: ProviderKind;
  /** 使用的模型名 */
  model: string;
  /** 系统提示词 */
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
  /** 是否启用本地 tools（默认按角色：coder/tester/reviewer 开） */
  enableTools?: boolean;
}

/* ========== Workflow ========== */

export type StepStatus = "pending" | "running" | "success" | "failed" | "skipped";

export interface Condition {
  /** 依赖的上游 step 名称 */
  sourceStep: string;
  /** 期望状态（不指定则只要完成即可） */
  status?: StepStatus;
  /**
   * 条件表达式，支持：
   *   exists | true | false
   *   status:success | status:failed
   *   contains:关键词
   *   equals:精确值
   *   matches:regex
   *   not:contains:xxx
   */
  when?: string;
}

export interface StepConfig {
  name: string;
  agent: string;
  /** prompt 模板，支持 {{ stepName }} 变量注入 */
  prompt: string;
  /** 依赖的上游 step */
  inputs?: string[];
  conditions?: Condition[];
  /** 单 step 失败后的额外重试次数（不含首次） */
  maxRetries?: number;
  /** 存入上下文的 key（默认 step.name） */
  outputKey?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface WorkflowConfig {
  name: string;
  description?: string;
  steps: StepConfig[];
  maxGlobalRetries?: number;
  onComplete?: string;
  /**
   * 产物输出目录。设置后每个 step 结果写入
   *   <outputDir>/<runId>/<step>.md 与 manifest.json
   */
  outputDir?: string;
}

/* ========== 运行时状态 ========== */

export interface RunState {
  workflowName: string;
  status: "running" | "completed" | "failed";
  startedAt: number;
  completedAt?: number;
  stepStates: Map<string, StepRunState>;
  context: Record<string, unknown>;
  error?: string;
}

export interface StepRunState {
  name: string;
  status: StepStatus;
  attempts: number;
  startedAt?: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
}
