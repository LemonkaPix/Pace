import { useTheme } from "../shared/colors.js";
import React from "react";
import { Box, Text } from "ink";
import type { Progress } from "../integrations/codex.js";
import { displayCommand } from "./shell-runner.js";

export function ApprovalPanel({ approval }: { approval: Extract<Progress, { kind: "approval" }> }) {
  const theme = useTheme();
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.warning} paddingX={1}>
      <Text color={theme.warning} bold>Approval required</Text>
      <Text>{displayCommand(approval.command)}</Text>
      {approval.cwd ? <Text dimColor>in {approval.cwd}</Text> : null}
      {approval.reason ? <Text dimColor>{approval.reason}</Text> : null}
      <Text color={theme.warning}>Y approve once · N decline · Esc twice to cancel turn</Text>
    </Box>
  );
}
