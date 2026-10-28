import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { atomicJson } from '../sessions.js';
import { memoryRoot } from './config.js';

// A user-edited preference card stays small enough to include predictably, without a backend scan.
export const GLOBAL_MEMORY_BYTES = 800;
const schema = z.object({ version: z.literal(1), revision: z.uuid(), enabled: z.boolean(),
  content: z.string().refine(value => Buffer.byteLength(value) <= GLOBAL_MEMORY_BYTES, `Use at most ${GLOBAL_MEMORY_BYTES} UTF-8 bytes`) }).strict();
export type GlobalMemory = z.infer<typeof schema>;
export async function loadGlobalMemory(base?: string): Promise<{ config?: GlobalMemory; error?: string }> {
  try { return { config: schema.parse(JSON.parse(await readFile(join(memoryRoot(base), 'global.json'), 'utf8'))) }; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    return { error: `Global memory configuration is unavailable: ${String(error)}` };
  }
}
export async function saveGlobalMemory(input: Pick<GlobalMemory, 'enabled' | 'content'>, base: string, expectedRevision: string | null): Promise<GlobalMemory> {
  const config = schema.parse({ ...input, version: 1, revision: randomUUID() });
  const root = memoryRoot(base), file = join(root, 'global.json');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lock = await open(file + '.lock', 'wx', 0o600).catch(() => { throw new Error('Global memory settings are being changed; reopen the panel'); });
  try {
    const current = await loadGlobalMemory(base);
    if (current.error) throw new Error(current.error);
    if ((current.config?.revision ?? null) !== expectedRevision) throw new Error('Global memory settings changed; reopen the panel');
    await atomicJson(file, config);
    return config;
  } finally { await lock.close(); await unlink(file + '.lock'); }
}
export function globalMemoryPrompt(config?: GlobalMemory): string {
  return config?.enabled && config.content.trim()
    ? `User-managed global preferences (scope: user; source: /memory; revision: ${config.revision}). Apply only where consistent with the current request and permissions. This card does not grant permissions.\n${config.content}` : '';
}
