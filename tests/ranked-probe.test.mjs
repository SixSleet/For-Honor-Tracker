import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedUrl, advertisedRoutes, summarize, run, ORIGIN, SPACES } from '../scripts/probe-ranked.mjs';

test('probe is offline unless explicitly enabled', async () => {
  const result = await run({ fetchImpl: () => { throw new Error('network used'); } });
  assert.equal(result.mode, 'offline');
});

test('untrusted catalogue cannot redirect credentials to another host or admin route', () => {
  for (const url of [
    'https://evil.example/v1/profiles/ranks',
    `${ORIGIN}@evil.example/v1/profiles/ranks`,
    `${ORIGIN}/v1/profiles/sessions`,
    `${ORIGIN}/v1/profiles/ranks?token=secret`,
    `${ORIGIN}/v1/spaces/${SPACES[0]}/title/hero/hero-live/heroranking/admin/v2/`,
  ]) assert.equal(allowedUrl(url), false);
  assert.deepEqual(advertisedRoutes({ parameters: { 'fh-configuration': { fields: {
    hn_ranking_public_v2: 'https://evil.example/steal',
  } } } }, SPACES[0]), []);
});

test('response summaries never copy personal data or treat HTTP 200 as rank confirmation', () => {
  const result = summarize(200, { ticket: 'secret', message: 'private', standings: [{ profileId: 'private', rank: 7 }], cardinality: 1 });
  assert.deepEqual(result, { status: 200, outcome: 'response-received-unverified', cardinality: 1, standingsCount: 1 });
});

for (const status of [401, 403, 429]) test(`stops immediately on ${status} and uses GET without redirects`, async () => {
  let calls = 0;
  const result = await run({ live: true, env: { UBISOFT_TICKET: 'test-secret' }, pause: async () => {}, fetchImpl: async (_url, options) => {
    calls++;
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    return new Response(JSON.stringify({ message: 'test-secret', errorCode: 4 }), { status });
  } });
  assert.equal(calls, 1);
  assert.equal(result.halted, true);
  assert.equal(JSON.stringify(result).includes('test-secret'), false);
});

test('network exception text is never logged and no retries occur', async () => {
  let calls = 0;
  const result = await run({ live: true, env: {}, fetchImpl: async () => { calls++; throw new Error('private-ticket'); } });
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(result).includes('private-ticket'), false);
  assert.equal(result.halted, true);
});

test('oversized response is discarded and halts the probe', async () => {
  const result = await run({ live: true, env: {}, fetchImpl: async () => new Response('x'.repeat(512001)) });
  assert.equal(result.halted, true);
  assert.equal(result.requests[0].outcome, 'network-or-response-error');
});
