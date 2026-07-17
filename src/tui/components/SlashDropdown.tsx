/**
 * SlashDropdown — 命令补全下拉
 *
 * 对照 Grok Build slash_dropdown：
 * - 选中高亮
 * - label + description 对齐
 * - 有限可见行
 */

import React from "react";
import { Box, Text } from "ink";
import type { SlashCommand } from "../slash";

export const MAX_VISIBLE = 6;

interface Props {
  items: SlashCommand[];
  selected: number;
  query: string;
}

export function SlashDropdown({ items, selected, query }: Props) {
  if (items.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="gray">无匹配命令 · /{query}</Text>
      </Box>
    );
  }

  const sel = Math.min(selected, items.length - 1);
  // 窗口滚动，保证选中可见
  const start = Math.max(0, Math.min(sel - MAX_VISIBLE + 1, items.length - MAX_VISIBLE));
  const visible = items.slice(Math.max(0, start), Math.max(0, start) + MAX_VISIBLE);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="magenta" paddingX={1}>
      <Text color="magenta" bold>
        Slash{" "}
        <Text color="gray" bold={false}>
          Tab 补全 · ↑↓ 选择 · Esc 关闭
        </Text>
      </Text>
      {visible.map((cmd) => {
        const absoluteIndex = items.indexOf(cmd);
        const isSelected = absoluteIndex === sel;
        return (
          <Box key={cmd.name}>
            <Text color={isSelected ? "magenta" : "gray"} bold={isSelected}>
              {isSelected ? "❯ " : "  "}
            </Text>
            <Text color={isSelected ? "white" : "cyan"} bold={isSelected}>
              {"/" + cmd.name.padEnd(10)}
            </Text>
            <Text color={isSelected ? "white" : "gray"}> {cmd.description}</Text>
          </Box>
        );
      })}
      {items.length > MAX_VISIBLE && (
        <Text color="gray">
          {"  "}… {items.length} matches
        </Text>
      )}
    </Box>
  );
}
