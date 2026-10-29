import { useTheme } from "../shared/colors.js";
import { PanelFrame } from "./PanelFrame.js";
import { terminalLayout } from "./layout.js";
import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { BASIC_MEMORY_VERSION, memoryRoot, type MemoryState } from '../core/memory/config.js';
import { memorySetupService, type MemorySetupService } from '../core/memory/setup.js';
import { GLOBAL_MEMORY_BYTES, type GlobalMemory } from '../core/memory/global.js';

type Screen = 'loading' | 'intro' | 'installation' | 'location' | 'path' | 'review' | 'panel' | 'global' | 'preferences';
export function MemoryManager({ project, baseDir, width, height, onClose, service = memorySetupService }: {
  project: string; baseDir: string; width: number; height: number; onClose: () => void; service?: MemorySetupService;
}) {
  const theme = useTheme();
  const [state, setState] = useState<MemoryState>({ state: 'unconfigured' });
  const [screen, setScreen] = useState<Screen>('loading'), [index, setIndex] = useState(0);
  const [detected, setDetected] = useState<Awaited<ReturnType<MemorySetupService['detect']>>>({});
  const [directory, setDirectory] = useState(''), [existing, setExisting] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [output, setOutput] = useState('');
  const [message, setMessage] = useState('');
  const [global, setGlobal] = useState<GlobalMemory>();
  const [globalError, setGlobalError] = useState('');
  const returnScreen = useRef<Screen>('intro');
  const mounted = useRef(false), operation = useRef<AbortController | undefined>(undefined);
  const go = (next: Screen) => { setScreen(next); setIndex(0); setError(''); };
  const perform = async (label: string, action: (signal: AbortSignal) => Promise<void>) => {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller; setBusy(label); setError('');
    try { await action(controller.signal); }
    catch (failure) { if (mounted.current) setError(String(failure)); }
    finally { if (operation.current === controller) operation.current = undefined; if (mounted.current) setBusy(''); }
  };
  const log = (text: string) => { if (mounted.current) setOutput(value => (value + text).slice(-3000)); };
  const detect = async (signal: AbortSignal) => {
    const result = await service.detect(baseDir, signal);
    if (!mounted.current) return;
    setDetected(result); go(result.executable ? 'location' : 'installation');
  };
  useEffect(() => {
    mounted.current = true;
    void perform('Checking project memory…', async signal => {
      const [loaded, preferences] = await Promise.all([service.load(project, baseDir), service.loadGlobal(baseDir)]);
      if (!mounted.current) return;
      setGlobal(preferences.config); setGlobalError(preferences.error ?? '');
      setState(loaded);
      if (loaded.config && loaded.state === 'ready') {
        try { await service.check(loaded.config, signal); }
        catch (failure) { if (!signal.aborted) setState({ ...loaded, state: 'unavailable', error: String(failure) }); }
      }
      if (mounted.current) go(loaded.state === 'unconfigured' || loaded.state === 'configuring' ? 'intro' : 'panel');
    });
    return () => { mounted.current = false; operation.current?.abort(); };
  }, [project, baseDir, service]);
  const choices = screen === 'intro' ? ['Set up project memory', 'Global preferences', 'Cancel']
    : screen === 'installation' ? ['Use isolated Basic Memory installation (uv)', 'Check installation again', 'Cancel']
    : screen === 'location' ? ['Create a new memory directory', 'Use an existing notes directory', 'Cancel']
    : screen === 'review' ? ['Configure and check connection', 'Back', 'Cancel']
    : screen === 'panel' ? [state.config?.enabled ? 'Disable memory' : 'Enable memory', 'Repair / check existing connection', 'Reconfigure memory', 'Global preferences', 'Close']
    : screen === 'global' ? [global?.enabled ? 'Disable global memory' : 'Enable global memory', 'Edit global preferences', 'Back'] : [];
  const saveGlobal = (content: string, enabled: boolean) => perform('Saving global preferences…', async () => {
    const config = await service.saveGlobal({ content, enabled }, baseDir, global?.revision ?? null);
    if (mounted.current) { setGlobal(config); setGlobalError(''); go('global'); setMessage('Saved for the next agent launch across all repos. Existing project notes are preserved.'); }
  });
  useInput((input, key) => {
    if (key.escape || key.ctrl && input === 'c') {
      if (operation.current) { operation.current.abort(); setMessage('Cancelled. Existing notes/configuration and any installed runtime are preserved. An incomplete setup may leave files under ~/.pace/memory.'); }
      else if (screen === 'preferences') go('global');
      else if (screen === 'global') go(returnScreen.current);
      else onClose();
      return;
    }
    if (busy || !choices.length) return;
    if (key.upArrow || key.downArrow || key.tab) { setIndex(value => (value + (key.upArrow || key.shift ? -1 : 1) + choices.length) % choices.length); return; }
    if (!key.return) return;
    if (screen === 'intro') {
      if (index === 2) onClose();
      else if (index === 1) { returnScreen.current = 'intro'; go('global'); }
      else void perform('Detecting Basic Memory and runtime…', detect);
    }
    else if (screen === 'installation') {
      if (index === 2) onClose();
      else if (index === 1) void perform('Detecting installation…', detect);
      else if (!detected.uv) setError('uv is not installed. Install uv using its official instructions, then select Check installation again. No sudo is needed.');
      else go('location');
    } else if (screen === 'location') {
      if (index === 2) onClose();
      else { setExisting(index === 1); setDirectory(index ? '' : join(memoryRoot(baseDir), 'notes', randomUUID())); go('path'); }
    } else if (screen === 'review') {
      if (index === 2) onClose(); else if (index === 1) go('location');
      else void perform('Configuring and checking project…', async signal => {
        const executable = detected.executable ?? await service.install(detected.uv!, baseDir, signal, log);
        if (!detected.executable && mounted.current) setMessage(`Installed runtime remains at ${executable} if setup is cancelled.`);
        const config = await service.setup(project, directory, executable, baseDir, signal, log);
        if (mounted.current) { setState({ state: 'ready', config }); setMessage('Saved. Changes apply to the next agent launch; active agents keep their starting scope.'); go('panel'); }
      });
    } else if (screen === 'global') {
      if (index === 2) go(returnScreen.current);
      else if (globalError) setError(globalError);
      else if (index === 1) go('preferences');
      else void saveGlobal(global?.content ?? '', !global?.enabled);
    } else if (screen === 'panel') {
      if (index === 4) onClose();
      else if (index === 3) { returnScreen.current = 'panel'; go('global'); }
      else if (index === 2) go('intro');
      else if (!state.config) setError('Configuration is invalid. Reconfigure explicitly; existing notes will be preserved.');
      else if (index === 0) void perform('Saving setting…', async () => {
        const config = await service.toggle(state.config!, !state.config!.enabled, baseDir);
        if (mounted.current) { setState({ state: config.enabled ? 'ready' : 'disabled', config }); setMessage('Saved for the next agent launch. Notes are preserved.'); }
      });
      else void perform('Checking existing project…', async signal => {
        const config = await service.repair(state.config!, baseDir, signal);
        if (mounted.current) { setState({ state: config.enabled ? 'ready' : 'disabled', config }); setMessage('Existing project connection verified.'); }
      });
    }
  });
  const listRows = terminalLayout(width, height).listRows;
  const listStart = Math.max(0, index - listRows + 1);
  return <PanelFrame width={width} height={height} actions={<>
      {busy ? <Text color={theme.warning}>{busy} · Esc cancels</Text> : choices.slice(listStart, listStart + listRows).map((choice, offset) => <Text key={choice} color={listStart + offset === index ? theme.secondary : undefined}>{listStart + offset === index ? '❯' : ' '} {choice}</Text>)}
    {error ? <Text color={theme.error}>{error}</Text> : null}{message ? <Text>{message}</Text> : null}
    </>} footer={<>↑/↓ select · Enter choose · Esc {busy ? 'cancel operation' : 'close'}</>}>
    <Text bold color={theme.accent}>{screen === 'global' || screen === 'preferences' ? 'Global memory · user preferences' : `Project memory · ${screen === 'panel' ? state.state : 'setup'}`}</Text>
    {screen === 'global' || screen === 'preferences' ? <><Text>Shared across repos · {global?.enabled ? 'enabled' : 'disabled'} · no backend installation required.</Text><Text>Only you edit this short preference card. Agents cannot promote repo findings into global memory. Permissions remain controlled by Pace.</Text><Text>Preferences ({GLOBAL_MEMORY_BYTES} UTF-8 bytes maximum): {global?.content || '(empty)'}</Text>{globalError ? <Text color={theme.error}>{globalError}</Text> : null}</> : null}
    {screen === 'preferences' ? <><Text>Enter saves; Esc preserves the previous card. Empty text clears preferences.</Text><TextInput defaultValue={global?.content ?? ''} onSubmit={content => { void saveGlobal(content.trim(), global?.enabled ?? true); }} /></> : null}
    {screen === 'intro' ? <><Text>Optional local Basic Memory for this project. Pace controls project scope, agent roles and provenance.</Text><Text>Notes remain yours. Cancel and disable preserve them. Current code and user instructions take precedence over historical memory.</Text>{state.state === 'configuring' ? <Text color={theme.warning}>Previous setup is incomplete; it is not an empty ready database.</Text> : null}</> : null}
    {screen === 'installation' ? <><Text>Basic Memory {BASIC_MEMORY_VERSION} requires Python ≥3.12 and is licensed AGPL-3.0-or-later.</Text><Text>Installation uses uv in {memoryRoot(baseDir)}/runtime. It may download Python, packages and a local embedding model. Ordinary npm install never does this.</Text><Text>uv: {detected.uv ?? 'missing'} · Python: {detected.python ?? 'not detected'}</Text></> : null}
    {screen === 'path' ? <><Text>{existing ? 'Existing notes directory (must exist)' : 'New notes directory'} · Enter empty for {directory || 'no default'}</Text><TextInput key={String(existing)} onSubmit={value => {
      const chosen = value.trim() ? resolve(value.trim()) : directory;
      if (!chosen) { setError('Enter a directory path'); return; }
      void perform('Checking directory…', async () => {
        if (existing && !await stat(chosen).then(info => info.isDirectory()).catch(() => false)) throw new Error('The existing notes directory must exist');
        if (mounted.current) { setDirectory(chosen); go('review'); }
      });
    }} /></> : null}
    {screen === 'review' ? <><Text>Project: {project}</Text><Text>Notes: {directory}</Text><Text>Backend: {detected.executable ?? `Install Basic Memory ${BASIC_MEMORY_VERSION} with uv under ${memoryRoot(baseDir)}/runtime`}</Text><Text>Pace will create a separate backend configuration and index this directory. A uniquely named temporary write/read probe is deleted after checking. Previous ready settings remain until success.</Text></> : null}
    {screen === 'panel' ? <><Text>Backend: Basic Memory {BASIC_MEMORY_VERSION}</Text><Text>Project: {state.config?.backendProject ?? 'configuration unavailable'}</Text><Text>Location: {state.config?.dataDirectory ?? 'unknown'}</Text><Text>{state.error ?? 'Zero notes is a valid ready database. Enable/disable preserves all notes.'}</Text></> : null}
    {output ? <Text dimColor>{output.split('\n').slice(-Math.max(1, Math.min(4, height - 14))).join('\n')}</Text> : null}
  </PanelFrame>;
}
