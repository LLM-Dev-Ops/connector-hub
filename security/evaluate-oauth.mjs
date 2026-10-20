import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { contract, probeOAuth, sourcePath } from './probe-oauth.mjs';

const [baseline, candidate, tools, output] = process.argv.slice(2).map((x) => resolve(x));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const source = (root) => readFileSync(join(root, sourcePath), 'utf8');
const parentBytes = source(baseline),
  parentHash = hash(parentBytes),
  candidateHash = hash(source(candidate));
assert.notEqual(parentHash, candidateHash);
const fw = await import(
  pathToFileURL(join(tools, 'node_modules/@metaharness/flywheel/dist/index.js')).href
);
assert.equal(
  JSON.parse(readFileSync(join(tools, 'node_modules/@metaharness/flywheel/package.json'), 'utf8'))
    .version,
  '0.1.12'
);
const fingerprint = fw.gateFingerprint(fw.meetsPromotionRule);
const measurements = [];
let originalNames;
function regression(root) {
  const run = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules/vitest/vitest.mjs'),
      'run',
      'packages/agents/src/__tests__/auth-agent.test.ts',
      '--maxWorkers',
      '1',
      '--minWorkers',
      '1',
      '--reporter=json',
    ],
    { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 8e6, env: { PATH: process.env.PATH } }
  );
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const json = JSON.parse(run.stdout.slice(run.stdout.indexOf('{')));
  const names = json.testResults
    .flatMap((suite) =>
      suite.assertionResults.map((test) => {
        assert.equal(test.status, 'passed');
        return test.fullName;
      })
    )
    .sort();
  assert.ok(names.length > 0);
  if (root === baseline) originalNames = names;
  else assert.deepEqual(names.filter(name => originalNames.includes(name)), originalNames);
  return { count: originalNames.length, totalCount: names.length, originalNames, names, exit: run.status };
}
const result = await fw.runFlywheelGenerations({
  rootPolicy: { validation: parentHash },
  proposer: async () => ({
    value: candidateHash,
    summary:
      'Validate introspection JSON and enforce configured authority, audience, scopes and validity dates',
    inverse: { path: sourcePath, parentBytes, hash: parentHash },
  }),
  evaluator: async (policy, suite) => {
    const root = policy.validation === parentHash ? baseline : candidate;
    assert.equal(hash(source(root)), policy.validation);
    const report = await probeOAuth(
      root,
      suite.id === 'holdout' ? contract.holdout : contract.anchor
    );
    const retained = suite.id === 'anchor' ? regression(root) : undefined;
    const wins = report.map((x) => x.pass);
    if (retained) wins.push(true);
    // Throws/empty outcomes are no-ops; wrong returned decisions are failures.
    // No model/API spend is measured: costPerWin=0 is neutral, not a savings claim.
    const score = {
      primary: wins.filter(Boolean).length / wins.length,
      noopRate: report.filter((x) => !x.returned).length / report.length,
      costPerWin: 0,
      regressed: suite.id === 'anchor' && wins.some((x) => !x),
      itemWins: wins,
    };
    measurements.push({ source: policy.validation, suite: suite.id, report, retained, score });
    assert.equal(hash(source(root)), policy.validation);
    return score;
  },
  holdout: { id: 'holdout', items: contract.holdout },
  anchor: { id: 'anchor', items: [...contract.anchor, 'original AuthAgent tests retained'] },
  maxGenerations: 1,
  promotionRule: fw.meetsPromotionRule,
  signer: fw.makeSigner(),
  dataSource: 'LIVE_NATIVE_HTTP_INTROSPECTION_AND_REAL_AUTH_VALIDATOR',
});
const replay = fw.verifyReplayBundle(result.replayBundle, { pinnedGateFingerprint: fingerprint });
assert.equal(replay.pass, true);
assert.equal(result.promotions.length, 1);
writeFileSync(
  output,
  JSON.stringify(
    {
      contract,
      contractSha256: hash(readFileSync(new URL('./oauth-contract.json', import.meta.url))),
      probeSha256: hash(readFileSync(new URL('./probe-oauth.mjs', import.meta.url))),
      parentHash,
      candidateHash,
      measurements,
      fingerprint,
      replay,
      replayBundle: result.replayBundle,
      rollbackSource: parentBytes,
      rollbackSha256: parentHash,
      scope:
        'Introspection component only, not full repository validation. The no-introspection JWT path and separate pipeline auth implementation are unchanged. No production issuer, task data, deployment, new database or billable model call.',
    },
    null,
    2
  ) + '\n'
);
console.log(
  JSON.stringify({
    promotions: result.promotions.length,
    replay,
    fingerprint,
    parentHash,
    candidateHash,
    measurements: measurements.map((x) => ({
      suite: x.suite,
      score: x.score,
      retained: x.retained?.count,
    })),
  })
);
