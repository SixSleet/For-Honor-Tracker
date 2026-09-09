/**
 * Verifies a GitHub Actions OIDC identity token.
 *
 * This exists so the scheduled session refresh can be driven from a GitHub
 * Actions workflow without a shared secret existing anywhere. A workflow with
 * `id-token: write` can ask GitHub for a short-lived token describing the run
 * — which repository, which workflow, which ref — signed by GitHub's own key.
 * Anyone can fetch the matching public keys; nobody but GitHub can mint a
 * token. So the two sides need nothing configured in common: the workflow
 * names an audience, and this file names the repository it will accept.
 *
 * That matters more than the convenience. The alternative is a secret pasted
 * into both Vercel and GitHub by hand, which has to be got right once and then
 * stays right forever — and the failure mode when it is not is silent, because
 * a rejected refresh looks exactly like a refresh that never ran. There is
 * nothing here to get wrong and nothing to rotate.
 *
 * What is checked, in order: the signature against GitHub's published keys,
 * the issuer, the audience this route asked for, the token's own validity
 * window, and the repository the run belongs to. A token minted by a workflow
 * in someone else's repository is signed by the same issuer and is still
 * rejected, because the repository claim is what actually authorizes.
 */
import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';

const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS_URL = `${ISSUER}/.well-known/jwks`;

/**
 * The audience the workflow must request. It is not a secret — it scopes the
 * token to this one use, so a token minted for some other purpose in the same
 * repository cannot be replayed here.
 */
export const REFRESH_AUDIENCE = 'for-honor-tracker-session-refresh';

/**
 * The repository allowed to drive the refresh, by numeric id rather than by
 * name: ids survive a rename or a transfer, and a name does not. Overridable
 * for anyone running their own fork of this project.
 */
const EXPECTED_REPOSITORY_ID = process.env.GITHUB_OIDC_REPOSITORY_ID?.trim() || '1355654843';

/** Tolerance for clock drift between GitHub and this server. */
const CLOCK_SKEW_SECONDS = 60;

interface Jwk {
  kty?: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

/** Claims this project reads. GitHub sends a good many more. */
export interface GithubOidcClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  repository?: string;
  repository_id?: string;
  repository_owner?: string;
  workflow?: string;
  ref?: string;
  event_name?: string;
}

export type OidcResult =
  | { ok: true; claims: GithubOidcClaims }
  | { ok: false; reason: string };

function decodeSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

/** GitHub's signing keys, cached between invocations of a warm instance. */
let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
let lastFetchAt = 0;

const JWKS_TTL_MS = 60 * 60_000;

/**
 * How often an unrecognised key id may force a fetch ahead of that TTL.
 *
 * GitHub rotates its keys, so a `kid` the cache does not know has to be able
 * to trigger a look — otherwise a rotation would break the refresh until the
 * cache happened to expire. But this route answers before it has authenticated
 * anybody, and a `kid` is free to invent, so without a floor here any passer-by
 * could turn one request to this site into one request to GitHub.
 */
const REFETCH_MIN_INTERVAL_MS = 60_000;

async function fetchJwks(nowMs: number): Promise<Jwk[]> {
  lastFetchAt = nowMs;
  const response = await fetch(JWKS_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`JWKS fetch returned ${response.status}`);
  const body = (await response.json()) as { keys?: Jwk[] };
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new Error('JWKS response contained no keys');
  }
  jwksCache = { keys: body.keys, fetchedAt: nowMs };
  return body.keys;
}

function pick(keys: Jwk[], kid: string): Jwk | null {
  return keys.find((candidate) => candidate.kid === kid) ?? null;
}

async function keyForKid(kid: string, nowMs: number): Promise<KeyObject | null> {
  const cached =
    jwksCache && nowMs - jwksCache.fetchedAt < JWKS_TTL_MS ? jwksCache.keys : null;

  let jwk = cached ? pick(cached, kid) : null;
  if (!jwk && (!cached || nowMs - lastFetchAt >= REFETCH_MIN_INTERVAL_MS)) {
    jwk = pick(await fetchJwks(nowMs), kid);
  }
  if (!jwk) return null;

  if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) return null;
  return createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
}

/**
 * Verify a token and return its claims, or the reason it was refused.
 *
 * `now` is injectable so the validity window and the key cache can both be
 * tested without waiting real hours for a token or a cache entry to age out.
 */
export async function verifyGithubActionsToken(
  token: string,
  options: { audience?: string; now?: number } = {},
): Promise<OidcResult> {
  const audience = options.audience ?? REFRESH_AUDIENCE;
  const nowMs = options.now ?? Date.now();
  const nowSeconds = Math.floor(nowMs / 1000);

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'Not a JWT.' };
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  let header: { alg?: string; kid?: string };
  let claims: GithubOidcClaims;
  try {
    header = decodeSegment(headerPart) as { alg?: string; kid?: string };
    claims = decodeSegment(payloadPart) as GithubOidcClaims;
  } catch {
    return { ok: false, reason: 'Malformed token.' };
  }

  // Pin the algorithm rather than trusting the header's own claim about it:
  // an attacker chooses the header, so "alg" is an input, not a fact.
  if (header.alg !== 'RS256') return { ok: false, reason: 'Unexpected signing algorithm.' };
  if (!header.kid) return { ok: false, reason: 'Token names no signing key.' };

  let key: KeyObject | null;
  try {
    key = await keyForKid(header.kid, nowMs);
  } catch (error) {
    return { ok: false, reason: `Could not reach GitHub's signing keys: ${String(error)}` };
  }
  if (!key) return { ok: false, reason: 'Token was signed by an unrecognised key.' };

  const signed = Buffer.from(`${headerPart}.${payloadPart}`, 'utf8');
  const signature = Buffer.from(signaturePart, 'base64url');
  if (!verifySignature('RSA-SHA256', signed, key, signature)) {
    return { ok: false, reason: 'Signature did not verify.' };
  }

  // Everything below is a claim check. They only mean anything now that the
  // signature has proven GitHub wrote them.
  if (claims.iss !== ISSUER) return { ok: false, reason: 'Wrong issuer.' };

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(audience)) return { ok: false, reason: 'Wrong audience.' };

  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < nowSeconds) {
    return { ok: false, reason: 'Token has expired.' };
  }
  const notBefore = typeof claims.nbf === 'number' ? claims.nbf : claims.iat;
  if (typeof notBefore === 'number' && notBefore - CLOCK_SKEW_SECONDS > nowSeconds) {
    return { ok: false, reason: 'Token is not valid yet.' };
  }

  if (String(claims.repository_id ?? '') !== EXPECTED_REPOSITORY_ID) {
    return { ok: false, reason: 'Token belongs to a different repository.' };
  }

  return { ok: true, claims };
}
