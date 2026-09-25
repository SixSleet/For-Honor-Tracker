/**
 * A different avenue: the hero services never probed, and the bundle's full
 * structure. Not for main.
 *
 * Every prior probe hit only heroranking / heroleaderboard / skillrating /
 * playerstats2. fh-configuration names a whole other family that has never been
 * called:
 *   - hn_game2web        — "game to web", built to surface game data to a web view
 *   - hn_metagame, hn_metagameworldstate, hn_metagamefactionstrength
 *                        — the Faction War world state, public aggregate data
 *                          the game shows everyone
 *   - hn_spectator, hn_arbitration, hn_gameutility
 *
 * The metagame/faction-strength services are especially worth trying: that data
 * is public and per-faction, not per-player, so it is both safe and genuinely
 * new if readable.
 *
 * Also: the public playlist bundle has only ever been grepped for "ranked".
 * This parses its whole structure — game-mode categories, recipes, division
 * and skill-family shapes — which is public, no-auth, and carries nothing
 * personal.
 *
 * Safety: plain session-ticket GETs (the metagame hosts are tried with no auth
 * too, since they may be open), no origin header, no anti-cheat/EOS flow. Any
 * 200 is reported as TOP-LEVEL KEY NAMES ONLY, never values, and the profile id
 * is masked to {id}. The log is public.
 */
import { NextResponse } from 'next/server';
import { verifyGithubActionsToken } from '@/server/github-oidc';
import { newTraceCollector } from '@/server/http';
import { FOR_HONOR_SPACE_IDS } from '@/server/providers/forhonor-ubisoft-stats';
import { __internal } from '@/server/providers/ubisoft';
import { readSession } from '@/server/ubisoft-session-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 240;

const PROBE_AUDIENCE = 'for-honor-tracker-ranked-probe';
const { login, authHeaders, forceRefresh, UBI_SERVICES } = __internal;

/** Config keys pointing at services this project has never called. */
const UNPROBED = [
  'hn_game2web',
  'hn_metagame',
  'hn_metagameworldstate',
  'hn_metagamefactionstrength',
  'hn_metagame_evolution',
  'hn_spectator',
  'hn_arbitration',
  'hn_gameutility_public_v1',
  'metagameworldstate_url',
];

interface Row {
  key: string;
  url: string;
  auth: 'ticket' | 'none';
  status: number;
  errorCode?: number | string;
  keys?: string;
  note?: string;
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
  const profileId = session.profileId || (await readSession())?.profileId || '';
  const headers = authHeaders(session);
  const mask = (t: string) => (profileId ? t.split(profileId).join('{id}') : t);

  // Read the crossplay config (the live space) once.
  const spaceId = FOR_HONOR_SPACE_IDS[1]!;
  const paramResp = await fetch(`${UBI_SERVICES}/v1/spaces/${spaceId}/parameters`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!paramResp.ok) {
    return NextResponse.json({ ok: false, reason: `parameters ${paramResp.status}` }, { status: 502 });
  }
  const body = (await paramResp.json()) as Record<string, unknown>;
  const inner = ((body['parameters'] ?? body) as Record<string, unknown>) ?? {};
  const config = (((inner['fh-configuration'] as Record<string, unknown>)?.['fields'] ??
    {}) as Record<string, string>);

  const rows: Row[] = [];

  async function ask(key: string, url: string, auth: 'ticket' | 'none') {
    try {
      const response = await fetch(url, {
        ...(auth === 'ticket' ? { headers } : {}),
        signal: AbortSignal.timeout(12_000),
      });
      const text = await response.text();
      let errorCode: number | string | undefined;
      let keys: string | undefined;
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        if (parsed['errorCode'] !== undefined) errorCode = parsed['errorCode'] as number | string;
        // Key names only — never values.
        if (response.ok) keys = Object.keys(parsed).slice(0, 30).join(',');
      } catch {
        if (response.ok) keys = '(non-JSON)';
      }
      rows.push({
        key,
        url: mask(url),
        auth,
        status: response.status,
        ...(errorCode !== undefined ? { errorCode } : {}),
        ...(keys ? { keys } : {}),
      });
    } catch (error) {
      rows.push({ key, url: mask(url), auth, status: 0, note: String(error).slice(0, 80) });
    }
  }

  // 1. The unprobed hero services, as named in config.
  for (const key of UNPROBED) {
    const baseUrl = config[key];
    if (typeof baseUrl !== 'string' || !baseUrl.startsWith('https://')) {
      rows.push({ key, url: '(absent from config)', auth: 'ticket', status: -1 });
      continue;
    }
    const root = baseUrl.replace(/\/$/, '');
    // Metagame/world-state hosts are public content services — try with no auth
    // as well, since they may be open and that is the safest possible read.
    const isMetagame = /metagame|worldstate|factionstrength/.test(key);
    await ask(key, root, 'ticket');
    if (isMetagame) await ask(key, root, 'none');
    // A couple of generic collection reads for game2web / gameutility.
    if (/game2web|gameutility/.test(key)) {
      await ask(`${key}/profiles/{id}`, `${root}/profiles/${profileId}`, 'ticket');
    }
  }

  // 2. The public playlist bundle, parsed for its whole shape (not just ranked).
  const bundleName = config['hn_default_playlist_bundle_name'];
  const bundleHost = config['hn_playlist_bundles_url'] ?? config['playlist_versions_url'];
  const bundle: Record<string, unknown> = { name: bundleName ?? null };
  if (bundleName && bundleHost) {
    try {
      const b = await fetch(`${bundleHost.replace(/\/$/, '')}/${bundleName}.json`, {
        signal: AbortSignal.timeout(20_000),
      });
      bundle['status'] = b.status;
      if (b.ok) {
        const parsed = JSON.parse(await b.text()) as Record<string, unknown>;
        bundle['topLevelKeys'] = Object.keys(parsed);
        // Structural summary of a few groups, counts and key shapes only.
        const summarize = (name: string) => {
          const node = parsed[name];
          if (Array.isArray(node)) {
            return {
              length: node.length,
              sampleKeys: node[0] && typeof node[0] === 'object' ? Object.keys(node[0] as object) : [],
            };
          }
          if (node && typeof node === 'object') return { keys: Object.keys(node as object) };
          return typeof node;
        };
        bundle['playlists'] = summarize('playlists');
        bundle['gameModeCategories'] = summarize('gameModeCategories');
        bundle['fronts'] = summarize('fronts');
        // Any playlist entry's full field shape (structure, not a player's data).
        const pls = parsed['playlists'];
        if (Array.isArray(pls) && pls[0] && typeof pls[0] === 'object') {
          bundle['playlistFields'] = Object.keys(pls[0] as object);
        }
      }
    } catch (error) {
      bundle['status'] = `ERROR ${String(error).slice(0, 60)}`;
    }
  }

  return NextResponse.json(
    { ok: true, at: new Date().toISOString(), commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null, rows, bundle },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
