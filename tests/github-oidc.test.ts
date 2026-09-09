/**
 * The OIDC verifier is what stands between a scheduled refresh and anyone who
 * can send this site a request, and it is not exercised by ordinary use — a
 * mistake in it would surface either as a refresh that silently stopped
 * working or as an endpoint that accepted anything. So every accept and every
 * reject is tested here against real signatures.
 *
 * A throwaway RSA key stands in for GitHub's: the module is handed its public
 * half through a stubbed fetch, exactly as it would receive the real JWKS.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';

import { verifyGithubActionsToken, REFRESH_AUDIENCE } from '../src/server/github-oidc.ts';

const ISSUER = 'https://token.actions.githubusercontent.com';
const REPO_ID = '1355654843';
const KID = 'test-key-1';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

function jwksFor(key: KeyObject, kid: string): string {
  const jwk = key.export({ format: 'jwk' }) as Record<string, string>;
  return JSON.stringify({ keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] });
}

/** Serve a JWKS the way GitHub would, so the module's fetch path is real. */
function serveJwks(body: string, status = 200) {
  globalThis.fetch = (async () =>
    new Response(body, { status, headers: { 'content-type': 'application/json' } })) as never;
}

function b64(value: object | string): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return Buffer.from(raw, 'utf8').toString('base64url');
}

const nowSeconds = Math.floor(Date.now() / 1000);

function mint(
  claims: Record<string, unknown> = {},
  opts: { key?: KeyObject; kid?: string; alg?: string } = {},
): string {
  const header = b64({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? KID, typ: 'JWT' });
  const payload = b64({
    iss: ISSUER,
    aud: REFRESH_AUDIENCE,
    repository: 'SixSleet/For-Honor-Tracker',
    repository_id: REPO_ID,
    iat: nowSeconds - 10,
    nbf: nowSeconds - 10,
    exp: nowSeconds + 300,
    ...claims,
  });
  const signer = createSign('RSA-SHA256').update(`${header}.${payload}`);
  const signature = signer.sign(opts.key ?? privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

// --- key handling ----------------------------------------------------------
// This one runs first, deliberately: it is the only chance to exercise a cold
// key cache, and a verifier that admitted a caller when it could not reach
// GitHub would be the worst possible failure.

test('an unreachable JWKS refuses rather than admitting the caller', async () => {
  serveJwks('', 500);
  const result = await verifyGithubActionsToken(mint());
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : '', /signing keys/);
});

// --- the accepting case ----------------------------------------------------

test('a well-formed token from this repository is accepted', async () => {
  serveJwks(jwksFor(publicKey, KID));
  const result = await verifyGithubActionsToken(mint());
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.claims.repository, 'SixSleet/For-Honor-Tracker');
});

// --- the rejecting cases ---------------------------------------------------

test('a token signed by anyone but GitHub is rejected', async () => {
  serveJwks(jwksFor(publicKey, KID));
  // Correct claims, correct key id, wrong private key: only the signature
  // check can catch this, so it proves the signature is actually verified.
  const result = await verifyGithubActionsToken(mint({}, { key: other.privateKey }));
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'Signature did not verify.');
});

test('a token from a different repository is rejected', async () => {
  serveJwks(jwksFor(publicKey, KID));
  // Genuinely signed by GitHub — any workflow anywhere can get one of these,
  // which is exactly why the repository claim has to be what authorizes.
  const result = await verifyGithubActionsToken(
    mint({ repository: 'someone/else', repository_id: '999' }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'Token belongs to a different repository.');
});

test('a token minted for another audience is rejected', async () => {
  serveJwks(jwksFor(publicKey, KID));
  const result = await verifyGithubActionsToken(mint({ aud: 'https://vercel.com' }));
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'Wrong audience.');
});

test('an expired token is rejected', async () => {
  serveJwks(jwksFor(publicKey, KID));
  const result = await verifyGithubActionsToken(
    mint({ iat: nowSeconds - 4000, nbf: nowSeconds - 4000, exp: nowSeconds - 3600 }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'Token has expired.');
});

test('a token from the wrong issuer is rejected', async () => {
  serveJwks(jwksFor(publicKey, KID));
  const result = await verifyGithubActionsToken(mint({ iss: 'https://evil.example' }));
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'Wrong issuer.');
});

test('an unsigned "alg: none" token is rejected', async () => {
  serveJwks(jwksFor(publicKey, KID));
  // The header is attacker-controlled, so the algorithm must be pinned rather
  // than read from it. This is the classic JWT bypass.
  const header = b64({ alg: 'none', kid: KID, typ: 'JWT' });
  const payload = b64({
    iss: ISSUER,
    aud: REFRESH_AUDIENCE,
    repository_id: REPO_ID,
    exp: nowSeconds + 300,
  });
  const result = await verifyGithubActionsToken(`${header}.${payload}.`);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'Unexpected signing algorithm.');
});

test('a token naming an unknown signing key is rejected', async () => {
  serveJwks(jwksFor(publicKey, KID));
  const result = await verifyGithubActionsToken(mint({}, { kid: 'not-a-real-kid' }));
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'Token was signed by an unrecognised key.');
});

test('a secret sent where a token belongs is rejected, not crashed on', async () => {
  serveJwks(jwksFor(publicKey, KID));
  const result = await verifyGithubActionsToken('kandjkbkih1231');
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'Not a JWT.');
});

// Last, and deliberately so: this one advances the key cache's clock two hours
// to prove a rotation is picked up, which would leave any test after it
// reading a cache stamped in the future.
test('a rotated signing key is picked up rather than locked out', async () => {
  serveJwks(jwksFor(publicKey, KID));
  assert.equal((await verifyGithubActionsToken(mint())).ok, true);

  // GitHub rotates: same issuer, new key id, and the cached JWKS no longer
  // describes it. Two hours on, the verifier must go and look again.
  const later = Date.now() + 2 * 3600_000;
  const laterSeconds = Math.floor(later / 1000);
  serveJwks(jwksFor(other.publicKey, 'test-key-2'));
  const result = await verifyGithubActionsToken(
    mint(
      { iat: laterSeconds - 10, nbf: laterSeconds - 10, exp: laterSeconds + 300 },
      { key: other.privateKey, kid: 'test-key-2' },
    ),
    { now: later },
  );
  assert.equal(result.ok, true);
});
