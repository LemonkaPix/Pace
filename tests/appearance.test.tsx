import React from 'react';
import { Box, Text, renderToString } from 'ink';
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'string-width';
import { ColorSchemeContext, COLOR_SCHEMES, getTheme, supportsAnimation } from '../src/shared/colors.js';
import { DEFAULT_CONFIG, parseConfig } from '../src/shared/config.js';
import { PaceStore, newSession } from '../src/core/sessions.js';
import { ComposerFrame } from '../src/components/ComposerFrame.js';
import { BottomPanel } from '../src/components/BottomPanel.js';
import { PanelFrame } from '../src/components/PanelFrame.js';
import { ColorSweep } from '../src/components/WorkingStatus.js';
import { terminalLayout } from '../src/components/layout.js';
import { formatLiveUsage } from '../src/components/turn-format.js';
import { UsageBar } from '../src/components/UsageBar.js';
import { ThemeManager } from '../src/components/ThemeManager.js';

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

it.each([[40, 18], [60, 18], [80, 23], [120, 39], [140, 30]])('shows theme selection beside diff and conversation within %ix%i', (width, height) => {
  const output = stripVTControlCharacters(renderToString(<ThemeManager scheme="ocean" width={width!} height={height!}
    onSave={async () => {}} onClose={() => {}} />, { columns: width! }));
  const rows = output.trimEnd().split('\n');
  expect(rows).toHaveLength(height!);
  expect(output).toContain('❯ ocean ✓');
  expect(output).toContain('Git diff · sample');
  expect(output).toContain('Conversation · sample');
  expect(output).toContain('❯ You');
  expect(output).toContain('greeting.');
  expect(output).toContain('Enter save');
  expect(output).toContain('Esc cancel');
  expect(rows.some(row => row.indexOf('Git diff') > row.indexOf('default') && row.includes('default'))).toBe(true);
  for (const row of rows) expect(stringWidth(row)).toBeLessThanOrEqual(width!);
});

it('defaults, validates and persists each named scheme without changing semantic colors', async () => {
  root = await mkdtemp(join(tmpdir(), 'pace-color-schemes-'));
  const store = new PaceStore(root);
  const old = { ...DEFAULT_CONFIG }; delete old.colorScheme;
  expect(parseConfig(old).colorScheme).toBe('default');
  expect(() => parseConfig({ ...old, colorScheme: 'invalid' })).toThrow('colorScheme');
  for (const scheme of COLOR_SCHEMES) {
    const config = parseConfig({ ...old, colorScheme: scheme });
    await store.saveConfig(config);
    expect((await store.loadConfig()).colorScheme).toBe(scheme);
    const palette = getTheme('normal', scheme);
    if (scheme === 'mono') expect(Object.values(palette).every(value => value === undefined)).toBe(true);
    else {
      expect(palette.success).toBe(getTheme().success);
      expect(palette.error).toBe(getTheme().error);
      expect(palette.warning).toBe(getTheme().warning);
    }
  }
  expect(getTheme('normal', 'ocean').primary).not.toBe(getTheme('normal').primary);
  expect(getTheme('planning').primary).not.toBe(getTheme().primary);
  expect(new Set(COLOR_SCHEMES.filter(scheme => scheme !== 'mono').map(scheme => getTheme('normal', scheme).primary)).size).toBe(COLOR_SCHEMES.length - 1);
});

it.each(COLOR_SCHEMES)('renders %s with a selected marker and both sample previews', scheme => {
  const output = stripVTControlCharacters(renderToString(<ThemeManager scheme={scheme} width={120} height={30}
    onSave={async () => {}} onClose={() => {}} />, { columns: 120 }));
  expect(output).toContain(`❯ ${scheme} ✓`);
  expect(output).toContain(`Live preview · ${scheme}`);
  expect(output).toContain('Git diff · sample');
  expect(output).toContain('-  return "Hello";');
  expect(output).toContain('+  return "Hello, world!";');
  expect(output).toContain('Conversation · sample');
  expect(output).toContain('◆ Pace');
});

it.each(COLOR_SCHEMES)('keeps the selected %s theme visible in a short terminal', scheme => {
  const output = stripVTControlCharacters(renderToString(<ThemeManager scheme={scheme} width={40} height={10}
    onSave={async () => {}} onClose={() => {}} />, { columns: 40 }));
  expect(output).toContain(`❯ ${scheme} ✓`);
  expect(output).toContain('Enter save');
  expect(output).toContain('Esc cancel');
  expect(output.trimEnd().split('\n')).toHaveLength(10);
  for (const row of output.split('\n')) expect(stringWidth(row)).toBeLessThanOrEqual(40);
});

it.each([40, 49, 50, 71, 72, 77, 78, 111, 112, 117, 118, 140])('fits the dock and composer at width %i, with visible account units and approval mode', width => {
  const session = newSession('/tmp/pace-layout', 'auto');
  const render = (child: React.ReactNode) => stripVTControlCharacters(renderToString(child, { columns: width }));
  const composer = render(<Box width={width}><ComposerFrame width={width} session={session} shellMode={false}><Text>Draft remains editable</Text></ComposerFrame></Box>);
  expect(composer).toContain('Request Approval');
  expect(composer).toContain('Context');
  expect(composer).toContain('←');
  const dock = render(<BottomPanel width={width} height={30} queuedPrompts={['Next request']}
    conversations={{ choices: [{ id: 'first', prompt: 'First conversation', state: 'ready' }, { id: 'second', prompt: 'Second conversation', state: 'running' }], selectedIndex: 0, focused: false }}
    usageLimits={{ primary: { usedPercent: 20, windowDurationMins: 300 }, secondary: { usedPercent: 80, windowDurationMins: 10080 } }} />);
  for (const text of ['Conversations', 'Queued messages', 'Account limits', '80% left', '20% left']) expect(dock).toContain(text);
  for (const output of [composer, dock]) for (const line of output.split('\n')) expect(stringWidth(line)).toBeLessThanOrEqual(width);
  expect(terminalLayout(width).columns).toBe(width >= 118 ? 3 : width >= 78 ? 2 : 1);
});

it.each([40, 80, 140])('pins manager actions and full navigation beneath long content at width %i', width => {
  const output = renderToString(<PanelFrame width={width} height={18}
    actions={<Text>❯ Configure connection</Text>} footer="↑/↓ select · Enter choose · Esc cancel">
    <Text>{'Long setup description. '.repeat(100)}</Text>
  </PanelFrame>, { columns: width });
  expect(output.trimEnd().split('\n')).toHaveLength(18);
  expect(output).toContain('❯ Configure connection');
  expect(output).toContain('Esc cancel');
  for (const line of output.split('\n')) expect(stringWidth(line)).toBeLessThanOrEqual(width);
});

it('keeps the no-color/non-TTY status static and uses the same text during the color sweep', () => {
  expect(supportsAnimation({ isTTY: true }, {})).toBe(true);
  for (const env of [{ NO_COLOR: '' }, { FORCE_COLOR: '0' }, { TERM: 'dumb' }])
    expect(supportsAnimation({ isTTY: true }, env)).toBe(false);
  expect(supportsAnimation({ isTTY: false }, {})).toBe(false);
  expect(supportsAnimation({ isTTY: true }, {}, 'mono')).toBe(false);
  for (const scheme of COLOR_SCHEMES) for (const tick of [0, 1, 20]) {
    const output = renderToString(<ColorSchemeContext value={scheme}><ColorSweep text="Working" tick={tick} animated={scheme !== 'mono'} /></ColorSchemeContext>);
    expect(stripVTControlCharacters(output)).toBe('Working');
  }
});

it('explains unknown account windows, stale data and unavailable price estimates without inventing values', () => {
  const limits = { primary: { usedPercent: 37.5, windowDurationMins: null } };
  const original = structuredClone(limits);
  const output = renderToString(<UsageBar width={40} limits={limits} error="Connection unavailable" />, { columns: 40 });
  expect(output).toContain('Unknown window');
  expect(output).toContain('63% left');
  expect(output).toContain('Reset time unavailable');
  expect(output).toContain('showing');
  expect(output).toContain('last reading');
  expect(limits).toEqual(original);
  const usage = { input_tokens: 1234, output_tokens: 45, cached_input_tokens: 0, cache_write_input_tokens: 0, reasoning_output_tokens: 0 };
  const text = formatLiveUsage(usage, { model: 'unpriced-model' });
  expect(text).toContain('1.2k input tokens · 45 output tokens');
  expect(text).toContain('API estimate unavailable');
  expect(text).not.toContain('$0');
});

it('moves the color highlight without changing text and emits no color tokens for mono', async () => {
  const { createRequire } = await import('node:module');
  const chalk = (await import(createRequire(import.meta.resolve('ink')).resolve('chalk'))).default;
  const oldLevel = chalk.level;
  chalk.level = 3;
  try {
    const frame = (tick: number, mono = false) => renderToString(<ColorSchemeContext value={mono ? 'mono' : 'default'}><ColorSweep text="Working" tick={tick} animated={!mono} /></ColorSchemeContext>);
    const first = frame(0), next = frame(1);
    expect(first).not.toBe(next);
    expect(stripVTControlCharacters(first)).toBe('Working');
    expect(stripVTControlCharacters(next)).toBe('Working');
    expect(first).toMatch(/\x1b\[38;2;56;189;248mW/);
    expect(next).toMatch(/\x1b\[38;2;56;189;248mo/);
    expect(frame(0, true)).not.toMatch(/\x1b\[(?:38|48);/);
  } finally { chalk.level = oldLevel; }
});
