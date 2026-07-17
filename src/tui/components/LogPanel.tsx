/**
 * LogPanel — 实时日志流
 */

import React from "react";
import { Box, Text } from "ink";
import type { LogEntry } from "../state";

interface Props {
  logs: LogEntry[];
  maxLines?: number;
}

function levelColor(level: LogEntry["level"]): string {
  switch (level) {
    case "success":
      return "green";
    case "error":
      return "red";
    case "warn":
      return "yellow";
    default:
      return "gray";
  }
}

export function LogPanel({ logs, maxLines = 12 }: Props) {
  const visible = logs.slice(-maxLines);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} height={maxLines + 3}>
      <Text bold color="white">
        Logs
      </Text>
      {visible.length === 0 ? (
        <Text color="gray">  (empty)</Text>
      ) : (
        visible.map((entry) => (
          <Box key={entry.id}>
            <Text color="gray">{entry.time} </Text>
            <Text color={levelColor(entry.level)}>
              {entry.message.replace(/\n/g, " ").slice(0, 90)}
            </Text>
          </Box>
        ))
      )}
    </Box>
  );
}
