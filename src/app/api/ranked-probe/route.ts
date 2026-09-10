/**
 * A throwaway research probe, asking one question: did the Ranked rework that
 * shipped as Season 0 on 2026-09-10 bring any player data with it that this
 * project can actually read?
 *
 * This route exists on a research branch and must never be merged. It runs on
 * a Vercel PREVIEW deployment, driven by the workflow beside it, because the
 * container this was written in cannot reach ubi.com at all.
 *
 * IT REPORTS SCHEMA, NEVER CONTENT. Its output goes to a public GitHub Actions
 * log, so it returns endpoint paths, HTTP statuses, stat key NAMES, leaderboard
 * NAMES and cardinality counts — the parts that are identical for every player
 * — and never a stat value, a profile id, a display name or a ticket. The
 * question here is "does this endpoint carry ranked data", which key names and
 * counts answer on their own.
 */
import { NextResponse } from 'next/server';
import { verifyGithubActionsToken } from '@/server/github-oidc';
import { newTraceCollector } from '@/server/http';
import { FOR_HONOR_SPACE_IDS } from '@/server/providers/forhonor-ubisoft-stats';
import { __internal } from '@/server/providers/ubisoft';
import { readSession } from '@/server/ubisoft-session-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PROBE_AUDIENCE = 'for-honor-tracker-ranked-probe';
const { login, authHeaders, UBI_SERVICES } = __internal;

interface Probe {
  path: string;
  status: number | null;
  note?: string;
  /** Key or entry NAMES only. Never values. */
  names?: string[];
  count?: number;
}

/** Ranked leaderboards to ask for by name, including guesses at new ones. */
const LEADERBOARD_CANDIDATES = [
  // Found live earlier in this project: the Ranked Duel definition.
  'RankingPointsPerGameModeSeasonal.gameMode.R_DL2',
  // Ranked Dominion is new in Season 0; these are the shapes it would take
  // given how the Duel one is named.
  'RankingPointsPerGameModeSeasonal.gameMode.R_DM2',
  'RankingPointsPerGameModeSeasonal.gameMode.R_DMN2',
  'RankingPointsPerGameModeSeasonal.gameMode.R_DOM',
  'RankingPointsPerGameModeSeasonal.gameMode.R_DOM2',
  'RankingPointsPerGameModeSeasonal',
  'SeasonalLeaderboard',
  'RankedSeasonalLeaderboard',
];

export async function GET(request: Request) {
  const presented = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const verdict = await verifyGithubActionsToken(presented, { audience: PROBE_AUDIENCE });
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, reason: verdict.reason }, { status: 401 });
  }

  const trace = newTraceCollector();
  const stored = await readSession();
  if (!stored) {
    return NextResponse.json(
      { ok: false, reason: 'This deployment has no Ubisoft session (preview env vars?).' },
      { status: 503 },
    );
  }

  const session = await login(trace);
  const headers = authHeaders(session);
  const profileId = session.profileId || stored.profileId;
  const probes: Probe[] = [];

  async function ask(path: string, extract?: (body: unknown) => Partial<Probe>) {
    // The path is logged; the profile id inside it never is.
    const label = path.replace(profileId, '{self}');
    try {
      const response = await fetch(`${UBI_SERVICES}${path}`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* not JSON; status alone is the result */
      }
      probes.push({
        path: label,
        status: response.status,
        ...(response.ok && parsed && extract ? extract(parsed) : {}),
        ...(response.ok ? {} : { note: text.slice(0, 200).replace(profileId, '{self}') }),
      });
    } catch (error) {
      probes.push({ path: label, status: null, note: String(error).slice(0, 120) });
    }
  }

  for (const spaceId of FOR_HONOR_SPACE_IDS) {
    // 1. The lifetime stat ledger. New ranked counters would appear as new
    //    key names here — names only, so nothing personal leaves.
    await ask(
      `/v1/profiles/stats?spaceId=${spaceId}&profileIds=${profileId}`,
      (body) => {
        const stats = (body as { stats?: Array<{ stats?: Record<string, unknown> }> }).stats ?? [];
        const names = Object.keys(stats[0]?.stats ?? {}).sort();
        return {
          count: names.length,
          names: names.filter((n) => /rank|season|elo|rating|skill|division|tier/i.test(n)),
          note: `${names.length} keys; listing only ranked/seasonal-looking names`,
        };
      },
    );

    // 2. Ubisoft's own client URL catalogue. A new ranked backend has to be
    //    reachable by the game, so it would be named here.
    await ask(`/v1/spaces/${spaceId}/parameters`, (body) => {
      const groups = body as Record<string, Record<string, unknown>>;
      const urls = groups['us-sdkClientUrls'] ?? {};
      const names = Object.keys(urls).sort();
      return {
        count: names.length,
        names: names.filter((n) => /rank|season|leaderboard|elo|skill|division|compet/i.test(n)),
        note: `${names.length} URL templates; listing only ranked/seasonal-looking names`,
      };
    });

    // 3. The leaderboards themselves. Earlier in this project every ranked
    //    board answered 200 with cardinality 0 — defined but never populated.
    //    Seasonal Leaderboards shipping as a real feature is the thing most
    //    likely to have changed that, so cardinality is the number that matters.
    for (const name of LEADERBOARD_CANDIDATES) {
      await ask(
        `/v1/spaces/${spaceId}/leaderboards/${encodeURIComponent(name)}?profileId=${profileId}`,
        (body) => {
          const board = body as { cardinality?: number; standings?: unknown[] };
          return {
            count: typeof board.cardinality === 'number' ? board.cardinality : undefined,
            note: `cardinality=${board.cardinality ?? '?'} standings=${
              Array.isArray(board.standings) ? board.standings.length : '?'
            }`,
          };
        },
      );
    }
  }

  return NextResponse.json(
    { ok: true, at: new Date().toISOString(), probes },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
