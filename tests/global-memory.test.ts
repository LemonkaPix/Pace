import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadGlobalMemory, saveGlobalMemory, GLOBAL_MEMORY_BYTES } from '../src/core/memory/global.js';
import { memoryRoot, MEMORY_POLICY } from '../src/core/memory/config.js';
import { AppServerRunner } from '../src/integrations/app-server-runner.js';
import { durableRunner } from '../src/core/task-execution.js';
import { newSession, PaceStore } from '../src/core/sessions.js';
import * as backend from '../src/integrations/basic-memory.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'pace-global-memory-')); roots.push(base); return base;
}
it('defaults to absent, preserves disabled preferences, bounds UTF-8 bytes and rejects stale saves', async () => {
  const base = await fixture(); expect(await loadGlobalMemory(base)).toEqual({});
  const config = await saveGlobalMemory({ enabled: true, content: 'Prefer Polish; ask before publishing.' }, base, null);
  await expect(saveGlobalMemory({ enabled: true, content: 'Stale editor' }, base, null)).rejects.toThrow('changed');
  const disabled = await saveGlobalMemory({ ...config, enabled: false }, base, config.revision);
  expect((await loadGlobalMemory(base)).config).toMatchObject({ enabled: false, content: config.content });
  await expect(saveGlobalMemory({ enabled: true, content: 'ą'.repeat(GLOBAL_MEMORY_BYTES) }, base, disabled.revision)).rejects.toThrow('UTF-8');
  await writeFile(join(memoryRoot(base), 'global.json'), '{broken');
  expect((await loadGlobalMemory(base)).error).toContain('unavailable');
  await expect(saveGlobalMemory({ enabled: true, content: 'Do not overwrite invalid settings' }, base, disabled.revision)).rejects.toThrow('unavailable');
});

it('loads global-only settings in either repo without starting a backend and freezes them for the invocation', async () => {
  const base = await fixture(), project = join(base, 'repo'), other = join(base, 'other'); await mkdir(project); await mkdir(other);
  const config = await saveGlobalMemory({ enabled: true, content: 'Use Polish.' }, base, null);
  const connect = vi.spyOn(backend, 'connectBasicMemory');
  for (const path of [project, other]) {
    const session = newSession(path, 'manual'), runner = { run: vi.fn().mockResolvedValue({ completed: true, result: 'done' }) };
    await durableRunner(runner, new PaceStore(base), session, 'main', 'final', false).run('Task', path, {}, undefined, () => {}, undefined, 'main', [], 'limited', undefined, { recallQuery: 'Task' });
    expect(runner.run.mock.calls[0]![10]).toMatchObject({ global: config });
    expect(runner.run.mock.calls[0]![10].scope).toBeUndefined();
  }
  expect(connect).not.toHaveBeenCalled();
});

it('injects bounded global preferences once, preserves them on repo failure and respects disabled runs', async () => {
  const base = await fixture();
  const global = await saveGlobalMemory({ enabled: true, content: 'Prefer Polish.' }, base, null);
  const inputs: any[] = [];
  const runner = new AppServerRunner(onMessage => ({
    setRequestHandler() {}, notify() {}, kill() {}, respond() {},
    async request(method, params) {
      if (method === 'mcpServerStatus/list') return { data: [] };
      if (method === 'thread/start' || method === 'thread/resume') return { thread: { id: 'thread' } };
      if (method === 'turn/start') {
        inputs.push(params);
        queueMicrotask(() => onMessage({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } }));
        return { turn: { id: 'turn' } };
      }
      return {};
    },
  }));
  await runner.run('New task', base, {}, undefined, () => {}, undefined, 'main', [], 'limited', undefined, { global });
  expect(JSON.stringify(inputs[0])).toContain('Prefer Polish.');
  expect(Buffer.byteLength(JSON.stringify(inputs[0]))).toBeLessThan(MEMORY_POLICY.recallBytes);
  await runner.run('Continue', base, {}, 'thread', () => {}, undefined, 'main', [], 'limited', undefined, { global });
  expect(JSON.stringify(inputs[1])).not.toContain('Prefer Polish.');
  await runner.run('Disabled', base, {}, undefined, () => {}, undefined, 'main', [], 'limited', undefined, { global, recallQuery: 'Task', disabled: true });
  expect(JSON.stringify(inputs[2])).not.toContain('Prefer Polish.');
  const executable = join(base, 'missing-backend');
  const scope = { config: { version: 1 as const, id: randomUUID(), canonicalPath: base, backend: 'basic-memory' as const, backendVersion: '0.24.1' as const, backendProject: `pace-${randomUUID()}`, executable, configDirectory: join(base, 'backend'), dataDirectory: base, enabled: true, revision: randomUUID(), setup: 'ready' as const }, baseDir: base, sessionId: randomUUID(), taskId: 'task', attemptId: randomUUID(), role: 'main' as const, startedAt: new Date().toISOString() };
  vi.spyOn(backend, 'connectBasicMemory').mockRejectedValue(Error('backend down'));
  const progress = vi.fn();
  await runner.run('Repo failed', base, {}, undefined, progress, undefined, 'main', [], 'limited', undefined, { global, scope, recallQuery: 'Task' });
  expect(JSON.stringify(inputs[3])).toContain('Prefer Polish.'); expect(progress).toHaveBeenCalledWith(expect.objectContaining({ kind: 'system', text: expect.stringContaining('degraded') }));
});
