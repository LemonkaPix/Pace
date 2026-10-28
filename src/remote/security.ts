import { randomBytes, createHash, timingSafeEqual, X509Certificate } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import type { TLSSocket } from 'node:tls';
import { atomicJson } from '../core/sessions.js';

export function isPrivateAddress(address: string): boolean {
  const value = address.replace(/^::ffff:/, '');
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || a === 172 && b! >= 16 && b! <= 31 || a === 192 && b === 168;
}
export function lanAddresses(): string[] {
  return Object.values(networkInterfaces()).flatMap(entries => entries ?? [])
    .filter(entry => entry.family === 'IPv4' && !entry.internal && isPrivateAddress(entry.address)).map(entry => entry.address);
}
export const fingerprint = (der: Buffer) => createHash('sha256').update(der).digest('hex');
export type Device = { id: string; name: string; pairedAt: string };

/** TLS verifies possession; enrollment pins the exact presented client certificate. */
export class RemoteIdentity {
  private devices: Device[] = [];
  private code?: { token: string; expiresAt: number };
  private saving = Promise.resolve();
  private constructor(readonly directory: string, readonly key: Buffer, readonly cert: Buffer) {}
  static async open(baseDir: string): Promise<RemoteIdentity> {
    const directory = join(baseDir, 'remote');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const keyPath = join(directory, 'host.key');
    const certPath = join(directory, 'host.crt');
    try { await readFile(keyPath); await readFile(certPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // Generate once under the host ownership lock. Never replace an existing key silently.
      const keyExists = await readFile(keyPath).then(() => true, () => false);
      const certExists = await readFile(certPath).then(() => true, () => false);
      if (keyExists || certExists) throw new Error('Incomplete remote identity; restore the key/certificate or explicitly reset pairing.');
      const temporaryKey = join(directory, 'new-host.key');
      const temporaryCert = join(directory, 'new-host.crt');
      try {
        await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-days', '3650', '-subj', '/CN=Pace Remote', '-keyout', temporaryKey, '-out', temporaryCert], { timeout: 15000 });
        await chmod(temporaryKey, 0o600);
        await rename(temporaryKey, keyPath); await rename(temporaryCert, certPath);
      } finally { await rm(temporaryKey, { force: true }); await rm(temporaryCert, { force: true }); }
    }
    await chmod(keyPath, 0o600);
    const identity = new RemoteIdentity(directory, await readFile(keyPath), await readFile(certPath));
    // A corrupt allowlist fails closed; it is never interpreted as an empty fresh store.
    try {
      const parsed: unknown = JSON.parse(await readFile(join(directory, 'devices.json'), 'utf8'));
      if (!Array.isArray(parsed) || parsed.some(device => !device || typeof device !== 'object' || !/^[a-f0-9]{64}$/.test(device.id) || typeof device.name !== 'string' || typeof device.pairedAt !== 'string')) throw new Error('Invalid remote device registry');
      identity.devices = parsed;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return identity;
  }
  get hostFingerprint(): string { return fingerprint(new X509Certificate(this.cert).raw); }
  newCode(now = Date.now()): { token: string; expiresAt: number } {
    return this.code = { token: randomBytes(32).toString('hex'), expiresAt: now + 120000 };
  }
  invalidateCode(): void { this.code = undefined; }
  list(): Device[] { return structuredClone(this.devices); }
  peer(socket: TLSSocket): string | undefined {
    if (socket.getProtocol() !== 'TLSv1.3') return;
    const cert = socket.getPeerCertificate();
    if (!cert.raw) return;
    const parsed = new X509Certificate(cert.raw);
    const now = Date.now();
    if (Date.parse(parsed.validFrom) > now || Date.parse(parsed.validTo) <= now) return;
    return fingerprint(cert.raw);
  }
  authorized(socket: TLSSocket): string | undefined {
    const id = this.peer(socket);
    return id && this.devices.some(device => device.id === id) ? id : undefined;
  }
  async enroll(socket: TLSSocket, token: string, name: string, now = Date.now()): Promise<Device> {
    const id = this.peer(socket);
    if (!id || !this.code || this.code.expiresAt <= now || !/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(this.code.token))) throw new Error('Pairing denied');
    this.code = undefined; // Consume before the first await, including concurrent pairing attempts.
    const device = { id, name: name.trim().slice(0, 80) || 'Android', pairedAt: new Date(now).toISOString() };
    await this.mutate(() => { this.devices = [...this.devices.filter(item => item.id !== id), device]; });
    return device;
  }
  async revoke(id: string): Promise<void> { await this.mutate(() => { this.devices = this.devices.filter(device => device.id !== id); }); }
  private async mutate(change: () => void): Promise<void> {
    const pending = this.saving.then(async () => {
      const before = this.devices; change();
      try { await atomicJson(join(this.directory, 'devices.json'), this.devices); await chmod(join(this.directory, 'devices.json'), 0o600); }
      catch (error) { this.devices = before; throw error; }
    });
    this.saving = pending.catch(() => {});
    await pending;
  }
}

export class RemoteLockError extends Error {
  constructor(readonly owner: string) {
    super('Remote host already owns this Pace store. Choose whether to override the remote session.');
  }
  get pid(): number | undefined {
    try {
      const value = JSON.parse(this.owner);
      const pid = typeof value === 'number' ? value : value.pid;
      return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
    } catch { return undefined; }
  }
}

/** Only the confirmed owner can be replaced; never signal an unrelated Pace process. */
export async function overrideRemoteLock(baseDir: string, conflict: RemoteLockError): Promise<void> {
  const path = join(baseDir, 'remote', 'host.lock');
  const guard = `${path}.takeover`;
  await writeFile(guard, '', { flag: 'wx', mode: 0o600 });
  try {
    const owner = await readFile(path, 'utf8').catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (owner === undefined) return;
    if (owner !== conflict.owner) throw new Error('Remote host owner changed. Reopen /remote to confirm the new owner.');
    if (!conflict.pid) throw new Error('Cannot verify the recorded PID. Inspect remote/host.lock before removing it manually.');
    let alive = true;
    try { process.kill(conflict.pid, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; else throw error; }
    if (!alive) { await rm(path); return; }
    const record = JSON.parse(owner);
    if (typeof record.stop !== 'string' || !/^[a-f0-9]{32}$/.test(record.stop))
      throw new Error(`PID ${conflict.pid} is running an older host without graceful takeover. Stop its remote host there, then retry here.`);
    const request = `${path}.stop-${record.stop}`;
    await writeFile(request, '', { mode: 0o600 });
    try {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const current = await readFile(path, 'utf8').catch(error => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
          throw error;
        });
        if (current === undefined) return;
        if (current !== owner) throw new Error('Remote host owner changed. Reopen /remote to confirm the new owner.');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Previous host is still stopping. Retry after its active work finishes.');
    } finally { await rm(request, { force: true }); }
  } finally { await rm(guard, { force: true }); }
}

export async function remoteLock(baseDir: string, onOverride?: () => Promise<void>): Promise<() => Promise<void>> {
  await mkdir(join(baseDir, 'remote'), { recursive: true, mode: 0o700 });
  const path = join(baseDir, 'remote', 'host.lock');
  const stop = randomBytes(16).toString('hex');
  const owner = JSON.stringify({ pid: process.pid, id: stop, ...(onOverride ? { stop } : {}) });
  try { await writeFile(path, owner, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new RemoteLockError(await readFile(path, 'utf8'));
    throw error;
  }
  const request = `${path}.stop-${stop}`;
  let checking = false;
  const timer = onOverride ? setInterval(() => {
    if (checking) return;
    checking = true;
    void readFile(request).then(() => onOverride()).catch(() => {}).finally(() => { checking = false; });
  }, 100) : undefined;
  timer?.unref();
  return async () => {
    if (timer) clearInterval(timer);
    // A late close must never remove a successor's lock.
    if (await readFile(path, 'utf8').catch(() => undefined) === owner) await rm(path, { force: true });
    await rm(request, { force: true });
  };
}
