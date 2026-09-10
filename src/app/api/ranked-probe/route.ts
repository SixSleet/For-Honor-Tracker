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
  const maskIds: string[] = [profileId];

  async function ask(path: string, extract?: (body: unknown) => Partial<Probe>) {
    let label = path;
    for (const id of maskIds) if (id) label = label.split(id).join('{id}');
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
          : {
              note: maskIds
                .reduce((acc, id) => (id ? acc.split(id).join('{id}') : acc), text)
                .slice(0, 160),
            }),
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

  // The ticket's own profileId works for statscard but returns an empty
  // profiles[] from /v1/profiles/stats — the stat ledger is keyed per platform
  // profile, and the app only ever reaches it with a SEARCHED player's id.
  // Resolve this account's own platform profiles the same way the app does,
  // and ask each of them. Ids are never logged; only how many and which
  // platform, which is game metadata rather than anything personal.
  const statProfileIds: string[] = [profileId];
  await ask(`/v2/profiles?userId=${profileId}`, (body) => {
    const list = (body as { profiles?: Array<{ profileId?: string; platformType?: string }> })
      .profiles ?? [];
    const types: string[] = [];
    for (const entry of list) {
      if (entry.platformType) types.push(entry.platformType);
      if (entry.profileId && !statProfileIds.includes(entry.profileId)) {
        statProfileIds.push(entry.profileId);
        maskIds.push(entry.profileId);
      }
    }
    return { count: list.length, names: types, note: 'platform profiles resolved' };
  });

  await ask(`/v1/profiles/gamesplayed?profileIds=${profileId}`, (body) => {
    const games = (body as { gamesPlayed?: Array<{ spaceId?: string }> }).gamesPlayed ?? [];
    return {
      count: games.length,
      names: games.map((g) => g.spaceId ?? '?').slice(0, 10),
      note: 'spaces this account owns',
    };
  });

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

    // The response is { profiles: [{ profileId, stats }] } — as the provider
    // itself parses it. An earlier version of this probe read body.stats[0]
    // and reported 0 keys, which looked like the ledger had been wiped.
    for (const [index, statId] of statProfileIds.entries()) {
      await ask(`/v1/profiles/stats?spaceId=${spaceId}&profileIds=${statId}`, (body) => {
        const profiles =
          (body as { profiles?: Array<{ profileId?: string; stats?: Record<string, unknown> }> })
            .profiles ?? [];
        const names = Object.keys(profiles[0]?.stats ?? {}).sort();
        return {
          count: names.length,
          names: names.filter((n) => /rank|season|elo|rating|skill|division|tier|compet/i.test(n)),
          note: `${short} profile#${index}: ${profiles.length} profiles, ${names.length} keys`,
        };
      });
    }

    // Report the catalogue's own top-level shape rather than assuming it:
    // the first version guessed a key and reported 0, which was the guess
    // failing, not the catalogue being empty.
    // Dump the configuration properly rather than counting it. The previous
    // conclusion ("no new surface") compared 202 templates against a
    // remembered ~200 and called that unchanged — a count is not a diff, and
    // the only names printed were the ones matching a guessed regex. So print
    // the whole catalogue, and open the groups that were never opened:
    // fh-configuration is where this project found For Honor's own title
    // services (playerstats2, heroleaderboard, heroranking, skillrating) and
    // had 73 fields, and fh-customFeatureSwitches is where a new ranked mode
    // would be gated.
    await ask(`/v1/spaces/${spaceId}/parameters`, (body) => {
      const outer = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      const inner = (outer['parameters'] ?? outer) as Record<string, unknown>;
      const out: string[] = [];

      const urls = (inner['us-sdkClientUrls'] ?? {}) as Record<string, unknown>;
      const fields = (urls['fields'] ?? {}) as Record<string, unknown>;
      const fieldNames = Object.keys(fields).sort();
      out.push(`ALL-URL-TEMPLATES[${fieldNames.length}]: ${fieldNames.join(' ')}`);

      // Every group this project has never opened. Config is space-level game
      // metadata — identical for every player — so names and values are safe
      // to print; nothing here is per-account.
      for (const group of [
        'fh-configuration',
        'fh-customFeatureSwitches',
        'fh-clientSettings',
        'fh-urlsNonFinalOnly',
        'tgdpConfig',
        'us-sdkClientFeaturesSwitches',
        'fh-clubServices',
      ]) {
        const value = inner[group];
        if (!value || typeof value !== 'object') {
          out.push(`${group}: ABSENT`);
          continue;
        }
        // Every group is itself wrapped as { fields, relatedPopulation }, so
        // unwrap before printing — the previous run reported "[2 fields]" for
        // all of them, which was the wrapper, not the contents.
        const wrapper = value as Record<string, unknown>;
        const inner2 = (wrapper['fields'] ?? wrapper) as Record<string, unknown>;
        const entries = Object.entries(inner2);
        out.push(`--- ${group} [${entries.length} fields] ---`);
        for (const [key, raw] of entries) {
          const flat =
            raw && typeof raw === 'object' ? JSON.stringify(raw) : String(raw ?? '');
          // 160 chars truncated fh-configuration mid-URL last time, hiding the
          // title-service hosts this project found before, and cut the feature
          // switch list off after "Tournament". These are space-level game
          // config, identical for every player, so print them whole.
          out.push(`${key} = ${flat.slice(0, 2000)}`);
        }
      }

      return {
        count: fieldNames.length,
        names: out,
        note: `${short}: full configuration dump`,
      };
    });

    // Enumerate rather than guess. The previous run's 404s only ruled out the
    // eight names guessed at; if the rework renamed the boards, the list is
    // the only way to learn what they are now called.
    await ask(`/v1/spaces/${spaceId}/leaderboards`, (body) => {
      const outer = body as { leaderboards?: unknown[] } & Record<string, unknown>;
      const list = Array.isArray(outer.leaderboards) ? outer.leaderboards : [];
      const names = list
        .map((entry) => (entry as { name?: string })?.name)
        .filter((n): n is string => typeof n === 'string');
      return {
        count: names.length,
        names: names.slice(0, 60),
        note: `${short}: LIST — top-level keys ${Object.keys(outer).join(',')}`.slice(0, 200),
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
