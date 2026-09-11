/**
 * Independent check of the playlist-bundle finding from the parallel research
 * branch `research/ranked-season-2026-09-10`.
 *
 * Not for main. That branch reported two NEW ranked playlist definitions for
 * Season 0 — 135 "4v4 Dominion (Ranked)" and 136 "1v1 Duel (Ranked V2)" —
 * pulled from a public bundle at playlists-2.forhonor.ubisoft.com. The finding
 * looks right and its evidence carries sha256 hashes, but it is another
 * agent's result, so it is verified here rather than taken on trust, and its
 * snapshot is a day old.
 *
 * Three things this settles that the report could not:
 *   1. whether the bundle the live configuration points at TODAY is still
 *      3901.0.0-prod-v2, or has moved since;
 *   2. whether the bundle is readable with NO credentials at all — it is
 *      fetched here with no Authorization header, deliberately, because a
 *      source that needs no session is worth far more to this project than
 *      one that does;
 *   3. whether the three ranked definitions are actually in it.
 *
 * Reports the bundle name, status, sha256 and the ranked entries' id, name and
 * minimumReputation. Those are game configuration, identical for every player,
 * so nothing personal reaches this public log.
 */
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { verifyGithubActionsToken } from '@/server/github-oidc';
import { newTraceCollector } from '@/server/http';
import { FOR_HONOR_SPACE_IDS } from '@/server/providers/forhonor-ubisoft-stats';
import { __internal } from '@/server/providers/ubisoft';
import { readSession } from '@/server/ubisoft-session-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const PROBE_AUDIENCE = 'for-honor-tracker-ranked-probe';
const { login, authHeaders, forceRefresh, UBI_SERVICES } = __internal;

interface Ranked {
  id?: number;
  name?: string;
  minimumReputation?: number;
  maximumGroupSize?: number;
  divisionSpread?: number;
}

export async function GET(request: Request) {
  const presented = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const verdict = await verifyGithubActionsToken(presented, { audience: PROBE_AUDIENCE });
  if (!verdict.ok) return NextResponse.json({ ok: false, reason: verdict.reason }, { status: 401 });

  const trace = newTraceCollector();
  if (!(await readSession())) {
    return NextResponse.json({ ok: false, reason: 'No session here.' }, { status: 503 });
  }
  await forceRefresh(trace);
  const session = await login(trace);
  const headers = authHeaders(session);

  const report: Record<string, unknown> = {};

  for (const spaceId of FOR_HONOR_SPACE_IDS) {
    const short = spaceId.slice(0, 8);
    const entry: Record<string, unknown> = {};

    // What bundle does the live configuration point at right now?
    const response = await fetch(`${UBI_SERVICES}/v1/spaces/${spaceId}/parameters`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      report[short] = { parameters: `HTTP ${response.status}` };
      continue;
    }
    const body = (await response.json()) as Record<string, unknown>;
    const inner = ((body['parameters'] ?? body) as Record<string, unknown>) ?? {};
    const config = (((inner['fh-configuration'] as Record<string, unknown>)?.['fields'] ??
      {}) as Record<string, string>);

    const bundleName = config['hn_default_playlist_bundle_name'];
    const bundleHost = config['hn_playlist_bundles_url'] ?? config['playlist_versions_url'];
    entry['bundleName'] = bundleName ?? null;
    entry['bundleHost'] = bundleHost ?? null;
    entry['nextBundle'] = config['hn_next_playlist_bundle_name'] || '(none)';

    if (!bundleName || !bundleHost) {
      report[short] = entry;
      continue;
    }

    // Fetch it with NO credentials. If this works, the source needs no session.
    const url = `${bundleHost.replace(/\/$/, '')}/${bundleName}.json`;
    entry['bundleUrl'] = url;
    try {
      const bundle = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      entry['anonymousStatus'] = bundle.status;
      if (bundle.ok) {
        const text = await bundle.text();
        entry['sha256'] = createHash('sha256').update(text).digest('hex');
        entry['bytes'] = text.length;
        try {
          const parsed = JSON.parse(text) as Record<string, unknown>;
          entry['topLevelKeys'] = Object.keys(parsed).slice(0, 20);
          // Find every playlist whose name mentions Ranked, wherever it lives.
          const found: Ranked[] = [];
          const walk = (node: unknown) => {
            if (Array.isArray(node)) return node.forEach(walk);
            if (!node || typeof node !== 'object') return;
            const record = node as Record<string, unknown>;
            if (typeof record['name'] === 'string' && /ranked/i.test(record['name'])) {
              found.push({
                id: typeof record['id'] === 'number' ? record['id'] : undefined,
                name: record['name'],
                minimumReputation: record['minimumReputation'] as number | undefined,
                maximumGroupSize: record['maximumGroupSize'] as number | undefined,
                divisionSpread: record['divisionSpread'] as number | undefined,
              });
            }
            Object.values(record).forEach(walk);
          };
          walk(parsed);
          entry['rankedPlaylists'] = found;
        } catch {
          entry['parse'] = 'not JSON';
        }
      }
    } catch (error) {
      entry['anonymousStatus'] = `ERROR ${String(error).slice(0, 80)}`;
    }

    report[short] = entry;
  }

  return NextResponse.json(
    { ok: true, at: new Date().toISOString(), commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null, report },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
