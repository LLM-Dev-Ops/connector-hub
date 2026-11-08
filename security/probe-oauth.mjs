import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

export const contract = JSON.parse(
  readFileSync(new URL('./oauth-contract.json', import.meta.url), 'utf8')
);
export const sourcePath = 'packages/agents/src/auth/validators/oauth-validator.ts';
const unsignedJWT = [
  Buffer.from('{"alg":"HS256"}').toString('base64url'),
  Buffer.from('{"sub":"fixture"}').toString('base64url'),
  'invalid-signature',
].join('.');

export async function probeOAuth(root, names) {
  const { validateOAuth } = await import(pathToFileURL(resolve(root, sourcePath)).href);
  const reports = [];
  for (const name of names) {
    const now = Math.floor(Date.now() / 1000);
    let payload = {
      active: true,
      sub: 'fixture',
      iss: 'https://issuer.invalid',
      aud: 'connector',
      exp: now + 3600,
      scope: 'read write',
      token_type: 'bearer',
    };
    const options = { clockSkewSeconds: 0 };
    let expected = false;
    let status;
    switch (name) {
      case 'active-string':
        payload = { active: 'true' };
        break;
      case 'active-number':
        payload = { active: 1 };
        break;
      case 'active-array':
        payload = { active: [] };
        break;
      case 'exp-zero':
        payload = { active: true, exp: 0 };
        break;
      case 'exp-string':
        payload = { active: true, exp: String(now + 3600) };
        break;
      case 'exp-overflow':
        break; // Raw JSON below preserves non-finite numeric input.
      case 'exp-out-of-range':
        payload = { active: true, exp: 8640000000001 };
        break;
      case 'nbf-future':
        payload = { active: true, nbf: now + 3600 };
        break;
      case 'nbf-string':
        payload = { active: true, nbf: String(now + 3600) };
        break;
      case 'iat-string':
        payload = { active: true, iat: 'yesterday' };
        break;
      case 'aud-mismatch':
        options.expectedAudience = 'other';
        break;
      case 'aud-missing':
        payload = { active: true };
        options.expectedAudience = 'connector';
        break;
      case 'aud-mixed':
        payload = { active: true, aud: ['connector', 1] };
        options.expectedAudience = 'connector';
        break;
      case 'missing-scope':
        options.requiredScopes = ['admin'];
        break;
      case 'scope-array':
        payload = { active: true, scope: ['read'] };
        break;
      case 'sub-object':
        payload = { active: true, sub: {} };
        break;
      case 'type-number':
        payload = { active: true, token_type: 1 };
        break;
      case 'introspection-failure-jwt':
        break;
      case 'invalid-json-jwt':
        break;
      case 'valid':
        options.expectedIssuer = 'https://issuer.invalid';
        options.expectedAudience = 'connector';
        expected = true;
        status = 'valid';
        break;
      case 'minimal-active':
        payload = { active: true };
        expected = true;
        status = 'valid';
        break;
      case 'inactive':
        payload = { active: false };
        status = 'revoked';
        break;
      case 'expired':
        payload = { active: true, exp: now - 3600 };
        status = 'expired';
        break;
      case 'issuer-mismatch':
        options.expectedIssuer = 'https://other.invalid';
        status = 'issuer_mismatch';
        break;
      case 'aud-array-match':
        payload = { active: true, aud: ['other', 'connector'] };
        options.expectedAudience = ['connector', 'second'];
        expected = true;
        status = 'valid';
        break;
      case 'scopes-match':
        options.requiredScopes = ['read', 'write'];
        expected = true;
        status = 'valid';
        break;
      case 'opaque-unconfigured':
        status = 'unknown';
        break;
      case 'body-timeout':
        break;
      default:
        throw new Error(`Unknown frozen case ${name}`);
    }
    const timers = new Set();
    const server = createServer((req, res) => {
      req.resume();
      res.setHeader('Content-Type', 'application/json');
      if (name === 'introspection-failure-jwt') {
        res.writeHead(503);
        res.end('{}');
      } else if (name === 'invalid-json-jwt') res.end('{broken');
      else if (name === 'exp-overflow') res.end('{"active":true,"exp":1e400}');
      else if (name === 'body-timeout') {
        res.writeHead(200);
        res.write('{"active":true,');
        const timer = setTimeout(() => {
          timers.delete(timer);
          res.end('"sub":"late"}');
        }, 400);
        timers.add(timer);
      } else res.end(JSON.stringify(payload));
    });
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing loopback listener');
    if (name !== 'opaque-unconfigured')
      options.introspectionEndpoint = `http://127.0.0.1:${address.port}/introspect`;
    if (name === 'body-timeout') options.timeoutMs = 80;
    const started = performance.now();
    let result, error;
    try {
      result = await validateOAuth(name.endsWith('-jwt') ? unsignedJWT : 'opaque-fixture', options);
    } catch (caught) {
      error = String(caught);
    }
    const elapsedMs = performance.now() - started;
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections();
    await new Promise((ok) => server.close(() => ok()));
    reports.push({
      name,
      pass:
        !error &&
        result?.valid === expected &&
        (!status || result?.status === status) &&
        (name !== 'body-timeout' || elapsedMs < 350),
      valid: result?.valid,
      status: result?.status,
      error,
      elapsedMs,
      returned: result !== undefined,
    });
  }
  return reports;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] || '.');
  console.log(
    JSON.stringify({
      holdout: await probeOAuth(root, contract.holdout),
      anchor: await probeOAuth(root, contract.anchor),
    })
  );
}
