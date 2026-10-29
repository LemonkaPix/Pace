import { useEffect, useRef, useState, type RefObject } from 'react';
import { RemoteDomain } from '../../remote/domain.js';
import { startRemoteHost, type RemoteLog } from '../../remote/server.js';
import { lanAddresses, overrideRemoteLock, RemoteLockError } from '../../remote/security.js';
import type { Pairing } from '../../remote/protocol.js';
import type { PromptQueue } from '../../core/prompt-queue.js';
import type { Session } from '../../shared/types.js';
import type { Line } from '../Transcript.js';
import type { AppState } from './useAppState.js';
import { store, project, orchestrator } from './runtime.js';

export function useRemoteHost({ state, promptQueue, rememberSession, add }: {
  state: AppState;
  promptQueue: RefObject<PromptQueue>;
  rememberSession: (session: Session) => void;
  add: (role: Line['role'], text: string) => void;
}) {
  const [remoteLogs, setRemoteLogs] = useState<string[]>([]);
  const [remoteStatus, setRemoteStatus] = useState('Stopped');
  const [remoteError, setRemoteError] = useState('');
  const [remoteConflict, setRemoteConflict] = useState<RemoteLockError>();
  const [remotePairing, setRemotePairing] = useState<Pairing>();
  const pending = useRef(false);
  const startup = useRef<Promise<void> | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const log = (event: RemoteLog) => {
    if (!mounted.current) return;
    setRemoteLogs(lines => [...lines, `${new Date().toISOString()} [${event.kind}] ${event.message}`]);
    if (event.kind === 'paired' || event.kind === 'connected') setRemotePairing(undefined);
  };
  const startRemote = (confirmed?: RemoteLockError): Promise<void> => {
    if (pending.current || state.remoteHost.current) return startup.current ?? Promise.resolve();
    pending.current = true;
    return startup.current = (async () => {
      setRemoteError(''); setRemoteConflict(undefined); setRemoteStatus('Starting…');
      let domain: RemoteDomain | undefined;
      try {
        if (confirmed) {
          log({ kind: 'host', message: `Override confirmed for recorded PID ${confirmed.pid ?? 'unknown'}.` });
          await overrideRemoteLock(store.baseDir, confirmed);
        }
        const addresses = lanAddresses();
        if (!addresses.length) throw new Error('No private IPv4 LAN interface found.');
        const sessions = await store.listProjects({ summariesOnly: true });
        if (!mounted.current) return;
        const roots = [...new Set([project, ...sessions.filter(item => item.exists).map(item => item.projectPath)])];
        domain = new RemoteDomain(store, orchestrator, roots, {
          session: id => state.jobs.current.get(id)?.session ?? state.sessionRecords.current.get(id) ?? (state.sessionRef.current?.id === id ? state.sessionRef.current : undefined),
          busy: id => state.jobs.current.has(id) || state.historyBusy.current,
          queue: async (target, prompt) => {
            if (promptQueue.current.list(target.id).length >= 20) return false;
            promptQueue.current.add(target.id, prompt); state.setQueueVersion(value => value + 1);
            await state.queueSaves.current.get(target.id); return true;
          },
          cancel: id => { const job = state.jobs.current.get(id); if (!job) return false; job.controller.abort(); return true; },
          submit: async (prompt, target, intent, item) => {
            const config = state.latestConfig.current;
            if (!config || !await state.runTurnRef.current?.(prompt, target, config, intent, undefined, false, item))
              throw new Error('UI operation did not finish; queue remains paused.');
          },
          changed: target => { rememberSession(target); if (state.activeSessionId.current === target.id) state.setSession({ ...target }); },
        }, message => log({ kind: 'event', message }));
        const host = await startRemoteHost({ baseDir: store.baseDir, address: addresses[0]!, domain, onLog: log,
          onClose: () => {
            state.remoteHost.current = undefined;
            if (mounted.current) { setRemoteStatus('Stopped'); setRemotePairing(undefined); }
          },
        });
        if (!mounted.current) { await host.close(); return; }
        state.remoteHost.current = host;
        setRemotePairing(host.pairing); setRemoteStatus(`Listening on ${host.address}`);
      } catch (error) {
        try { await domain?.close(); }
        catch (cleanupError) { log({ kind: 'error', message: `Remote cleanup failed: ${String(cleanupError)}` }); }
        if (!mounted.current) return;
        setRemoteStatus('Stopped');
        if (error instanceof RemoteLockError) setRemoteConflict(error);
        else setRemoteError(String(error));
        log({ kind: 'error', message: `Could not start remote host: ${String(error)}` });
      } finally { pending.current = false; }
    })();
  };
  const stopRemote = async () => {
    await startup.current;
    if (pending.current) return;
    pending.current = true; setRemoteError(''); setRemoteStatus('Stopping…');
    try {
      await state.remoteHost.current?.close(); state.remoteHost.current = undefined;
      setRemoteStatus('Stopped'); setRemotePairing(undefined);
    } catch (error) {
      setRemoteError(String(error)); setRemoteStatus('Stop failed');
      log({ kind: 'error', message: `Could not stop remote host: ${String(error)}` });
    }
    finally { pending.current = false; }
  };
  const handleRemote = async (text: string) => {
    state.setDraft('');
    if (!/^\/remote(?:\s+stop)?$/.test(text.trim())) { add('error', 'Use /remote or /remote stop.'); return; }
    if (text.trim() === '/remote stop') {
      await stopRemote();
      add(state.remoteHost.current ? 'error' : 'info', state.remoteHost.current ? 'Could not stop remote host; see /remote.' : 'Remote host stopped.'); return;
    }
    state.setRemoteOpen(true);
    if (!state.remoteHost.current) void startRemote();
  };
  const renewRemotePairing = () => {
    const host = state.remoteHost.current;
    if (host && !pending.current) setRemotePairing(host.newPairing());
  };
  return { remoteLogs, remoteStatus, remoteError, remoteConflict, remotePairing,
    handleRemote, startRemote, stopRemote, renewRemotePairing };
}
