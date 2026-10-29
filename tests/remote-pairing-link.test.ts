import { expect, it } from 'vitest';
import { pairingLink } from '../src/remote/pairing-link.js';

it('encodes the local pinned endpoint and one-time credentials into the app link', () => {
  const pairing = { v: 1 as const, address: 'https://192.168.1.2:8443', fingerprint: 'a'.repeat(64), token: 'b'.repeat(64), expiresAt: 123456789 };
  const url = new URL(pairingLink(pairing));
  expect(url.protocol).toBe('pace:');
  expect(url.hostname).toBe('pair');
  expect(Object.fromEntries(url.searchParams)).toEqual(Object.fromEntries(Object.entries(pairing).map(([key, value]) => [key, String(value)])));
});
