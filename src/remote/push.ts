import { chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson } from '../core/sessions.js';
import { projectKey } from '../core/session-model.js';

export type PushEvent = { projectPath: string; sessionId: string; kind: 'input' | 'completed' | 'failed' };

/** Tokens are scoped to paired device IDs and never included in remote device listings. */
export class PushRegistry {
  private constructor(private readonly file: string, private readonly tokens: Record<string, string>, private readonly log: (message: string) => void) {}
  static async open(baseDir: string, log: (message: string) => void): Promise<PushRegistry> {
    const file = join(baseDir, 'remote', 'push.json');
    let tokens: Record<string, string> = {};
    try {
      const value: unknown = JSON.parse(await readFile(file, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([id, token]) => !/^[a-f0-9]{64}$/.test(id) || typeof token !== 'string' || !/^(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]{10,200}\]$/.test(token))) throw new Error('Invalid push registry');
      tokens = value as Record<string, string>;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return new PushRegistry(file, tokens, log);
  }
  async register(deviceId: string, token: string) { this.tokens[deviceId] = token; await this.save(); }
  async revoke(deviceId: string) { delete this.tokens[deviceId]; await this.save(); }
  private async save() { await atomicJson(this.file, this.tokens); await chmod(this.file, 0o600); }
  async send(event: PushEvent, pairedIds: Set<string>) {
    const to = Object.entries(this.tokens).filter(([id]) => pairedIds.has(id)).map(([, token]) => token);
    if (!to.length) return;
    const title = event.kind === 'input' ? 'Pace needs your input' : event.kind === 'failed' ? 'Pace task failed' : 'Pace task completed';
    const data = { projectId: projectKey(event.projectPath), sessionId: event.sessionId, kind: event.kind };
    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(to.map(token => ({ to: token, title, body: 'Open the conversation in Pace Remote.', data, channelId: 'pace-updates' }))),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) this.log(`Push service rejected a notification (${response.status}).`);
    } catch { this.log('Push notification delivery failed.'); }
  }
}
