# Ranked Season 0 investigation — 2026-09-10

**Result: new ranked playlist definitions confirmed; no working player-rank endpoint confirmed.**

Research branch: `research/ranked-season-2026-09-10`, based on main commit
`54dab36b4a678ddc453dde475818b00f15992ed9`. Only standalone research scripts,
tests and sanitized results are added. No application routes, deployment
configuration or production credentials are changed. This is branch isolation,
not a claim that GitHub branch-protection rules were configured.

## Confirmed release changes

Ubisoft's [Ranked FAQ](https://www.ubisoft.com/en-us/game/for-honor/news-updates/4WKJhG6v6C9sbCOZkFZ6wG/ranked-faq)
announces Season 0 for Ranked Dominion and reworked Ranked Duel on September 10.
Competitive season numbering is separate from the game's Y10S3 designation.
Do not use `MetaGameSeason` as a competitive season ID without verification.

The live crossplay configuration advertises playlist bundle `3901.0.0-prod-v2`.
Both it and the previous research baseline were downloaded successfully:

- [Current public bundle](https://playlists-2.forhonor.ubisoft.com/3901.0.0-prod-v2.json)
- [Earlier public bundle](https://playlists-2.forhonor.ubisoft.com/3802.0.0-prod-tym-w3-v1.json)

`playlist-diff.json` records source hashes and the extracted ranked definitions.
The embedded save dates are September 1 and June 9 respectively; these are
asset metadata, not deployment timestamps. The earlier bundle is the baseline
named in this repository's September 3 investigation, not a guaranteed snapshot
of the last minute before today's deployment.

| Definition | Playlist ID | Skill family | Recipe ID | New relative to baseline |
| --- | ---: | ---: | ---: | --- |
| 1v1 Duel (Ranked) | 22 | 1 | 3842653686 | No |
| 4v4 Dominion (Ranked) | 135 | 2 | 15372836303 | Yes |
| 1v1 Duel (Ranked V2) | 136 | 1 | 15372836260 | Yes |

Dominion's definition specifies reputation 5, a maximum group of 2, single
pick, and division spread 10. Duel V2 specifies reputation 5. These IDs are
**playlist configuration identifiers, not demonstrated API query parameters**.
The continued presence of ID 22 does not prove the old queue remains available.
Neither downloaded bundle contains HTTP(S) URLs, so neither supplies a rank
resource path or response contract.

## Direct live probes

`public-probe.json` contains 12 anonymous GET requests begun at
2026-09-10T15:07:19Z. The request App ID is the tracker default. Two catalogue
reads succeeded and ten candidate route reads returned 404:

| Route | Result | What this establishes |
| --- | --- | --- |
| `/v1/spaces/{space}/parameters` | 200 in PC and crossplay | Live configuration is readable anonymously |
| Crossplay `.../heroranking/public/v1/` and `/v2/` | 404 | Advertised service bases are not readable resources by themselves |
| Crossplay `.../heroleaderboard/public/v1/` | 404 | Same limitation |
| Crossplay `.../skillrating/public/v1/` | 404 | Same limitation |
| `/v1/spaces/{space}/leaderboards` | 404, code 1003 | List route unavailable in tested request context |
| `/v1/profiles/ranks?spaceId=...` | 404, code 1003 | Tested generic route does not resolve |
| `/v1/profiles/me/ranks?spaceId=...` | 404, code 1003 | Tested generic route does not resolve |

Title URLs come verbatim from `fh-configuration`. Generic SDK templates use
`{baseurl_aws}` and `{version}`; the script explicitly tests the tracker's
`public-ubiservices.ubi.com` host and v1. These substitutions are test assumptions,
not proof of every SDK deployment's host/version. The allowlist skips legacy PC
title URLs on `live.forhonor.ubisoft.com`; they are not silently rewritten.

The catalogue advertises `hn_ranking_public_v2`. Without an exact earlier
catalogue snapshot, this investigation cannot date its introduction to today.
A 404 at a base URL does not prove the service is dead, rank data is absent,
or that authentication would grant access. A 200 catalogue does not establish
player-data access either.

## Existing authenticated research reviewed

Another investigation was already active on `probe-ranked`; it was left intact.
Its completed [run 34493284710](https://github.com/SixSleet/For-Honor-Tracker/actions/runs/34493284710)
reports stat-card controls returning 44/46 entries, but **zero stats keys** for
the queried account. Therefore it is not evidence that active ranked players
have no new stats. Its named leaderboard reads, including legacy
`RankingPointsPerGameModeSeasonal.gameMode.R_DL2`, returned 404.

That differs from the older 200/empty result recorded in commit `6a64628`,
but the account and request contexts are not a controlled before/after pair.
Do not conclude that the season definitively removed the service.

The subsequent [run 34493558997](https://github.com/SixSleet/For-Honor-Tracker/actions/runs/34493558997),
commit `ccaa9e559c04c49f6fa3ab40b827f5694df8b05b`, completed at 15:08 UTC.
It tested authenticated title roots and the guessed suffixes `profiles/{id}`,
`players/{id}`, and `leaderboards`, including ranking v2. Those tests also
returned 404. These are existing workflow results reviewed here, not fresh
authenticated requests made by our script. No session was available locally.

## Reproduce

Requires Node 22+ with built-in fetch; no new dependencies.

```sh
# Offline help: sends nothing
node scripts/probe-ranked.mjs

# Bounded live catalogue/route check, anonymous by default
node scripts/probe-ranked.mjs --live

# Compare downloaded PUBLIC playlist JSON files, entirely offline
node scripts/compare-ranked-playlists.mjs OLD.json NEW.json

npm test
```

Optional `UBISOFT_TICKET` and `UBISOFT_SESSION_ID` are read from the environment;
never pass credentials as command arguments or commit them. The probe has a
fixed host/path allowlist, GET only, no redirects, no login or renewal, a
16-request ceiling, 1-second spacing, 15-second timeouts, a 512 KB response cap,
and stops on 401/403/429, bot challenges or network errors. Output contains
allowlisted URLs, status codes and selected counts, never raw player responses.
There is no automatic workflow or externally callable probe route.

Validation: 8 new safety tests and all 81 existing tests passed. No app build
was needed because runtime application code is unchanged.

## Remaining evidence needed

A successful current-season rank read needs the exact resource path, HTTP
method, mode/season parameters, supported authentication, and a response
verified against the in-game rank of a known ranked player. The two new
playlist definitions narrow the investigation but do not supply that contract.
No MMR-to-rank conversion or inferred rank has been added to the tracker.
