import React, { useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { COLOR_SCHEMES, ColorSchemeContext, getTheme, type ColorScheme } from "../shared/colors.js";
import { parseDiffRows } from "./FileDiffPanel.js";
import { PanelFrame } from "./PanelFrame.js";
import { Transcript, type Line } from "./Transcript.js";

const descriptions: Record<ColorScheme, string> = {
  default: "Sky, mint and indigo",
  ocean: "Cyan, blue and violet",
  warm: "Peach, gold and pink",
  forest: "Green, lime and teal",
  rose: "Rose, pink and magenta",
  violet: "Violet and lavender",
  amber: "Gold, cream and orange",
  slate: "Silver, gray and blue",
  mono: "Terminal foreground",
};
const patch = parseDiffRows('@@ -1,3 +1,3 @@\n export function greet() {\n-  return "Hello";\n+  return "Hello, world!";\n }');
const conversation: Line[] = [
  { id: 0, role: "you", text: "Update the greeting.", spaceBefore: false },
  { id: 1, role: "codex", text: "Updated `greet()` and checked the result.", spaceBefore: true },
  { id: 2, role: "info", text: "Checks passed · 1 file changed", spaceBefore: true },
];

export function ThemeManager({ scheme, width, height, onSave, onClose }: {
  scheme: ColorScheme; width: number; height: number;
  onSave: (scheme: ColorScheme) => Promise<void>; onClose: () => void;
}) {
  const [index, setIndex] = useState(COLOR_SCHEMES.indexOf(scheme));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const selected = COLOR_SCHEMES[index]!;
  const theme = getTheme(undefined, selected);
  const sidebarWidth = Math.min(26, Math.max(13, Math.floor((width - 2) * 0.25)));
  const previewWidth = Math.max(1, width - sidebarWidth - 3);
  const compact = height < 24;
  const listRows = Math.max(1, height - 6);
  const listStart = Math.max(0, Math.min(index - Math.floor(listRows / 2), COLOR_SCHEMES.length - listRows));

  useInput((input, key) => {
    if (pending.current) return;
    if (key.escape || (key.ctrl && input === "c")) { onClose(); return; }
    if (key.upArrow || key.downArrow || key.tab) {
      const direction = key.upArrow || (key.tab && key.shift) ? -1 : 1;
      setIndex(value => (value + direction + COLOR_SCHEMES.length) % COLOR_SCHEMES.length);
      setError(undefined);
    } else if (key.return) {
      pending.current = true; setSaving(true); setError(undefined);
      void onSave(selected).catch(error => {
        setError(`Could not save color scheme: ${String(error)}`);
      }).finally(() => { pending.current = false; setSaving(false); });
    }
  });

  return <ColorSchemeContext value={selected}>
    <PanelFrame width={width} height={height}
      actions={error ? <Text color={theme.error} wrap="truncate-end">{error}</Text> : saving ? <Text color={theme.warning}>Saving…</Text> : undefined}
      footer={width < 50 ? "↑/↓/Tab · Enter save · Esc cancel" : "↑/↓/Tab preview · Enter save · Esc cancel"}>
      <Text bold color={theme.primary}>Themes</Text>
      <Box flexGrow={1} minHeight={0} overflowY="hidden">
        <Box flexDirection="column" width={sidebarWidth} flexShrink={0} paddingRight={1}
          borderStyle="single" borderTop={false} borderBottom={false} borderLeft={false} borderColor={theme.border}>
          <Text bold color={theme.secondary}>{listRows < COLOR_SCHEMES.length ? `Theme ${index + 1}/${COLOR_SCHEMES.length}` : "Theme"}</Text>
          {COLOR_SCHEMES.slice(listStart, listStart + listRows).map((name, position) => <Text key={name} bold={listStart + position === index}
            color={listStart + position === index ? theme.primary : theme.muted} wrap="truncate-end">
            {listStart + position === index ? "❯" : " "} {name}{name === scheme ? " ✓" : ""}
          </Text>)}
          {!compact ? <Box marginTop={1} flexDirection="column">
            <Text color={theme.muted}>{descriptions[selected]}</Text>
            <Text color={theme.dim}>✓ Saved theme</Text>
          </Box> : null}
        </Box>
        <Box flexDirection="column" paddingLeft={1} width={previewWidth + 1} minHeight={0} overflowY="hidden">
          <Text color={theme.accent} bold wrap="truncate-end">Live preview · {selected}</Text>
          <Text color={theme.secondary} bold>Git diff · sample</Text>
          {!compact ? <Text color={theme.muted} wrap="truncate-end">src/greet.ts · Modified</Text> : null}
          {patch.map((row, position) => <Text key={position} wrap="truncate-end">
            <Text color={theme.dim}>{String(row.oldLine ?? "").padStart(2)} {String(row.newLine ?? "").padStart(2)} │ </Text>
            <Text color={row.kind === "addition" ? theme.success : row.kind === "deletion" ? theme.error : row.kind === "hunk" ? theme.accent : undefined}>{row.text}</Text>
          </Text>)}
          <Box marginTop={compact ? 0 : 1} flexDirection="column" minHeight={0} flexShrink={1} overflowY="hidden">
            <Text color={theme.secondary} bold>Conversation · sample</Text>
            <Transcript lines={compact ? conversation.slice(0, 2).map(line => ({ ...line, spaceBefore: false })) : conversation}
              outputsExpanded={false} detailsExpanded={false} width={previewWidth} />
            {!compact ? <Box borderStyle="round" borderColor={theme.border} paddingX={1}>
              <Text color={theme.primary}>❯ <Text color={theme.muted}>Ask Pace or type /</Text></Text>
            </Box> : null}
          </Box>
        </Box>
      </Box>
    </PanelFrame>
  </ColorSchemeContext>;
}
