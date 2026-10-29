import { useTheme } from "../shared/colors.js";
import React from "react";
import { Box, Text } from "ink";
import type { Session } from "../shared/types.js";
import { menuWindow, resolveRepoTitle } from "./ConversationMenus.js";

export function ResumeMenu({
  choices,
  selectedIndex,
  runningIds = [],
  processIds = [],
  missingProjectPaths = [],
}: {
  choices: Session[];
  selectedIndex: number;
  runningIds?: string[];
  processIds?: string[];
  missingProjectPaths?: string[];
}) {
  const theme = useTheme();
  const processChoices = choices.filter(choice => processIds.includes(choice.id));
  const globalChoices = choices.filter(choice => !processIds.includes(choice.id));
  const orderedChoices = [...processChoices, ...globalChoices];
  const selectedId = choices[selectedIndex]?.id;
  const { start, end } = menuWindow(orderedChoices.length, Math.max(0, orderedChoices.findIndex(choice => choice.id === selectedId)));
  const visibleChoices = orderedChoices.slice(start, end);
  const renderChoice = (choice: Session) => {
    const index = choices.indexOf(choice);
    const selected = index === selectedIndex;
    const cleanPrompt = (choice.title || choice.turns[0]?.prompt || "(empty)").replace(/\s+/g, " ").trim();
    const shortPrompt = cleanPrompt.length > 45 ? `${cleanPrompt.slice(0, 42)}…` : cleanPrompt;
    const missing = missingProjectPaths.includes(choice.projectPath);
    return (
      <Box key={choice.id} gap={1}>
        <Text color={selected ? theme.primary : theme.dim} bold={selected}>{selected ? "▶" : " "}</Text>
        <Text color={selected ? theme.primary : theme.muted} bold={selected}>{choice.id.slice(0, 8)}</Text>
        <Text color={theme.dim}>{choice.updatedAt.slice(0, 16).replace("T", " ")}</Text>
        {missing ? <Text color={theme.error}>(unavailable)</Text> : null}
        <Text color={selected ? undefined : theme.muted}>{shortPrompt}</Text>
        {runningIds.includes(choice.id) ? <Text color={theme.warning}>(running)</Text> : null}
      </Box>
    );
  };
  const renderGroups = (items: Session[]) => {
    const groups = new Map<string, Session[]>();
    for (const choice of items) groups.set(choice.projectPath, [...(groups.get(choice.projectPath) ?? []), choice]);
    return [...groups].map(([path, sessions]) => (
      <React.Fragment key={path}>
        <Text color={missingProjectPaths.includes(path) ? theme.error : theme.muted}>
          {resolveRepoTitle(path, choices.map(choice => choice.projectPath)).title} {missingProjectPaths.includes(path) ? "(missing; use pace reconnect)" : ""}
        </Text>
        {sessions.map(renderChoice)}
      </React.Fragment>
    ));
  };
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.success} paddingX={1} marginBottom={1}>
      <Text color={theme.secondary} bold>◈ Resume Conversation</Text>
      {visibleChoices.some(choice => processIds.includes(choice.id)) ? <><Text color={theme.primary} bold>This Pace Process</Text>{renderGroups(visibleChoices.filter(choice => processIds.includes(choice.id)))}</> : null}
      {visibleChoices.some(choice => !processIds.includes(choice.id)) ? <><Text color={theme.primary} bold>Saved Projects</Text>{renderGroups(visibleChoices.filter(choice => !processIds.includes(choice.id)))}</> : null}
      {choices.length > 5 ? <Text color={theme.dim}>{start + 1}–{end} of {choices.length}</Text> : null}
      <Box marginTop={1}><Text color={theme.dim}>↑/↓ or Tab select · Enter resume available project · Esc close</Text></Box>
    </Box>
  );
}
