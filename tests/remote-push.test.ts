import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { PushRegistry } from '../src/remote/push.js';

const roots: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('sends generic notifications only to registered paired devices and revokes tokens', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pace-push-')); roots.push(root);
  await mkdir(join(root, 'remote'));
  const registry = await PushRegistry.open(root, () => {});
  const deviceId = 'a'.repeat(64);
  const token = 'ExpoPushToken[abcdefghij1234567890]';
  await registry.register(deviceId, token);
  const saved = JSON.parse(await readFile(join(root, 'remote', 'push.json'), 'utf8')) as Record<string, string>;
  expect(saved[deviceId]).toBe(token);
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ status: 'ok' }] }) }); vi.stubGlobal('fetch', fetch);
  const event = { projectPath: root, sessionId: '00000000-0000-4000-8000-000000000000', kind: 'input' as const };
  await registry.send(event, new Set()); expect(fetch).not.toHaveBeenCalled();
  await registry.send(event, new Set([deviceId]));
  expect(fetch).toHaveBeenCalledTimes(1);
  const body = JSON.parse(fetch.mock.calls[0]![1].body as string) as { to: string; title: string; data: { sessionId: string } }[];
  expect(body[0]).toMatchObject({ to: token, title: 'Pace needs your input', data: { sessionId: event.sessionId } });
  expect(JSON.stringify(body)).not.toContain(root);
  await registry.revoke(deviceId);
  await registry.send(event, new Set([deviceId])); expect(fetch).toHaveBeenCalledTimes(1);
});
