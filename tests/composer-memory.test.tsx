import React from 'react';
import { renderToString, Text } from 'ink';
import { expect, it } from 'vitest';
import { ComposerFrame } from '../src/components/ComposerFrame.js';

it.each([20, 40, 80, 120])('keeps Memory Enabled below the input and parameters within a %i-column composer', width => {
  const render = (enabled: boolean, unavailable = false) => renderToString(
    <ComposerFrame width={width} shellMode={false} memoryEnabled={enabled} memoryUnavailable={unavailable}><Text>CHAT INPUT</Text></ComposerFrame>,
    { columns: width },
  ).trim().split('\n');
  const disabled = render(false), enabled = render(true), degraded = render(true, true);
  expect(disabled.join('\n')).not.toContain('Memory Enabled');
  expect(enabled.at(-1)).toBe('Memory Enabled');
  expect(enabled).toHaveLength(disabled.length + 1);
  expect(enabled.indexOf('Memory Enabled')).toBeGreaterThan(enabled.indexOf('CHAT INPUT'));
  expect(degraded.at(-1)).toContain('Memory Enabled');
  expect(degraded).toHaveLength(enabled.length);
  expect([...enabled, ...degraded].every(line => line.length <= width)).toBe(true);
});
