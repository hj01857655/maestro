/**
 * CommandInput — 底部命令栏
 */

import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  statusLine: string;
  running?: boolean;
}

export function CommandInput({ value, onChange, onSubmit, statusLine, running }: Props) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="gray">{statusLine}</Text>
      </Box>
      <Box>
        <Text color="magenta" bold>
          {"> "}
        </Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={
            running
              ? "/stop 取消 · /quit 退出 · Tab 补全 · ↑↓"
              : "/help · Tab 补全 · /run ... --mock · /quit"
          }
        />
      </Box>
    </Box>
  );
}
