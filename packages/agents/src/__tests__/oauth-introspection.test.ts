import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contract, probeOAuth } from '../../../../security/probe-oauth.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('OAuth introspection native HTTP contract', () => {
  it.each([...contract.holdout, ...contract.anchor])('%s', async (name: string) => {
    const [result] = await probeOAuth(root, [name]);
    expect(result?.pass, JSON.stringify(result)).toBe(true);
  });
});
