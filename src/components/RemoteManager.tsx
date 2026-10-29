import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'string-width';
import qrcode from 'qrcode-terminal';
import type { Pairing } from '../remote/protocol.js';
import { pairingLink } from '../remote/pairing-link.js';
import type { RemoteLockError } from '../remote/security.js';

export function wrapRemoteLogs(logs: string[], width: number): string[] {
  const rows: string[] = [];
  for (const entry of logs) {
    for (const line of stripVTControlCharacters(entry).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').replace(/\t/g, '  ').split('\n')) {
      let row = '', columns = 0;
      for (const char of line) {
        const size = stringWidth(char);
        if (columns + size > width && row) { rows.push(row); row = ''; columns = 0; }
        row += char; columns += size;
      }
      rows.push(row);
    }
  }
  return rows;
}

export function RemoteManager({ width, height, status, logs, pairing, conflict, error, onStart, onStop, onPair, onClose }: {
  width: number; height: number; status: string; logs: string[]; pairing?: Pairing;
  conflict?: RemoteLockError; error: string;
  onStart: (confirmed?: RemoteLockError) => Promise<void>; onStop: () => Promise<void>;
  onPair: () => void; onClose: () => void;
}) {
  const [override, setOverride] = useState(false);
  const [showLogs, setShowLogs] = useState(!pairing);
  const [top, setTop] = useState<number>();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { setOverride(false); }, [conflict]);
  useEffect(() => { setShowLogs(!pairing); setNow(Date.now()); }, [pairing?.token]);
  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pairing?.token]);
  const contentWidth = Math.max(1, width - 2);
  const rows = useMemo(() => wrapRemoteLogs(logs, contentWidth), [logs, contentWidth]);
  const page = Math.max(1, height - 5);
  const lastTop = Math.max(0, rows.length - page);
  const start = Math.min(top ?? lastTop, lastTop);
  const code = useMemo(() => {
    let result = '';
    if (pairing) qrcode.generate(pairingLink(pairing), { small: true }, value => { result = value.trimEnd(); });
    return result;
  }, [pairing?.token]);
  const codeRows = code.split('\n');
  const codeWidth = Math.max(...codeRows.map(row => stringWidth(row)));
  const expired = !!pairing && pairing.expiresAt <= now;
  const busy = status === 'Starting…' || status === 'Stopping…';
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) { onClose(); return; }
    if (conflict) {
      if (key.upArrow || key.downArrow || key.tab) setOverride(value => !value);
      if (key.return) { if (override) void onStart(conflict); else onClose(); }
      return;
    }
    if (busy) return;
    if (input === 's') { void onStop(); return; }
    if (input === 'r') { void onStart(); return; }
    if (input === 'p') { onPair(); return; }
    if (input === 'l') { setShowLogs(value => !value); return; }
    if (key.home) setTop(0);
    if (key.end) setTop(undefined);
    if (key.upArrow || key.pageUp) setTop(Math.max(0, start - (key.pageUp ? page : 1)));
    if (key.downArrow || key.pageDown) {
      const next = start + (key.pageDown ? page : 1); setTop(next >= lastTop ? undefined : next);
    }
  });
  return <Box flexDirection="column" width={width} height={height} paddingX={1} overflowY="hidden">
    <Text bold color="#A5B4FC" wrap="truncate-end">Remote host</Text>
    <Text color="#59E6A7" wrap="truncate-end">{status}</Text>
    {conflict ? <Box flexDirection="column" flexGrow={1} overflowY="hidden">
      <Text color="#FBBF24">Another remote host owns this Pace store (recorded PID {conflict.pid ?? 'unknown'}).</Text>
      <Text>Override this remote session? Paired clients will disconnect from the previous host.</Text>
      <Text>Live hosts hand over gracefully. A stale lock is removed only after checking its PID.</Text>
      <Text color={!override ? '#59E6A7' : undefined}>{!override ? '❯' : ' '} Keep existing session</Text>
      <Text color={override ? '#59E6A7' : undefined}>{override ? '❯' : ' '} Override session</Text>
    </Box> : <Box flexDirection="column" flexGrow={1} minHeight={0} overflowY="hidden">
      {error ? <Text color="red">{error}</Text> : null}
      {pairing && !showLogs ? expired ? <Text color="#FBBF24">Pairing code expired. Press P for a new QR code.</Text>
        : codeWidth <= contentWidth && codeRows.length + 1 <= height - 4 ? <>
          <Text wrap="truncate-end">Scan with your phone camera · opens Pace Remote · expires in {Math.max(1, Math.ceil((pairing.expiresAt - now) / 1000))}s</Text>
          <Text color="white" backgroundColor="black">{code}</Text>
        </> : <Text>Resize terminal to at least {codeWidth + 2} columns × {codeRows.length + 5} rows to show the complete QR code. P renews it.</Text>
        : <>
          <Text dimColor wrap="truncate-end">Logs · {rows.length ? `${start + 1}–${Math.min(rows.length, start + page)} / ${rows.length}` : 'Waiting for activity'} · {top === undefined ? 'following' : 'scroll paused'}</Text>
          {rows.slice(start, start + page).map((row, index) => <Text key={start + index} wrap="truncate-end">{row || ' '}</Text>)}
        </>}
    </Box>}
    <Text dimColor wrap="truncate-end">{conflict ? '↑/↓ choose · Enter confirm · Esc keep existing session' : 'P pair · L QR/logs · ↑/↓ PgUp/PgDn scroll · Home/End · R start · S stop'}</Text>
    <Text dimColor wrap="truncate-end">Esc closes this screen · host and logs continue in background · /remote reopens</Text>
  </Box>;
}
