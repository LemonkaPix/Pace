import { useTheme } from "../shared/colors.js";
import React from "react";
import { Box, Text } from "ink";

export function QueuedMessages({
  prompts,
  width,
  maxItems = 5,
  marginTop = 0,
}: {
  prompts: readonly string[];
  width?: number;
  maxItems?: number;
  marginTop?: number;
}) {
  const theme = useTheme();
  if (!prompts.length) return null;
  const visible = prompts.slice(0, maxItems);
  const showHints = width === undefined || width >= 50;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1} width={width} marginTop={marginTop}>
      <Text color={theme.warning} bold wrap="truncate">
        ◈ Queued messages ({prompts.length}){showHints ? <Text color={theme.muted} dimColor> · ↓ select · → edit · Alt+M/S steer · Alt+Del remove</Text> : null}
      </Text>
      {visible.map((prompt, index) => (
        <Box key={index} gap={1}>
          <Box flexShrink={0}><Text color={theme.warning}>{index + 1}.</Text></Box>
          <Text color={theme.muted} wrap="truncate">{prompt.replace(/\s+/g, " ").trim()}</Text>
        </Box>
      ))}
      {prompts.length > visible.length ? <Text color={theme.dim}>+{prompts.length - visible.length} more queued</Text> : null}
    </Box>
  );
}
