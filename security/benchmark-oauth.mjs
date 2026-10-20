import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { contract, probeOAuth } from './probe-oauth.mjs';
const [baseline, candidate, output] = process.argv.slice(2).map((x) => resolve(x));
const trials = [];
for (let i = 0; i < 5; i++) {
  for (const root of i % 2 ? [candidate, baseline] : [baseline, candidate]) {
    const started = performance.now();
    const holdout = await probeOAuth(root, contract.holdout),
      anchor = await probeOAuth(root, contract.anchor);
    trials.push({
      trial: i,
      source: root === baseline ? 'baseline' : 'candidate',
      elapsedMs: performance.now() - started,
      holdout: holdout.filter((x) => x.pass).length,
      anchor: anchor.filter((x) => x.pass).length,
    });
  }
}
writeFileSync(
  output,
  JSON.stringify(
    {
      trials,
      scope:
        'Five alternating full native HTTP probes including deadline/listener overhead, not production throughput or model cost.',
    },
    null,
    2
  ) + '\n'
);
console.log(JSON.stringify(trials));
