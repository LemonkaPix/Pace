import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:https';
import { WebSocket } from 'ws';
import { afterEach, expect, it, vi } from 'vitest';
import { overrideRemoteLock, remoteLock, RemoteLockError } from '../src/remote/security.js';
import { startRemoteHost, type RemoteHost, type RemoteLog } from '../src/remote/server.js';
import { RemoteDomain } from '../src/remote/domain.js';
import { newSession, PaceStore } from '../src/core/sessions.js';
import type { Orchestrator } from '../src/core/orchestrator.js';
import { DEFAULT_CONFIG } from '../src/shared/config.js';

// Transport tests use loopback while production remains LAN-only.
vi.mock('../src/remote/security.js', async original => {
  const module = await original<typeof import('../src/remote/security.js')>();
  return { ...module, isPrivateAddress: (address: string) => address === '127.0.0.1' || module.isPrivateAddress(address) };
});
const roots: string[] = [];
const hosts: RemoteHost[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(hosts.splice(0).map(host => host.close()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function directory() { const root = await mkdtemp(join(tmpdir(), 'pace-host-test-')); roots.push(root); return root; }
async function conflict(root: string) {
  try { await remoteLock(root); throw new Error('Expected ownership conflict'); }
  catch (error) { expect(error).toBeInstanceOf(RemoteLockError); return error as RemoteLockError; }
}

it('does not replace a lock without confirmation, then cooperatively stops only the remote owner', async () => {
  const root = await directory();
  let release!: () => Promise<void>;
  const stop = vi.fn(async () => release());
  release = await remoteLock(root, stop);
  const locked = await conflict(root);
  expect(locked.pid).toBe(process.pid);
  expect(stop).not.toHaveBeenCalled();
  await overrideRemoteLock(root, locked);
  expect(stop).toHaveBeenCalledOnce();
  const successor = await remoteLock(root);
  await release();
  await expect(conflict(root)).resolves.toBeInstanceOf(RemoteLockError);
  await successor();
});

it('checks stale PIDs, rejects changed owners and never kills a live legacy process', async () => {
  const root = await directory(); await mkdir(join(root, 'remote'));
  const path = join(root, 'remote', 'host.lock');
  await writeFile(path, '987654');
  const locked = await conflict(root);
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('missing'), { code: 'ESRCH' }); });
  await overrideRemoteLock(root, locked);
  expect(kill).toHaveBeenCalledWith(987654, 0);
  const release = await remoteLock(root);
  await expect(overrideRemoteLock(root, locked)).rejects.toThrow('owner changed');
  await release();
  await writeFile(path, String(process.pid));
  kill.mockRestore();
  await expect(overrideRemoteLock(root, await conflict(root))).rejects.toThrow('older host');
  expect(await readFile(path, 'utf8')).toBe(String(process.pid));
});

it('refuses unverifiable and inaccessible recorded owners', async () => {
  const root = await directory(); await mkdir(join(root, 'remote'));
  const path = join(root, 'remote', 'host.lock');
  await writeFile(path, 'corrupt');
  await expect(overrideRemoteLock(root, await conflict(root))).rejects.toThrow('Cannot verify');
  await writeFile(path, '987654');
  vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('permission denied'), { code: 'EPERM' }); });
  await expect(overrideRemoteLock(root, await conflict(root))).rejects.toThrow('permission denied');
  expect(await readFile(path, 'utf8')).toBe('987654');
});

it('records full turn progress and results independently of the screen', async () => {
  const root = await directory();
  const logs: string[] = [];
  const detail = 'Full tool output\n'.repeat(200);
  const orchestrator = { turn: vi.fn(async (_prompt, session, _config, progress) => {
    progress({ kind: 'activity', id: 'tool', category: 'command', title: 'Read files', detail, completed: true });
    progress({ kind: 'message', text: 'Assistant progress' });
    return { session, result: 'Final answer' };
  }) } as unknown as Orchestrator;
  const previous = orchestrator.turn;
  const domain = new RemoteDomain(new PaceStore(root), orchestrator, [root], undefined, message => logs.push(message));
  await orchestrator.turn('Remote prompt', newSession(root, 'auto'), DEFAULT_CONFIG, () => {});
  expect(logs.join('\n')).toContain(JSON.stringify(detail));
  expect(logs.join('\n')).toContain('Assistant progress');
  expect(logs.join('\n')).toContain('Turn result: Final answer');
  expect(logs.join('\n')).toContain('Turn finished');
  await domain.close(); expect(orchestrator.turn).not.toBe(previous); // Restored bound original.
});

it('pairs over TLS, logs connection/request/error/disconnect events, renews codes and hands over ownership', async () => {
  const root = await directory();
  const events: RemoteLog[] = [];
  const domain = { subscribe: () => () => {}, resumeQueues: async () => {}, close: vi.fn(async () => {}), handle: vi.fn(async () => []) } as unknown as RemoteDomain;
  const onClose = vi.fn();
  const host = await startRemoteHost({ baseDir: root, address: '127.0.0.1', port: 0, allowTestAddress: true, advertise: false, domain, onLog: event => events.push(event), onClose });
  hosts.push(host);
  const oldToken = host.pairing.token;
  expect(host.newPairing().token).not.toBe(oldToken);
  const keyPath = join(root, 'client.key'), certPath = join(root, 'client.crt');
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-days', '1', '-subj', '/CN=Test phone', '-keyout', keyPath, '-out', certPath]);
  const credentials = { key: await readFile(keyPath), cert: await readFile(certPath), rejectUnauthorized: false, minVersion: 'TLSv1.3' as const, maxVersion: 'TLSv1.3' as const };
  const pair = (token: string) => new Promise<number>((resolve, reject) => {
    const req = request(`${host.address}/pair`, { ...credentials, method: 'POST', agent: false }, response => { response.resume(); resolve(response.statusCode!); });
    req.on('error', reject); req.end(JSON.stringify({ v: 1, token, name: 'Test phone' }));
  });
  expect(await pair(oldToken)).toBe(401);
  expect(await pair(host.pairing.token)).toBe(200);
  expect(await pair(host.pairing.token)).toBe(401);
  const ws = new WebSocket(host.address.replace('https:', 'wss:') + '/remote', 'pace-remote-v1', credentials);
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const response = new Promise<string>(resolve => ws.once('message', value => resolve(value.toString())));
  ws.send(JSON.stringify({ v: 1, id: randomUUID(), method: 'projects.list', params: {} }));
  expect(JSON.parse(await response).ok).toBe(true);
  const invalid = new Promise<string>(resolve => ws.once('message', value => resolve(value.toString())));
  ws.send('{invalid'); expect(JSON.parse(await invalid).ok).toBe(false);
  ws.close(); await new Promise<void>(resolve => ws.once('close', () => resolve()));
  await vi.waitFor(() => expect(events.map(event => event.kind)).toEqual(expect.arrayContaining(['host', 'paired', 'connected', 'request', 'response', 'error', 'disconnected'])));
  expect(JSON.stringify(events)).not.toContain(host.pairing.token);
  await overrideRemoteLock(root, await conflict(root));
  expect(onClose).toHaveBeenCalledOnce(); expect(domain.close).toHaveBeenCalledOnce();
  const release = await remoteLock(root); await release();
});
