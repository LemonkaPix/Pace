import type { Pairing } from './protocol.js';

/** App dispatch carries the pinned local HTTPS address, never a relay address. */
export function pairingLink(pairing: Pairing): string {
  const params = new URLSearchParams(Object.entries(pairing).map(([key, value]) => [key, String(value)]));
  return `pace://pair?${params}`;
}
