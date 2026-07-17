/**
 * InspectPanel — 查看 step 完整输出（/show）
 */

import React from "react";
import { Box, Text } from "ink";
import type { StepUiState } from "../state";
import { statusColor, statusIcon } from "../state";

interface Props {
  step: StepUiState;
  maxLines?: number;
}

export function InspectPanel({ step, maxLines = 18 }: Props) {
  const color = statusColor(step.status);
  const body =
    step.content ??
    step.summary ??
    step.error ??
    "(无内容 · 尚未完成或未捕获输出)";
  const lines = body.split("\n");
  const shown = lines.slice(0, maxLines);
  const more = lines.length > maxLines ? lines.length - maxLines : 0;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="magenta"
      paddingX={1}
      marginTop={1}
    >
      <Box>
        <Text bold color="magenta">
          Inspect
        </Text>
        <Text color={color}>
          {" "}
          {statusIcon(step.status)} {step.name}
        </Text>
        <Text color="gray"> ({step.agent})</Text>
        <Text color="gray"> · /show close 关闭</Text>
      </Box>
      {shown.map((line, i) => (
        <Text key={i} color="white">
          {line || " "}
        </Text>
      ))}
      {more > 0 && (
        <Text color="gray">… 另有 {more} 行 · 完整内容见产物目录</Text>
      )}
    </Box>
  );
}
