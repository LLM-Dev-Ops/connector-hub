import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { contract, probeOAuth } from './probe-oauth.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const report = await probeOAuth(root, [...contract.holdout, ...contract.anchor]);
for (const result of report) assert.equal(result.pass, true, JSON.stringify(result));
console.log(`Native HTTP OAuth contract: ${report.length}/${report.length} passed, 0 skipped`);
