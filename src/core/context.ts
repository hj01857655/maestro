/**
 * Context — Agent 间共享的上下文总线。
 *
 * 每个 Agent 的输出存入 context，后续 Agent 通过 {{ stepName }} 引用。
 * 支持模板渲染和嵌套字段访问。
 */

const TEMPLATE_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

export class Context {
  private store: Record<string, unknown> = {};

  /** 存储结果（通常是 step 输出） */
  set(key: string, value: unknown): void {
    this.store[key] = value;
  }

  /** 读取值 */
  get<T = unknown>(key: string): T | undefined {
    return this.store[key] as T | undefined;
  }

  /** 是否存在 */
  has(key: string): boolean {
    return key in this.store;
  }

  /** 合并多个值 */
  merge(values: Record<string, unknown>): void {
    Object.assign(this.store, values);
  }

  /** 渲染 prompt 模板，将 {{ key }} 替换为上下文中的值 */
  render(template: string, extra?: Record<string, unknown>): string {
    return template.replace(TEMPLATE_RE, (_match, key: string) => {
      const parts = key.trim().split(".");
      let value: unknown = this.store[parts[0]];

      // 在 extra 中查找
      if (value === undefined && extra && parts[0] in extra) {
        value = extra[parts[0]];
      }

      // 嵌套字段访问
      if (value !== undefined && parts.length > 1) {
        let obj = value as Record<string, unknown>;
        for (let i = 1; i < parts.length; i++) {
          if (obj && typeof obj === "object" && parts[i] in obj) {
            obj = (obj as Record<string, unknown>)[parts[i]] as Record<string, unknown>;
          } else {
            return _match;
          }
        }
        return String(obj ?? _match);
      }

      if (value === undefined) return _match;
      if (typeof value === "object") return JSON.stringify(value, null, 2);
      return String(value);
    });
  }

  /** 获取整个上下文的快照 */
  snapshot(): Record<string, unknown> {
    return { ...this.store };
  }

  /** 从快照恢复 */
  load(snapshot: Record<string, unknown>): void {
    this.store = { ...snapshot };
  }

  /** 清空 */
  clear(): void {
    this.store = {};
  }
}
