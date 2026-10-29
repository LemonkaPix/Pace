import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PaceStore, newSession } from '../src/core/sessions.js';
import { artifactDirectory, artifactId, artifactLabel, resolveArtifactId } from '../src/core/system/artifacts.js';
import { preparePlanExecution } from '../src/core/operations.js';
import { DEFAULT_CONFIG } from '../src/shared/config.js';
import { showCommandInfo } from '../src/components/app/info-commands.js';
import * as links from '../src/core/system/links.js';

let root: string;
afterEach(async () => { vi.restoreAllMocks(); if (root) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  root = await mkdtemp(join(tmpdir(), 'pace-artifact-ids-'));
  const store = new PaceStore(join(root, 'store'));
  const session = newSession(root, 'manual', 'normal');
  const directory = artifactDirectory(store, session);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'implementation.md'), '# Implement selected artifact\n');
  return { store, session, directory, id: artifactId(session.id, 'implementation.md') };
}
it('keeps a stable identity across updates, additions and reloads, scoped to the conversation', async () => {
  const { store, session, directory, id } = await fixture();
  const path = join(directory, 'implementation.md');
  expect(await resolveArtifactId(store, session, id.toUpperCase())).toBe(path);
  expect(await resolveArtifactId(store, session, id.slice(0, 6))).toBe(path);
  await writeFile(path, '# Updated\n');
  await writeFile(join(directory, 'aaa.md'), '# Another artifact');
  await store.saveChanges(session);
  expect(await resolveArtifactId(store, (await store.load(root, session.id))!, id)).toBe(path);
  expect(artifactLabel(store, session, 'artifacts/implementation.md')).toContain(`[${id}] ${path}`);
  const other = newSession(root, 'manual');
  await mkdir(artifactDirectory(store, other), { recursive: true });
  await writeFile(join(artifactDirectory(store, other), 'implementation.md'), '# Other');
  expect(artifactId(other.id, 'implementation.md')).not.toBe(id);
  await expect(resolveArtifactId(store, other, id)).rejects.toThrow('not found in this conversation');
});
it('rejects absent, invalid, legacy and symlink destinations without selecting a fallback plan', async () => {
  const { store, session, directory } = await fixture();
  session.plan = '# Must not execute fallback';
  for (const id of ['a-deadbeef', 'a-../../x', 'a-zxyz'])
    await expect(preparePlanExecution(store, session, DEFAULT_CONFIG, id)).rejects.toThrow(/artifact|Artifact/);
  const legacy = join(root, '.pace', 'artifacts');
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, 'legacy.md'), '# Legacy');
  await expect(resolveArtifactId(store, session, artifactId(session.id, 'legacy.md'))).rejects.toThrow('not found');
  await symlink(join(legacy, 'legacy.md'), join(directory, 'link.md'));
  await expect(resolveArtifactId(store, session, artifactId(session.id, 'link.md'))).rejects.toThrow('not found');
  expect(await store.list(root)).toEqual([]);
});
it('rejects ambiguous short IDs', async () => {
  const { store, session, directory } = await fixture();
  const seen = new Map<string, string>();
  let pair: [string, string, string] | undefined;
  for (let i = 0; i < 10000; i++) {
    const name = `artifact-${i}.md`, prefix = artifactId(session.id, name).slice(0, 6);
    if (seen.has(prefix)) { pair = [seen.get(prefix)!, name, prefix]; break; }
    seen.set(prefix, name);
  }
  expect(pair).toBeDefined();
  for (const name of pair!.slice(0, 2)) await writeFile(join(directory, name), '# Plan');
  await expect(resolveArtifactId(store, session, pair![2])).rejects.toThrow('ambiguous');
  expect(await resolveArtifactId(store, session, artifactId(session.id, pair![0]))).toBe(join(directory, pair![0]));
});
it('executes the selected artifact outside planning and preserves file, prompt and no-argument forms', async () => {
  const { store, session, directory, id } = await fixture();
  session.plan = '# Default plan';
  const selected = await preparePlanExecution(store, session, DEFAULT_CONFIG, `${id} skip Bash`);
  expect(selected.session.kind).toBe('normal');
  expect(selected.session.executionSource?.artifact).toBe(join(directory, 'implementation.md'));
  expect(selected.prompt).toContain('# Implement selected artifact');
  expect(selected.prompt).toContain('Additional user instructions:\nskip Bash');
  expect(selected.prompt).not.toContain('# Default plan');
  expect((await preparePlanExecution(store, session, DEFAULT_CONFIG)).prompt).toContain('# Default plan');
  expect((await preparePlanExecution(store, session, DEFAULT_CONFIG, 'keep tests')).prompt).toContain('Additional user instructions:\nkeep tests');
  const file = join(root, 'plan file.md');
  await writeFile(file, '# Explicit file');
  expect((await preparePlanExecution(store, session, DEFAULT_CONFIG, file)).prompt).toContain('# Explicit file');
  expect(await readFile(join(directory, 'implementation.md'), 'utf8')).toBe('# Implement selected artifact\n');
});
it('lists IDs and opens artifacts/folders using the existing OS opener, with visible errors', async () => {
  const { store, session, directory, id } = await fixture();
  const add = vi.fn();
  const open = vi.spyOn(links, 'openLink').mockResolvedValue();
  const options = { session, store, add, installedVersion: 'test', setMcpOpen: vi.fn(), setKnownModels: vi.fn() };
  await showCommandInfo('/artifacts', [], options);
  expect(add).toHaveBeenLastCalledWith('info', expect.stringContaining(`[${id}]`));
  await showCommandInfo('/artifacts', ['open', id], options);
  expect(open).toHaveBeenLastCalledWith(join(directory, 'implementation.md'));
  await showCommandInfo('/artifacts', ['folder'], options);
  expect(open).toHaveBeenLastCalledWith(directory);
  await showCommandInfo('/artifacts', ['open', 'a-deadbeef'], options);
  expect(add).toHaveBeenLastCalledWith('error', expect.stringContaining('not found'));
  expect(open).toHaveBeenCalledTimes(2);
  open.mockRejectedValueOnce(new Error('no desktop handler'));
  await showCommandInfo('/artifacts', ['open', id], options);
  expect(add).toHaveBeenLastCalledWith('error', expect.stringContaining('no desktop handler'));
});
