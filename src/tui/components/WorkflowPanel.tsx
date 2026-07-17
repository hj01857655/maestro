/**
 * WorkflowPanel — DAG 分层状态
 */

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { StepUiState } from "../state";
import { statusColor, statusIcon } from "../state";
import { formatDagLayers } from "../dag";

interface Props {
  workflowName: string;
  steps: StepUiState[];
  /** step → inputs */
  deps?: Map<string, string[]>;
}

export function WorkflowPanel({ workflowName, steps, deps }: Props) {
  const layers = useMemo(
    () => formatDagLayers(steps, deps),
    [steps, deps],
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      flexGrow={1}
    >
      <Box marginBottom={0}>
        <Text bold color="white">
          Workflow
        </Text>
        {workflowName ? (
          <Text color="cyan"> · {workflowName}</Text>
        ) : (
          <Text color="gray"> · (none)</Text>
        )}
        {layers.length > 1 && (
          <Text color="gray"> · {layers.length} layers</Text>
        )}
      </Box>

      {steps.length === 0 ? (
        <Text color="gray">  还没有加载工作流 · /run 或 /plan</Text>
      ) : deps && deps.size > 0 ? (
        layers.map((layer, li) => (
          <Box key={li} flexDirection="column">
            <Box>
              <Text color="gray">L{layer.depth} </Text>
              {layer.items.map((step, si) => (
                <Box key={step.name}>
                  {si > 0 && <Text color="gray"> │ </Text>}
                  <StepChip step={step} />
                </Box>
              ))}
            </Box>
            {li < layers.length - 1 && (
              <Box marginLeft={3}>
                <Text color="gray">↓</Text>
              </Box>
            )}
          </Box>
        ))
      ) : (
        steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          const branch = isLast ? "└─" : "├─";
          return (
            <Box key={step.name} flexDirection="column">
              <Box>
                <Text color="gray">{branch} </Text>
                <StepChip step={step} />
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

function StepChip({ step }: { step: StepUiState }) {
  const color = statusColor(step.status);
  if (step.status === "running") {
    return (
      <Text color="cyan">
        <Spinner type="dots" /> {step.name}
      </Text>
    );
  }
  return (
    <Text color={color} bold>
      {statusIcon(step.status)} {step.name}
    </Text>
  );
}
