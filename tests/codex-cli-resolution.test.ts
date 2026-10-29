import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

const lookup = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock('node:module', () => ({
  createRequire: () => ({ resolve: Object.assign(() => { throw new Error('stale cached resolution'); }, {
    paths: () => lookup.paths,
  }) }),
}));
import { codexCommand } from '../src/integrations/codex-cli.js';

it('keeps the dependency symlink path and resolves again after reinstall', () => {
  const root = mkdtempSync(join(tmpdir(), 'pace-codex-resolution-'));
  lookup.paths = [join(root, 'node_modules')];
  const launcher = join(lookup.paths[0]!, '@openai/codex/bin/codex.js');
  try {
    mkdirSync(join(launcher, '..'), { recursive: true });
    writeFileSync(launcher, '');
    expect(codexCommand()).toBe(launcher);
    rmSync(join(lookup.paths[0]!, '@openai'), { recursive: true });
    expect(() => codexCommand()).toThrow('Codex launcher is missing');
    mkdirSync(join(launcher, '..'), { recursive: true });
    writeFileSync(launcher, '');
    expect(codexCommand()).toBe(launcher);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
