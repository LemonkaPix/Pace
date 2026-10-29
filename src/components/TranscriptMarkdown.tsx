import { useTheme, type ThemePalette } from "../shared/colors.js";
import { Box, Text } from "ink";
import { terminalLink } from "../core/system/links.js";
import stringWidth from "string-width";

type MarkdownRun = { text: string; color?: string; bold?: boolean; italic?: boolean; underline?: boolean; dimColor?: boolean; code?: boolean; url?: string };

type Table = { header: string[]; rows: string[][]; align: ("left" | "center" | "right")[] };

function markdownRuns(source: string, theme?: ThemePalette): MarkdownRun[] {
  const runs: MarkdownRun[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~|"[^"\n]+"|'[^'\n]+'|\[[^\]]+\]\((?:<[^>]+>|(?:[^()]|\([^()]*\))+?)\))/g;
  let offset = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > offset) runs.push({ text: source.slice(offset, index) });
    const token = match[0];
    if (token.startsWith("`")) runs.push({ text: token.slice(1, -1), code: true, color: theme?.warning });
    else if (token.startsWith('"') || token.startsWith("'")) runs.push({ text: token.slice(1, -1), color: theme?.warning });
    else if (token.startsWith("**") || token.startsWith("__")) runs.push({ text: token.slice(2, -2), bold: true });
    else if (token.startsWith("~~")) runs.push({ text: token.slice(2, -2), dimColor: true });
    else if (token.startsWith("*") || token.startsWith("_")) runs.push({ text: token.slice(1, -1), italic: true });
    else {
      const link = /^\[([^\]]+)\]\((.+)\)$/.exec(token)!;
      runs.push({ text: link[1]!, color: theme?.primary, underline: true, url: link[2] });
    }
    offset = index + token.length;
  }
  if (offset < source.length) runs.push({ text: source.slice(offset) });
  return runs.length ? runs : [{ text: source }];
}

function Inline({ source, color, bold = false }: { source: string; color?: string; bold?: boolean }) {
  const theme = useTheme();
  return <Text color={color} bold={bold}>{markdownRuns(source, theme).map((run, index) => <Text key={index} color={run.color ?? color} bold={bold || run.bold} italic={run.italic} underline={run.underline} dimColor={run.dimColor}>{run.code ? <Text backgroundColor={theme.codeBg}>{run.text}</Text> : run.url ? terminalLink(run.text, run.url) : run.text}</Text>)}</Text>;
}

function tableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  const cells: string[] = [];
  let cell = "";
  let code = false;
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i]!;
    if (char === "\\" && trimmed[i + 1] === "|") { cell += "|"; i++; }
    else if (char === "`") { code = !code; cell += char; }
    else if (char === "|" && !code) { cells.push(cell.trim()); cell = ""; }
    else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function tableAt(lines: string[], index: number): Table | undefined {
  const headerLine = lines[index];
  const ruleLine = lines[index + 1];
  if (!headerLine || !ruleLine || (!headerLine.includes("|") && !ruleLine.includes("|"))) return undefined;
  const header = tableCells(headerLine);
  const rules = tableCells(ruleLine);
  if (header.length !== rules.length || !rules.every(cell => /^:?-{3,}:?$/.test(cell))) return undefined;
  const align = rules.map(cell => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left");
  const rows: string[][] = [];
  for (let i = index + 2; i < lines.length && lines[i]?.includes("|"); i++) rows.push(tableCells(lines[i]!));
  return { header, rows, align };
}

function displayedText(source: string): string {
  return markdownRuns(source).map(run => run.text).join("");
}

function columnWidths(table: Table, available: number): number[] {
  const widths = table.header.map((cell, index) => Math.max(3, ...[cell, ...table.rows.map(row => row[index] ?? "")].map(value => stringWidth(displayedText(value)))));
  const room = Math.max(table.header.length, available - (table.header.length * 3 + 1));
  while (widths.reduce((sum, width) => sum + width, 0) > room) {
    const widest = Math.max(...widths);
    const index = widths.findIndex(width => width === widest);
    if (widest <= 1) break;
    widths[index]!--;
  }
  return widths;
}

function TableBlock({ table, color, width }: { table: Table; color?: string; width: number }) {
  const theme = useTheme();
  if (width < table.header.length * 4 + 1) {
    return <Box flexDirection="column">{table.rows.length === 0 ? <Inline source={table.header.join(" | ")} color={theme.secondary} bold /> : table.rows.map((cells, rowIndex) => <Box key={rowIndex} flexDirection="column" borderLeft borderStyle="single" borderTop={false} borderRight={false} borderBottom={false} borderColor={theme.dim} paddingLeft={1}>
      {table.header.map((heading, index) => <Text key={index}><Text color={theme.secondary} bold>{displayedText(heading)}: </Text><Inline source={cells[index] ?? ""} color={color} /></Text>)}
    </Box>)}</Box>;
  }
  const widths = columnWidths(table, width);
  const border = (left: string, middle: string, right: string) => left + widths.map(size => "─".repeat(size + 2)).join(middle) + right;
  const row = (cells: string[], header: boolean, key: string) => <Box key={key} flexDirection="row">
    <Text color={theme.dim}>│ </Text>
    {widths.map((size, index) => {
      const value = cells[index] ?? "";
      const padding = Math.max(0, size - stringWidth(displayedText(value)));
      const alignment = table.align[index];
      const left = alignment === "right" ? padding : alignment === "center" ? Math.floor(padding / 2) : 0;
      return <Box key={index} flexDirection="row">
        <Box width={size} flexShrink={0}><Text wrap="truncate">{" ".repeat(left)}<Inline source={value} color={header ? theme.secondary : color} bold={header} /></Text></Box>
        <Text color={theme.dim}> {index === widths.length - 1 ? "│" : "│ "}</Text>
      </Box>;
    })}
  </Box>;
  return <Box flexDirection="column">
    <Text color={theme.dim}>{border("┌", "┬", "┐")}</Text>
    {row(table.header, true, "header")}
    <Text color={theme.dim}>{border("├", "┼", "┤")}</Text>
    {table.rows.map((cells, index) => row(cells, false, `row-${index}`))}
    <Text color={theme.dim}>{border("└", "┴", "┘")}</Text>
  </Box>;
}

export function MarkdownText({ source, color, width = 72 }: { source: string; color?: string; width?: number }) {
  const theme = useTheme();
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const code: string[] = [];
      while (++i < lines.length && !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[i]!)) code.push(lines[i]!);
      blocks.push(<Box key={i} borderLeft borderStyle="single" borderTop={false} borderRight={false} borderBottom={false} borderColor={theme.border} paddingLeft={1}><Text color={theme.warning}>{code.join("\n") || " "}</Text></Box>);
      continue;
    }
    const table = tableAt(lines, i);
    if (table) {
      blocks.push(<TableBlock key={i} table={table} color={color} width={width} />);
      i += 1 + table.rows.length;
      continue;
    }
    if (/^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line)) {
      blocks.push(<Text key={i} color={theme.border}>{"─".repeat(Math.max(3, Math.min(width, 56)))}</Text>);
      continue;
    }
    const heading = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+\s*)?$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      blocks.push(<Box key={i} flexDirection="row"><Text color={level <= 3 ? theme.secondary : theme.muted} bold>{level === 3 ? "▎ " : level < 3 ? "◆ " : "• "}</Text><Inline source={heading[2]!} color={level <= 3 ? theme.secondary : theme.muted} bold /></Box>);
      continue;
    }
    const list = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (list) {
      const indent = Math.min(12, list[1]!.replace(/\t/g, "  ").length);
      const task = /^\[([ xX])\]\s+(.*)$/.exec(list[3]!);
      const marker = task ? task[1]!.toLowerCase() === "x" ? "☑ " : "☐ " : /^\d/.test(list[2]!) ? `${list[2]} ` : "• ";
      blocks.push(<Box key={i} marginLeft={indent} flexDirection="row"><Text color={theme.secondary}>{marker}</Text><Box flexGrow={1} flexShrink={1}><Inline source={task?.[2] ?? list[3]!} color={color} /></Box></Box>);
      continue;
    }
    const quote = /^ {0,3}>\s?(.*)$/.exec(line);
    if (quote) {
      blocks.push(<Box key={i} flexDirection="row"><Text color={theme.dim}>│ </Text><Inline source={quote[1]!} color={theme.muted} /></Box>);
      continue;
    }
    blocks.push(<Inline key={i} source={line || " "} color={color} />);
  }
  return <Box flexDirection="column">{blocks}</Box>;
}
