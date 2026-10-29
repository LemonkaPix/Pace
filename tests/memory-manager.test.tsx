import React from 'react';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'ink';
import { MemoryManager } from '../src/components/MemoryManager.js';
import type { MemorySetupService } from '../src/core/memory/setup.js';
import type { MemoryConfig, MemoryState } from '../src/core/memory/config.js';

class Terminal extends Writable { isTTY = true; columns = 120; rows = 40; writes: string[] = []; override _write(chunk: Buffer, _: BufferEncoding, done: () => void) { this.writes.push(chunk.toString()); done(); } }
const config: MemoryConfig = { version: 1, id: '11111111-1111-4111-8111-111111111111', canonicalPath: '/project', backend: 'basic-memory', backendVersion: '0.24.1', backendProject: 'pace-11111111-1111-4111-8111-111111111111', executable: '/bin/basic-memory', configDirectory: '/store/backend', dataDirectory: '/notes', enabled: true, revision: '22222222-2222-4222-8222-222222222222', setup: 'ready' };
const instances: ReturnType<typeof render>[] = [];
afterEach(() => { for (const instance of instances.splice(0)) instance.unmount(); });
async function mount(state: MemoryState = { state: 'unconfigured' }, width = 120, height = 38) {
  const service = { load: vi.fn().mockResolvedValue(state), loadGlobal: vi.fn().mockResolvedValue({}), saveGlobal: vi.fn(async input => ({ ...input, version: 1, revision: config.revision })), detect: vi.fn().mockResolvedValue({ executable: '/bin/basic-memory', uv: '/bin/uv' }), install: vi.fn().mockResolvedValue('/bin/basic-memory'), check: vi.fn().mockResolvedValue(undefined), setup: vi.fn().mockResolvedValue(config), repair: vi.fn().mockResolvedValue(config), toggle: vi.fn(async (value, enabled) => ({ ...value, enabled })) } as unknown as MemorySetupService;
  const stdout = Object.assign(new Terminal(), { columns: width, rows: height + 1 }), stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} }), onClose = vi.fn();
  const instance = render(<MemoryManager project="/project" baseDir="/store" width={width} height={height} service={service} onClose={onClose}/>, { stdin, stdout, stderr: new PassThrough(), patchConsole: false, alternateScreen: false, maxFps: 1000 }); instances.push(instance);
  const settle = async () => { await new Promise(resolve => setTimeout(resolve, 10)); await instance.waitUntilRenderFlush(); };
  const send = async (text: string) => { stdin.write(text); if (text === '\x1b') await new Promise(resolve => setTimeout(resolve, 70)); await settle(); };
  await settle(); return { service, frame: () => stdout.writes.join(''), send, onClose, instance };
}
it('opens first setup, reviews before mutation and reaches the ready empty panel', async () => {
  const ui = await mount(); expect(ui.frame()).toContain('Set up project memory');
  await ui.send('\r'); await ui.send('\r'); await ui.send('/new-notes'); await ui.send('\r');
  expect(ui.frame()).toContain('Configure and check connection'); expect(ui.service.setup).not.toHaveBeenCalled();
  await ui.send('\r'); expect(ui.service.setup).toHaveBeenCalledWith('/project', '/new-notes', '/bin/basic-memory', '/store', expect.any(AbortSignal), expect.any(Function));
  expect(ui.frame()).toContain('ready'); expect(ui.frame()).toContain('Zero notes is a valid ready database');
  await ui.send('\r'); expect(ui.frame()).toContain('disabled'); expect(ui.service.toggle).toHaveBeenCalledWith(config, false, '/store');
});
it('does not install or create data when first setup is cancelled', async () => {
  const ui = await mount(); await ui.send('\x1b'); expect(ui.onClose).toHaveBeenCalledOnce(); expect(ui.service.setup).not.toHaveBeenCalled(); expect(ui.service.install).not.toHaveBeenCalled();
});
it('keeps disabled memory in the panel without connecting to the backend', async () => {
  const ui = await mount({ state: 'disabled', config: { ...config, enabled: false } }); expect(ui.frame()).toContain('Enable memory'); expect(ui.service.check).not.toHaveBeenCalled(); expect(ui.service.detect).not.toHaveBeenCalled();
});
it('repairs the same unavailable project without launching first setup', async () => {
  const ui = await mount({ state: 'unavailable', config, error: 'offline' }); expect(ui.frame()).toContain('offline'); expect(ui.service.detect).not.toHaveBeenCalled();
  await ui.send('\x1b[B'); await ui.send('\r'); expect(ui.service.repair).toHaveBeenCalledWith(config, '/store', expect.any(AbortSignal)); expect(ui.service.setup).not.toHaveBeenCalled();
});
it('distinguishes incomplete setup and cancels pending installation on unmount', async () => {
  const ui = await mount({ state: 'configuring', pending: {} }); expect(ui.frame()).toContain('Previous setup is incomplete');
  vi.mocked(ui.service.detect).mockResolvedValue({ uv: '/bin/uv' }); await ui.send('\r'); await ui.send('\r'); await ui.send('\r'); await ui.send('/notes'); await ui.send('\r');
  expect(ui.service.install).not.toHaveBeenCalled();
  let signal: AbortSignal | undefined;
  vi.mocked(ui.service.install).mockImplementation(async (_uv, _base, abort) => { signal = abort; await new Promise((_resolve, reject) => abort?.addEventListener('abort', () => reject(new Error('cancelled')))); return ''; });
  await ui.send('\r'); expect(signal?.aborted).toBe(false); ui.instance.unmount(); expect(signal?.aborted).toBe(true); expect(ui.service.setup).not.toHaveBeenCalled();
});

it('enables and edits global-only preferences without installing the repo backend', async () => {
  const ui = await mount(); await ui.send('\x1b[B'); await ui.send('\r');
  expect(ui.frame()).toContain('Global memory · user preferences');
  await ui.send('\r');
  expect(ui.service.saveGlobal).toHaveBeenCalledWith({ enabled: true, content: '' }, '/store', null);
  await ui.send('\x1b[B'); await ui.send('\r'); await ui.send('Use Polish; ask before publishing.'); await ui.send('\r');
  expect(ui.service.saveGlobal).toHaveBeenLastCalledWith({ enabled: true, content: 'Use Polish; ask before publishing.' }, '/store', config.revision);
  await ui.send('\r');
  expect(ui.service.saveGlobal).toHaveBeenLastCalledWith({ enabled: false, content: 'Use Polish; ask before publishing.' }, '/store', config.revision);
  expect(ui.service.install).not.toHaveBeenCalled(); expect(ui.service.setup).not.toHaveBeenCalled(); expect(ui.service.detect).not.toHaveBeenCalled();
});

it('cancels a global preference edit without replacing the saved card', async () => {
  const ui = await mount(); await ui.send('\x1b[B'); await ui.send('\r');
  await ui.send('\x1b[B'); await ui.send('\r'); await ui.send('Unsubmitted preferences'); await ui.send('\x1b');
  expect(ui.service.saveGlobal).not.toHaveBeenCalled(); expect(ui.onClose).not.toHaveBeenCalled();
});

it.each([40, 80, 140])('keeps memory installation choices visible below long text at %i columns', async width => {
  const ui = await mount({ state: 'unconfigured' }, width, 18);
  vi.mocked(ui.service.detect).mockResolvedValue({ uv: '/bin/uv' });
  await ui.send('\r');
  expect(ui.frame()).toContain('Check installation again');
  expect(ui.frame()).toContain('Cancel');
  expect(ui.frame()).toContain('Esc close');
  await ui.send('\x1b[B'); await ui.send('\x1b[B'); await ui.send('\r');
  expect(ui.onClose).toHaveBeenCalledOnce();
  expect(ui.service.install).not.toHaveBeenCalled();
});
