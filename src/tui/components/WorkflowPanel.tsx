/**
 * WorkflowPanel — 显示 DAG 步骤状态
 */

import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { StepUiState } from "../state";
import { statusColor, statusIcon } from "../state";

interface Props {
  workflowName: string;
  steps: StepUiState[];
}

export function WorkflowPanel({ workflowName, steps }: Props) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} flexGrow={1}>
      <Box marginBottom={0}>
        <Text bold color="white">
          Workflow
        </Text>
        {workflowName ? (
          <Text color="cyan"> · {workflowName}</Text>
        ) : (
          <Text color="gray"> · (none)</Text>
        )}
      </Box>

      {steps.length === 0 ? (
        <Text color="gray">  还没有加载工作流 · /run &lt;path&gt;</Text>
      ) : (
        steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          const branch = isLast ? "└─" : "├─";
          const color = statusColor(step.status);

          return (
            <Box key={step.name} flexDirection="column">
              <Box>
                <Text color="gray">{branch} </Text>
                {step.status === "running" ? (
                  <Text color="cyan">
                    <Spinner type="dots" />{" "}
                  </Text>
                ) : (
                  <Text color={color}>{statusIcon(step.status)} </Text>
                )}
                <Text color={color} bold>
                  {step.name}
                </Text>
                <Text color="gray"> ({step.agent})</Text>
                {step.attempts > 1 && (
                  <Text color="yellow"> · retry#{step.attempts}</Text>
                )}
              </Box>
              {step.summary && (
                <Box marginLeft={4}>
                  <Text color="gray" dimColor>
                    {step.summary.slice(0, 70)}
                    {step.summary.length > 70 ? "…" : ""}
                  </Text>
                </Box>
              )}
              {step.error && (
                <Box marginLeft={4}>
                  <Text color="red">{step.error.slice(0, 80)}</Text>
                </Box>
              )}
            </Box>
          );
        })
      )}
    </Box>
  );
}
