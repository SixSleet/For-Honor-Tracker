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
const { login, authHeaders, forceRefresh, UBI_SERVICES } = __internal;

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

  // The stored session carries an empty profileId — the app never needs its
  // own, it resolves a SEARCHED player's id instead. Sliding the session
  // forward mints a fresh ticket and returns the profile it belongs to, which
  // is the only id available here. The first version of this probe skipped
  // that and asked every endpoint about nobody: /v1/profiles/stats duly
  // answered 200 with zero keys, which reads exactly like "the ranked rework
  // removed everything" and means nothing of the sort.
  await forceRefresh(trace);
  const session = await login(trace);
  const stored = await readSession();
  const profileId = session.profileId || stored?.profileId || '';

  const probes: Probe[] = [];

  async function ask(path: string, extract?: (body: unknown) => Partial<Probe>) {
    const label = profileId ? path.split(profileId).join('{self}') : path;
    try {
      const response = await fetch(`${UBI_SERVICES}${path}`, {
        headers: authHeaders(session),
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
        ...(response.ok
          ? {}
          : { note: (profileId ? text.split(profileId).join('{self}') : text).slice(0, 160) }),
      });
    } catch (error) {
      probes.push({ path: label, status: null, note: String(error).slice(0, 120) });
    }
  }

  // CONTROL. Nothing below is worth reading unless this says the session and
  // the profile id are both good, so it runs first and reports counts only.
  const control: Probe[] = [];
  if (!profileId) {
    control.push({ path: 'CONTROL resolve own profileId', status: null, note: 'FAILED: empty' });
  } else {
    control.push({
      path: 'CONTROL resolve own profileId',
      status: 200,
      note: `ok, ${profileId.length} chars`,
    });
  }

  for (const spaceId of FOR_HONOR_SPACE_IDS) {
    const short = spaceId.slice(0, 8);

    // CONTROL: an endpoint proven to carry data earlier in this project.
    // If this returns entries, a 404 below is Ubisoft's answer, not our bug.
    await ask(
      `/v1/profiles/${profileId}/statscard?spaceId=${spaceId}`,
      (body) => {
        const entries = (body as { Statscards?: unknown[] }).Statscards ?? [];
        return { count: Array.isArray(entries) ? entries.length : 0, note: `CONTROL ${short}` };
      },
    );

    await ask(`/v1/profiles/stats?spaceId=${spaceId}&profileIds=${profileId}`, (body) => {
      const stats = (body as { stats?: Array<{ stats?: Record<string, unknown> }> }).stats ?? [];
      const names = Object.keys(stats[0]?.stats ?? {}).sort();
      return {
        count: names.length,
        names: names.filter((n) => /rank|season|elo|rating|skill|division|tier/i.test(n)),
        note: `${short}: ${names.length} keys total; ranked/seasonal-looking names listed`,
      };
    });

    // Report the catalogue's own top-level shape rather than assuming it:
    // the first version guessed a key and reported 0, which was the guess
    // failing, not the catalogue being empty.
    await ask(`/v1/spaces/${spaceId}/parameters`, (body) => {
      const top = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      const groups = Object.keys(top).sort();
      const urls = top['us-sdkClientUrls'];
      const urlNames = urls && typeof urls === 'object' ? Object.keys(urls as object) : [];
      return {
        count: urlNames.length,
        names: [
          `GROUPS[${groups.length}]: ${groups.slice(0, 12).join(',')}`,
          ...urlNames.filter((n) => /rank|season|leaderboard|elo|skill|division|compet/i.test(n)),
        ],
        note: `${short}: ${urlNames.length} URL templates`,
      };
    });

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
    {
      ok: true,
      at: new Date().toISOString(),
      // Which build answered. The branch alias keeps serving the PREVIOUS
      // ready deployment while a new one builds, and that old build returns
      // perfectly valid JSON — so without this the workflow cannot tell the
      // run it just pushed from the one before it, and silently reads stale
      // results. It did exactly that twice.
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      control,
      probes,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
