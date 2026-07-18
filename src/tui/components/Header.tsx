/**
 * Header — Maestro TUI 顶部栏
 */

import React from "react";
import { Box, Text } from "ink";
import type { TuiState } from "../state";

interface Props {
  state: TuiState;
}

export function Header({ state }: Props) {
  const modeLabel =
    state.mode === "running"
      ? "RUNNING"
      : state.mode === "completed"
        ? "DONE"
        : state.mode === "failed"
          ? "FAILED"
          : state.mode === "help"
            ? "HELP"
            : "IDLE";

  const modeColor =
    state.mode === "running"
      ? "cyan"
      : state.mode === "completed"
        ? "green"
        : state.mode === "failed"
          ? "red"
          : "gray";

  const sessionLabel = state.sessionId
    ? state.sessionName
      ? `${state.sessionId.slice(0, 8)} "${state.sessionName}"`
      : state.sessionId.slice(0, 8)
    : null;

  const permColor =
    state.permissionMode === "plan"
      ? "blue"
      : state.permissionMode === "auto"
        ? "gray"
        : state.permissionMode === "accept-edits"
          ? "green"
          : "yellow";

  return (
    <Box
      borderStyle="round"
      borderColor="magenta"
      paddingX={1}
      justifyContent="space-between"
      width="100%"
    >
      <Text bold color="magenta">
        🎼 Maestro
      </Text>
      <Text color="gray">
        {sessionLabel ? ` session ${sessionLabel} ` : " multi-model orchestrator "}
      </Text>
      <Box>
        <Text color={permColor}>
          [{state.permissionMode}]{" "}
        </Text>
        {state.mock && (
          <Text color="yellow" bold>
            [MOCK]{" "}
          </Text>
        )}
        <Text color={modeColor} bold>
          {modeLabel}
        </Text>
      </Box>
    </Box>
  );
}
