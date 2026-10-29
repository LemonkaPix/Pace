import { useTheme } from "../shared/colors.js";
import React from "react";
import { Box, Text } from "ink";
import type { UsageLimits, UsageWindow } from "../integrations/usage.js";

function windowLabel(window: UsageWindow): string {
  const minutes = window.windowDurationMins;
  return minutes === null ? "Unknown window" : minutes % 1440 === 0 ? `${minutes / 1440}d` : minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

function resetLabel(seconds?: number): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds)) return undefined;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? `Resets ${date.toLocaleString()}` : undefined;
}

function Meter({
  label,
  window,
  width,
  showUsed = true,
}: {
  label: string;
  window: UsageWindow;
  width?: number;
  showUsed?: boolean;
}) {
  const theme = useTheme();
  const used = Math.max(0, Math.min(100, window.usedPercent));
  const left = 100 - used;
  const barWidth = Math.max(0, Math.min(20, (width ?? 80) - 4 - label.length - 3 - 10 - (showUsed ? 13 : 0)));
  const blocks = Math.round(left / 100 * barWidth);
  const empty = Math.max(0, barWidth - blocks);
  const barColor = left < 10 ? theme.error : left < 25 ? theme.warning : theme.success;
  const reset = resetLabel(window.resetsAt);

  return (
    <Box flexDirection="column">
      <Box gap={1} flexDirection={width !== undefined && width < 32 ? "column" : "row"}>
        <Box flexShrink={0}><Text color={theme.muted} bold>
          [{label}]
        </Text></Box>
        {barWidth > 0 ? <Box flexShrink={0}><Text>
          <Text color={barColor}>{"█".repeat(blocks)}</Text>
          <Text color={theme.border}>{"░".repeat(empty)}</Text>
        </Text></Box> : null}
        <Box flexShrink={0}><Text color={barColor} bold>
          {left.toFixed(0)}% left
        </Text></Box>
        {showUsed ? (
          <Box flexShrink={0}><Text color={theme.dim}>
            ({used.toFixed(0)}% used)
          </Text></Box>
        ) : null}
      </Box>
      <Text color={theme.muted} wrap="wrap">{reset ?? "Reset time unavailable"}</Text>
    </Box>
  );
}

export function UsageBar({
  limits,
  error,
  width,
  marginTop = 0,
}: {
  limits?: UsageLimits;
  error?: string;
  width?: number;
  marginTop?: number;
}) {
  const theme = useTheme();
  const showUsed = width === undefined || width >= 60;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1} width={width} marginTop={marginTop}>
      <Text color={theme.secondary} bold>◈ Codex Usage</Text>
      <Text color={theme.muted}>Account limits</Text>
      {limits?.primary ? <Meter label={windowLabel(limits.primary)} window={limits.primary} width={width} showUsed={showUsed} /> : null}
      {limits?.secondary ? <Meter label={windowLabel(limits.secondary)} window={limits.secondary} width={width} showUsed={showUsed} /> : null}
      {error && (limits?.primary || limits?.secondary) ? <Text color={theme.dim}>{error} · showing last reading</Text> : null}
      {!limits?.primary && !limits?.secondary ? (
        <Text color={theme.dim}>{error ?? (limits ? "Account limits unavailable" : "Loading usage…")}</Text>
      ) : null}
    </Box>
  );
}
