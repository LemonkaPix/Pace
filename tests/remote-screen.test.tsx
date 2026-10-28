import React from "react";
import { PassThrough, Writable } from "node:stream";
import { render } from "ink";
import qrcode from 'qrcode-terminal';
import { afterEach, expect, it, vi } from "vitest";
import App from "../src/components/App.js";
import { PaceStore } from "../src/core/sessions.js";
import { VexRouter } from "../src/core/vex/client.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import * as pricing from "../src/core/routing/pricing.js";
import * as models from "../src/integrations/models.js";
import * as usage from "../src/integrations/usage.js";
import * as npmVersion from "../src/core/npm-version.js";
import * as skills from "../src/core/system/skills.js";
import { Orchestrator } from "../src/core/orchestrator.js";
import * as transport from '../src/remote/server.js';
import * as security from '../src/remote/security.js';
import { RemoteManager, wrapRemoteLogs } from '../src/components/RemoteManager.js';
import * as memoryConfig from '../src/core/memory/config.js';
import * as globalMemory from '../src/core/memory/global.js';
import { memorySetupService } from '../src/core/memory/setup.js';

vi.mock("../src/benchmark/preferences.js",()=>({loadPreferences:async()=>undefined,savePreferences:async()=>{},baselineChoices:async()=>[]}));

class Terminal extends Writable {
  isTTY = true;
  columns = 120;
  rows = 50;
  writes: string[] = [];
  override _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
    this.writes.push(chunk.toString());
    done();
  }
}

const instances: ReturnType<typeof render>[] = [];
afterEach(() => {
  for (const instance of instances.splice(0)) instance.unmount();
  vi.restoreAllMocks();
});

async function mount() {
  vi.spyOn(memoryConfig, 'loadMemory').mockResolvedValue({ state: 'unconfigured' });
  vi.spyOn(globalMemory, 'loadGlobalMemory').mockResolvedValue({});
  vi.spyOn(PaceStore.prototype, "loadConfig").mockResolvedValue({ ...structuredClone(DEFAULT_CONFIG), skillFolder: null });
  vi.spyOn(PaceStore.prototype, "listProjects").mockResolvedValue([]);
  const save = vi.spyOn(PaceStore.prototype, "saveChanges").mockResolvedValue();
  const saveFeedback = vi.spyOn(PaceStore.prototype, "saveFeedback").mockResolvedValue("/tmp/pace/feedback/inbox/feedback.json");
  vi.spyOn(VexRouter.prototype, "start").mockResolvedValue();
  vi.spyOn(VexRouter.prototype, "close").mockResolvedValue();
  vi.spyOn(pricing, "refreshVersionManifest").mockResolvedValue(pricing.currentVersionManifest());
  vi.spyOn(models, "readAvailableModels").mockResolvedValue([]);
  vi.spyOn(usage, "readUsageLimits").mockResolvedValue({});
  vi.spyOn(npmVersion, "latestNpmVersion").mockResolvedValue(undefined);
  vi.spyOn(skills, "configuredSkills").mockResolvedValue([]);
  const stdout = new Terminal();
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const onClear = vi.fn();
  const instance = render(<App onClear={onClear} />, {
    stdin, stdout, stderr: new PassThrough(), interactive: true, patchConsole: false,
    alternateScreen: false, maxFps: 1000,
  });
  instances.push(instance);
  await vi.waitFor(() => expect(stdout.writes.join("")).toContain("Ask Pace or type /"));
  await instance.waitUntilRenderFlush();
  return {
    stdout, stdin, instance, onClear, save, saveFeedback,
    async submit(text: string) {
      stdin.write(text);
      await instance.waitUntilRenderFlush();
      stdin.write("\r");
      await instance.waitUntilRenderFlush();
    },
  };
}

function remoteHost() {
  vi.spyOn(security, 'lanAddresses').mockReturnValue(['192.168.1.2']);
  let options: Parameters<typeof transport.startRemoteHost>[0];
  const pairing = { v: 1 as const, address: 'https://192.168.1.2:8443', fingerprint: 'a'.repeat(64), token: 'b'.repeat(64), expiresAt: Date.now() + 120000 };
  const close = vi.fn(async () => { await options.domain.close(); options.onLog?.({ kind: 'host', message: 'Remote host stopped.' }); options.onClose?.(); });
  const newPairing = vi.fn(() => ({ ...pairing, token: 'c'.repeat(64), expiresAt: Date.now() + 120000 }));
  const host = { address: pairing.address, pairing, close, newPairing };
  const start = vi.spyOn(transport, 'startRemoteHost').mockImplementation(async value => { options = value; return host; });
  return { host, start, log: (event: transport.RemoteLog) => options.onLog?.(event) };
}

it('opens /remote as a dedicated QR screen and retains background logs across close/reopen until explicit stop', async () => {
  const generate = vi.spyOn(qrcode, 'generate');
  const remote = remoteHost(); const ui = await mount();
  await ui.submit('/remote');
  await vi.waitFor(() => expect(ui.stdout.writes.join('')).toContain('Scan with Pace Remote'));
  expect(ui.stdout.writes.join('')).toMatch(/[▀▄█]/);
  expect(generate).toHaveBeenCalledWith(JSON.stringify(remote.host.pairing), { small: true }, expect.any(Function));
  expect(remote.start).toHaveBeenCalledOnce();
  remote.log({ kind: 'paired', message: 'Device paired: Phone' });
  await vi.waitFor(() => expect(ui.stdout.writes.join('')).toContain('Device paired: Phone'));
  ui.stdout.writes.length = 0;
  ui.stdin.write('\x1b'); await ui.instance.waitUntilRenderFlush();
  await vi.waitFor(() => expect(ui.stdout.writes.join('')).toContain('Ask Pace or type /'));
  expect(remote.host.close).not.toHaveBeenCalled();
  remote.log({ kind: 'request', message: 'Background request: prompts.send' });
  ui.stdout.writes.length = 0;
  await ui.submit('/remote');
  await vi.waitFor(() => expect(ui.stdout.writes.join('')).toContain('Background request: prompts.send'));
  expect(ui.stdout.writes.join('')).toContain('Device paired: Phone');
  expect(remote.start).toHaveBeenCalledOnce(); expect(remote.host.close).not.toHaveBeenCalled();
  ui.stdin.write('p'); await ui.instance.waitUntilRenderFlush();
  expect(remote.host.newPairing).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(ui.stdout.writes.join('')).toContain('Scan with Pace Remote'));
  ui.stdout.writes.length = 0;
  ui.stdin.write('\x1b'); await ui.instance.waitUntilRenderFlush();
  await vi.waitFor(() => expect(ui.stdout.writes.join('')).toContain('Ask Pace or type /'));
  await ui.submit('/remote stop');
  await vi.waitFor(() => expect(remote.host.close).toHaveBeenCalledOnce());
});

it('allows closing during startup and honors /remote stop after startup completes', async () => {
  const remote = remoteHost();
  const start = remote.start.getMockImplementation()!;
  let ready!: () => void;
  remote.start.mockImplementationOnce(async options => {
    await new Promise<void>(resolve => { ready = resolve; });
    return start(options);
  });
  const ui = await mount(); await ui.submit('/remote');
  await vi.waitFor(() => expect(remote.start).toHaveBeenCalledOnce());
  ui.stdout.writes.length = 0;
  ui.stdin.write('\x1b'); await ui.instance.waitUntilRenderFlush();
  await vi.waitFor(() => expect(ui.stdout.writes.join('')).toContain('Ask Pace or type /'));
  await ui.submit('/remote stop');
  expect(remote.host.close).not.toHaveBeenCalled();
  ready();
  await vi.waitFor(() => expect(remote.host.close).toHaveBeenCalledOnce());
});

it('keeps the screen usable after a stop failure and lets the user retry', async () => {
  const remote = remoteHost();
  const ui = await mount(); await ui.submit('/remote');
  await vi.waitFor(() => expect(ui.stdout.writes.join('')).toContain('Scan with Pace Remote'));
  remote.host.close.mockRejectedValueOnce(new Error('Close failed'));
  ui.stdin.write('s'); await ui.instance.waitUntilRenderFlush();
  await vi.waitFor(() => expect(ui.stdout.writes.join('')).toContain('Stop failed'));
  ui.stdin.write('s'); await ui.instance.waitUntilRenderFlush();
  await vi.waitFor(() => expect(remote.host.close).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(ui.stdout.writes.join('')).toContain('Remote host stopped.'));
});

it('defaults to keeping an existing session and requires explicit selection before overriding', async () => {
  const remote = remoteHost(); const locked = new security.RemoteLockError(JSON.stringify({ pid: 4242 }));
  remote.start.mockRejectedValueOnce(locked);
  const takeover = vi.spyOn(security, 'overrideRemoteLock').mockResolvedValue();
  const ui = await mount(); await ui.submit('/remote');
  await vi.waitFor(() => expect(ui.stdout.writes.join('')).toContain('Override this remote session?'));
  expect(ui.stdout.writes.join('')).toContain('recorded PID 4242');
  expect(takeover).not.toHaveBeenCalled();
  ui.stdin.write('\r'); await ui.instance.waitUntilRenderFlush();
  expect(takeover).not.toHaveBeenCalled();
  remote.start.mockRejectedValueOnce(locked);
  await ui.submit('/remote');
  await vi.waitFor(() => expect(remote.start).toHaveBeenCalledTimes(2));
  await ui.instance.waitUntilRenderFlush();
  ui.stdin.write('\x1b[B'); await ui.instance.waitUntilRenderFlush();
  ui.stdin.write('\r'); await ui.instance.waitUntilRenderFlush();
  await vi.waitFor(() => expect(takeover).toHaveBeenCalledWith(expect.any(String), locked));
  await vi.waitFor(() => expect(remote.start).toHaveBeenCalledTimes(3));
  await vi.waitFor(() => expect(ui.stdout.writes.join('')).toContain('Scan with Pace Remote'));
});

it('shows takeover and startup failures in the screen and allows retry', async () => {
  const remote = remoteHost();
  remote.start.mockRejectedValueOnce(new security.RemoteLockError('4242'));
  vi.spyOn(security, 'overrideRemoteLock').mockRejectedValue(new Error('Previous host is still stopping'));
  const ui = await mount(); await ui.submit('/remote');
  await vi.waitFor(() => expect(ui.stdout.writes.join('')).toContain('Override this remote session?'));
  await ui.instance.waitUntilRenderFlush();
  ui.stdin.write('\x1b[B'); await ui.instance.waitUntilRenderFlush();
  await vi.waitFor(() => expect(ui.stdout.writes.join('')).toContain('❯ Override session'));
  ui.stdin.write('\r'); await ui.instance.waitUntilRenderFlush();
  await vi.waitFor(() => expect(ui.stdout.writes.join('')).toContain('Previous host is still stopping'));
  expect(remote.start).toHaveBeenCalledOnce();
  ui.stdin.write('r'); await ui.instance.waitUntilRenderFlush();
  await vi.waitFor(() => expect(remote.start).toHaveBeenCalledTimes(2));
});

it('preserves every wrapped log row and scrolls between earliest activity and the live tail', async () => {
  const logs = Array.from({ length: 100 }, (_, index) => `Activity ${index}`);
  expect(wrapRemoteLogs(['A'.repeat(1000)], 20).join('')).toHaveLength(1000);
  expect(wrapRemoteLogs(['\x1b[31mSafe\x1b[0m\nSecond line'], 20)).toEqual(['Safe', 'Second line']);
  const stdout = new Terminal(); stdout.rows = 15;
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const instance = render(<RemoteManager width={120} height={14} status="Listening" logs={logs} error="" onStart={async () => {}} onStop={async () => {}} onPair={() => {}} onClose={() => {}} />,
    { stdout, stdin, stderr: new PassThrough(), interactive: true, patchConsole: false, maxFps: 1000 });
  instances.push(instance); await instance.waitUntilRenderFlush();
  expect(stdout.writes.join('')).toContain('Activity 99');
  stdout.writes.length = 0; stdin.write('\x1b[H'); await instance.waitUntilRenderFlush();
  await vi.waitFor(() => expect(stdout.writes.join('')).toContain('Activity 0'));
  stdout.writes.length = 0; stdin.write('\x1b[F'); await instance.waitUntilRenderFlush();
  await vi.waitFor(() => expect(stdout.writes.join('')).toContain('Activity 99'));
});

it('hides expired or clipped QR codes and offers renewal or terminal sizing guidance', async () => {
  const stdout = new Terminal(); stdout.rows = 24; stdout.columns = 80;
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const pairing = { v: 1 as const, address: 'https://192.168.1.2:8443', fingerprint: 'a'.repeat(64), token: 'b'.repeat(64), expiresAt: Date.now() + 120000 };
  const props = { width: 80, height: 23, status: 'Listening', logs: [], pairing, error: '', onStart: async () => {}, onStop: async () => {}, onPair: vi.fn(), onClose: vi.fn() };
  const instance = render(<RemoteManager {...props} />, { stdout, stdin, stderr: new PassThrough(), interactive: true, patchConsole: false, maxFps: 1000 });
  instances.push(instance); await instance.waitUntilRenderFlush();
  expect(stdout.writes.join('')).toContain('Resize terminal');
  stdout.writes.length = 0;
  instance.rerender(<RemoteManager {...props} pairing={{ ...pairing, token: 'c'.repeat(64), expiresAt: Date.now() - 1000 }} />);
  await instance.waitUntilRenderFlush();
  await vi.waitFor(() => expect(stdout.writes.join('')).toContain('Pairing code expired'));
  stdin.write('p'); await instance.waitUntilRenderFlush(); expect(props.onPair).toHaveBeenCalledOnce();
});
