import { useTheme } from "../shared/colors.js";
import React from "react";
import { Box, Text } from "ink";
import type { ApprovalMode, Route, TurnSummary } from "../shared/types.js";
import { menuWindow } from "./conversation-menu-utils.js";

export { ConversationPicker } from "./ConversationPicker.js";
export { CommandMenu } from "./CommandMenu.js";
export { resolveRepoTitle, sortConversations, sectionConversations, menuWindow, truncateWithEllipsis, type ConversationChoice } from "./conversation-menu-utils.js";

export function ApprovalModeMenu({ selectedIndex, currentMode }: { selectedIndex: number; currentMode: ApprovalMode }) {
  const theme = useTheme();
  const modes: { id: ApprovalMode; description: string }[] = [
    { id: "request-approval", description: "Sandboxed turns; ask for risky commands" },
    { id: "limited", description: "Read-only turns; ask before each typed Bash command" },
    { id: "full-access", description: "Unrestricted Codex turns; typed Bash still blocks destructive patterns" },
  ];
  return <Box flexDirection="column" borderStyle="round" borderColor={theme.warning} paddingX={1} marginTop={1}>
    <Text color={theme.warning} bold>Approval mode</Text>
    {modes.map((mode, index) => <Box key={mode.id} gap={1}>
      <Text color={index === selectedIndex ? theme.secondary : theme.dim}>{index === selectedIndex ? "▶" : " "}</Text>
      <Text color={index === selectedIndex ? undefined : theme.muted}>{mode.id}{mode.id === currentMode ? " (current)" : ""}</Text>
      <Text color={theme.dim}>{mode.description}</Text>
    </Box>)}
    <Text color={theme.dim}>↑/↓ select · Enter save · Esc close</Text>
  </Box>;
}

export function ManualRouteMenu({
  routes,
  selectedIndex,
  currentRoute,
}: {
  routes: Route[];
  selectedIndex: number;
  currentRoute: Route;
}) {
  const theme = useTheme();
  const formatName = (route: Route) => {
    const name =
      route.model?.replace(
        /^gpt-(\d+)-(.+)$/,
        (_match, ver: string, n: string) =>
          `GPT-${ver} ${n[0]!.toUpperCase()}${n.slice(1)}`,
      ) ?? route.model ?? "Unknown";
    const effort = route.effort
      ? ` · ${route.effort[0]!.toUpperCase()}${route.effort.slice(1)}`
      : "";
    return `${name}${effort}`;
  };
  const isCurrent = (route: Route) =>
    route.model === currentRoute.model && route.effort === currentRoute.effort;
  const { start, end } = menuWindow(routes.length, selectedIndex);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1} marginTop={1}>
      <Text color={theme.primary} bold>Manual Route</Text>
      {routes.slice(start, end).map((route, offset) => {
        const index = start + offset;
        const selected = index === selectedIndex;
        const current = isCurrent(route);
        return (
          <Box key={`${route.model}-${route.effort}`} gap={1}>
            <Text color={selected ? theme.primary : theme.dim}>{selected ? "▶" : " "}</Text>
            <Text color={current ? theme.secondary : theme.dim}>{current ? "●" : "○"}</Text>
            <Text color={selected ? undefined : theme.muted}>
              {formatName(route)}
              {current ? " (current)" : ""}
            </Text>
          </Box>
        );
      })}
      {routes.length > 5 ? (
        <Text color={theme.dim}>
          {start + 1}–{end} of {routes.length}
        </Text>
      ) : null}
      <Text color={theme.dim}>↑/↓ select · Enter save · Esc close</Text>
    </Box>
  );
}

export function ManualWorkflowMenu({ title, options, selectedIndex }: {
  title: string;
  options: string[];
  selectedIndex: number;
}) {
  const theme = useTheme();
  const { start, end } = menuWindow(options.length, selectedIndex);
  return <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1} marginTop={1}>
    <Text color={theme.primary} bold>{title}</Text>
    {options.slice(start, end).map((option, offset) => <Box key={start + offset} gap={1}>
      <Text color={start + offset === selectedIndex ? theme.primary : theme.dim}>{start + offset === selectedIndex ? "▶" : " "}</Text>
      <Text color={start + offset === selectedIndex ? undefined : theme.muted}>{option}</Text>
    </Box>)}
    {options.length > 5 ? <Text color={theme.dim}>{start + 1}–{end} of {options.length}</Text> : null}
    <Text color={theme.dim}>↑/↓ select · Enter next · Esc close</Text>
  </Box>;
}

export function ConvoMenu({
  turns,
  selectedIndex,
}: {
  turns: TurnSummary[];
  selectedIndex: number;
}) {
  const theme = useTheme();
  const { start, end } = menuWindow(turns.length, selectedIndex);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1} marginBottom={1}>
      <Text color={theme.primary} bold>
        ◈ Conversation Turns ({turns.length} message{turns.length === 1 ? "" : "s"})
      </Text>
      {turns.slice(start, end).map((turn, offset) => {
        const index = start + offset;
        const selected = index === selectedIndex;
        const cleanPrompt = turn.prompt.replace(/\s+/g, " ").trim();
        const shortPrompt = cleanPrompt.length > 40 ? `${cleanPrompt.slice(0, 37)}…` : cleanPrompt;
        const model = turn.route?.model ?? "auto";
        return (
          <Box key={index} gap={1}>
            <Text color={selected ? theme.secondary : theme.dim} bold={selected}>
              {selected ? "▶" : " "}
            </Text>
            <Text color={selected ? theme.primary : theme.muted} bold={selected}>
              #{index + 1}
            </Text>
            <Text color={theme.dim}>{turn.at.slice(11, 16)}</Text>
            <Text color={selected ? undefined : theme.muted} bold={selected}>
              {shortPrompt}
            </Text>
            <Text color={theme.dim}>({model})</Text>
          </Box>
        );
      })}
      {turns.length > 5 ? <Text color={theme.dim}>{start + 1}–{end} of {turns.length}</Text> : null}
      <Box marginTop={1}>
        <Text color={theme.dim}>↑/↓ select · Enter edit from here · Backspace/d delete · Esc close</Text>
      </Box>
    </Box>
  );
}

export function QueueMenu({
  prompts,
  selectedIndex,
}: {
  prompts: readonly string[];
  selectedIndex: number;
}) {
  const theme = useTheme();
  const { start, end } = menuWindow(prompts.length, selectedIndex);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.warning} paddingX={1} marginTop={1}>
      <Text color={theme.warning} bold>
        Queued messages ({prompts.length})
      </Text>
      {prompts.slice(start, end).map((prompt, offset) => {
        const index = start + offset;
        const selected = index === selectedIndex;
        const cleanPrompt = prompt.replace(/\s+/g, " ").trim();
        const shortPrompt = cleanPrompt.length > 50 ? `${cleanPrompt.slice(0, 47)}…` : cleanPrompt;
        return (
          <Box key={index} gap={1}>
            <Text color={selected ? theme.secondary : theme.dim} bold={selected}>
              {selected ? "▶" : " "}
            </Text>
            <Text color={selected ? theme.primary : theme.muted} bold={selected}>
              #{index + 1}
            </Text>
            <Text color={selected ? undefined : theme.muted} bold={selected}>
              {shortPrompt}
            </Text>
          </Box>
        );
      })}
      {prompts.length > 5 ? <Text color={theme.dim}>{start + 1}–{end} of {prompts.length}</Text> : null}
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.dim}>↑/↓ select · S steer now (or Alt+M) · → edit in composer</Text>
        <Text color={theme.dim}>Alt+Del/Backspace/d delete · Esc close</Text>
      </Box>
    </Box>
  );
}
