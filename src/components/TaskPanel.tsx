import { useTheme } from "../shared/colors.js";
import React from "react";
import { Box, Text } from "ink";
import type { Task } from "../shared/types.js";

export function TaskPanel({ tasks }: { tasks: Task[] }) {
  const theme = useTheme();
  const plan = tasks.filter(task => task.source === "agent");
  if (!plan.length) return null;
  const pending = plan.filter(task => !task.completed);
  return <Box flexDirection="column" marginTop={1}>
    <Text color={theme.accent}>Codex plan · {plan.length - pending.length}/{plan.length} done · /tasks</Text>
    {pending.slice(0, 3).map(task => <Text key={task.id} color={theme.muted} wrap="truncate">{`  ○ ${task.text}`}</Text>)}
    {pending.length > 3 ? <Text dimColor>{`  +${pending.length - 3} more`}</Text> : null}
  </Box>;
}
