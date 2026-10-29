import { useTheme } from "../shared/colors.js";
import React from "react";
import { Box, Text } from "ink";
import { EFFORTS } from "../shared/config.js";
import type { Config } from "../shared/types.js";
import { menuWindow } from "./ConversationMenus.js";

export function ModelMenu({
  mode,
  models,
  availableModels = [],
  efforts = EFFORTS,
  catalogStatus,
  selectedModel,
  selectedIndex,
  config,
}: {
  mode: "models" | "efforts";
  models: string[];
  availableModels?: string[];
  efforts?: readonly (typeof EFFORTS)[number][];
  catalogStatus?: "loading" | "ready" | "unavailable";
  selectedModel: string;
  selectedIndex: number;
  config?: Config;
}) {
  const theme = useTheme();
  const items = mode === "models" ? models : efforts;
  const { start, end } = menuWindow(items.length, selectedIndex);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.success} paddingX={1} marginBottom={1}>
      <Text color={theme.secondary} bold>
        ◈ {mode === "models" ? "Codex Models" : `${selectedModel} Reasoning Levels`}
      </Text>
      {mode === "models" && catalogStatus === "loading" ? <Text color={theme.dim}>Refreshing Codex models…</Text> : null}
      {mode === "models" && catalogStatus === "unavailable" ? <Text color={theme.warning}>Codex model list unavailable; showing saved and priced models.</Text> : null}
      {items.slice(start, end).map((item, offset) => {
        const index = start + offset;
        const configured = config?.models.find(
          (model) => model.model === (mode === "models" ? item : selectedModel),
        );
        const enabled =
          mode === "models"
            ? !!configured && configured.enabled !== false
            : !!configured?.efforts.includes(item as (typeof EFFORTS)[number]);
        const selected = index === selectedIndex;
        return (
          <Box key={item} gap={1}>
            <Text color={selected ? theme.primary : theme.dim} bold={selected}>
              {selected ? "▶" : " "}
            </Text>
            <Text color={enabled ? theme.success : theme.dim} bold={enabled}>
              {enabled ? "●" : "○"}
            </Text>
            <Text color={selected ? undefined : undefined} bold={selected}>
              {item}
            </Text>
            {mode === "models" && configured ? (
              <Text color={theme.dim}>({configured.efforts.join(", ")})</Text>
            ) : null}
            {mode === "models" && catalogStatus === "ready" && !availableModels.includes(item) ? (
              <Text color={theme.warning}>(access unverified)</Text>
            ) : null}
          </Box>
        );
      })}
      {items.length > 5 ? <Text color={theme.dim}>{start + 1}–{end} of {items.length}</Text> : null}
      <Box marginTop={1}>
        <Text color={theme.dim}>
          {mode === "models"
            ? "↑/↓ or Tab select · Space toggle · Enter edit reasoning · Esc close"
            : "↑/↓ or Tab select · Space/Enter toggle · M use manually · Esc back"}
        </Text>
      </Box>
    </Box>
  );
}
