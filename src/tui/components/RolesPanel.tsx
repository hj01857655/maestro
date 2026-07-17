/**
 * RolesPanel — 预置角色一览
 */

import React from "react";
import { Box, Text } from "ink";
import { BUILTIN_ROLES } from "../../roles";

export function RolesPanel() {
  const roles = Object.values(BUILTIN_ROLES);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} width={36}>
      <Text bold color="white">
        Roles
      </Text>
      {roles.map((role) => (
        <Box key={role.name} justifyContent="space-between">
          <Text color="cyan">{role.name.padEnd(12)}</Text>
          <Text color="gray">
            {role.provider}/{role.model.split("/").pop()?.slice(0, 14)}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
