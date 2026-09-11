# Season 0 ranked probe — findings

Research notes from 2026-09-10, the day Ranked Season 0 launched. **This file
and the probe beside it live on `probe-ranked` and are not for `main`.**

Everything below was measured against the live API from a GitHub Actions
runner calling this branch's Vercel preview deployment, which then called
Ubisoft with the shared session ticket. Nothing ran against production.

## The question

Did the Ranked rework (Ranked Dominion + reworked Ranked Duel, Season 0,
2026-09-10) expose any player data this project can read?

## Answer: no new ranked API. Two other live endpoints found.

### Live, returning data (new to this project)

Both space-scoped, so neither carries anything personal. Ordinary session
ticket, no game-client impersonation.

| Endpoint | Version | Body |
| --- | --- | --- |
| `/v2/spaces/{spaceId}/battlepasses/seasons` | **v2 only** | `{ seasons }` |
| `/v1/spaces/{spaceId}/communitystats` | **v1 only** | `{ stats }` |

Both answer 200 in both For Honor spaces. The version matters: the other two
versions 404 in each case, the same trap this project hit with
`applications` v2 -> v3.

`communitystats` is the more useful of the two — community-wide figures are
what a player's own numbers need to be read against, and the site has no such
baseline today. `battlepasses/seasons` would let the page name the current
season instead of inferring it.

### Not served for For Honor (gateway 404, errorCode 1003)

All six, in both spaces, at v1/v2/v3 — 36 calls, every one a plain "resource
not found" from the UbiServices gateway:

    profiles/me/ranks
    profiles/ranks
    profiles/{profileId}/reputation
    spaces/{spaceId}/leaderboards
    profiles/{profileId}/club/seasonchallenges
    spaces/{spaceId}/club/seasonchallenges

They appear in `us-sdkClientUrls` because that catalogue is shared across
Ubisoft titles. For Honor does not enable them.

### A regression worth recording

`RankingPointsPerGameModeSeasonal.gameMode.R_DL2` — the Ranked Duel
leaderboard definition, which earlier in this project answered **200 with
cardinality 0** — now answers **404, errorCode 1003**, in both spaces. The
rework removed the definition rather than populating it. Seven guessed
Ranked Dominion variants also 404, and there is no list endpoint
(`/v1/spaces/{id}/leaderboards` is itself a 404), so the names cannot be
enumerated.

## Corrections to this project's standing notes

1. **The title services do NOT require impersonating the game client.**
   The note in `ubisoft.ts` saying ranked data is served by endpoints needing
   "a game build id and sandbox headers" is wrong about reachability.
   `heroranking`, `heroleaderboard`, `skillrating` and `playerstats2` all
   answer an ordinary session ticket. What is missing is their routes, not
   authorization.

2. **Their 404 is an oracle, and it is not the gateway's.** Three distinct
   not-found shapes are in play:

   - UbiServices gateway: `{"errorCode":1003,"message":"Resource '<url>' not found."}`
   - Kong, in front of the title services: `{"message":"no Route matched with those values"}`
     — means that service root is not routed at all.
   - The title service itself: `{"resource":"<its own root>","errorCode":"UnspecifiedError","message":"<unrouted remainder>"}`
     — means the service was reached and the path was wrong.

3. **Guessing title-service routes does not work.** 594 candidate paths across
   18 service bases returned zero hits: 264 in the service's own shape, 330
   from Kong. Any further progress there needs the routes from somewhere else,
   not more guesses.

## Method notes, for whoever runs this next

Four things cost a run each and are worth not repeating:

- Vercel serves its "Deployment is building" page with **HTTP 200**, so
  waiting on a status code reads nothing.
- The branch alias serves the **previous ready deployment** while a new one
  builds, and that old build answers with valid JSON — so the probe must
  report which commit answered and the workflow must wait for its own.
- `/v1/profiles/stats` parses as `{ profiles: [{ profileId, stats }] }`, not
  `{ stats: [...] }`.
- `/v1/spaces/{id}/parameters` wraps everything twice: `{ parameters: { <group>:
  { fields, relatedPopulation } } }`. Reading a group without unwrapping
  `fields` reports "2 fields" for every group.

Also: the account whose ticket seeds the site does **not** own For Honor —
`gamesplayed` returns one unrelated space — so it has no per-player stats to
find. Testing anything player-scoped needs a profile id belonging to someone
who actually plays.

## Re-check, 2026-09-11 (one day after launch)

Run as a diff against the measurements above rather than a fresh dump.
**Nothing moved in 24 hours.**

| | PC space | Crossplay space |
| --- | --- | --- |
| URL templates | 200, **0 added, 0 removed** | 200, **0 added, 0 removed** |
| Feature switches | 28, **0 added, 0 removed** | 28, **0 added, 0 removed** |
| `Tournament` / `SkillRating` | `true` / `true` | `true` / `true` |
| `communitystats` v1 | 200 `{stats}` | 200 `{stats}` |
| `battlepasses/seasons` v2 | 200 `{seasons}` | 200 `{seasons}` |
| `profiles/me/ranks` | 404 | 404 |
| `profiles/{id}/reputation` | 404 | 404 |
| all five leaderboard names | 404 | 404 |

Season 0 being a day old changed none of it: no board was created, no switch
flipped, no endpoint appeared or disappeared.

### Correction: the two spaces do not share a host

Yesterday's notes described the title services as being on
`public-ubiservices.ubi.com`. That is true of the **crossplay** space only.
The **PC** space routes its public title services through a different host
entirely:

    PC         https://live.forhonor.ubisoft.com/v1/spaces/882ad5b5-.../title/hero/hero-pc-live/heroranking/public/v1/
    crossplay  https://public-ubiservices.ubi.com/v1/spaces/c2294cd6-.../title/hero/hero-live/heroranking/public/v1/

Both hosts were in fact covered by the 594-path enumeration — it read its
bases from each space's own configuration — so this changes the description,
not the result. Zero hits on either.

### The two spaces' configurations are different sizes

`fh-configuration` is **54 fields on PC** against **73 on crossplay**. The PC
space is the frozen one (last written 2025-09-09), so a smaller, older
configuration fits: among the fields it lacks is `hn_ranking_public_v2`,
which exists only on crossplay. Note the 73 baseline above was measured on
crossplay; there is no recorded PC figure from before, so this is a
difference between spaces, not a proven change over time.

## The playlist bundles — verified, and they have moved

The parallel branch `research/ranked-season-2026-09-10` found something this
investigation missed entirely: a **public playlist bundle** carrying the
Season 0 ranked definitions. `playlist_versions_url` and
`hn_default_playlist_bundle_name` were both in the configuration dumped above;
the fields were read and the URL was never followed.

Verified independently on 2026-09-11, fetched with **no Authorization header
at all**:

| | PC space | Crossplay space |
| --- | --- | --- |
| bundle the config names now | `3501.0.0-prod-turbo-breach-v2` | **`3901.0.0-prod-v3`** |
| `hn_next_playlist_bundle_name` | `3402.0.0-prod-v3` | (none) |
| anonymous fetch | **403** | **200**, 253,175 bytes |
| sha256 | — | `71006ea4f9b59931006e030d5c9612224f2ea527a423efd70ab069c6644901f7` |

Three results worth separating:

1. **The crossplay bundle is readable with no credentials whatsoever.** Not a
   ticket, not a session, not an App ID. That makes it categorically different
   from everything else in this investigation: usable without the shared
   session, and incapable of carrying anything personal.

2. **It has rolled since yesterday** — `3901.0.0-prod-v2` to
   `3901.0.0-prod-v3`. The other branch's snapshot is one bundle stale. This
   is the only thing found to have changed in the 24 hours since launch.

3. **The three ranked definitions survive into v3**: 22 "1v1 Duel (Ranked)"
   (divisionSpread 4), 135 "4v4 Dominion (Ranked)" (10), 136 "1v1 Duel
   (Ranked V2)" (4). Top-level keys are `capital`, `capital2`, `fronts`,
   `gameModeCategories`, `playlists`, `saveDate`.

One discrepancy, recorded rather than explained: the other branch's reading of
v2 carries `minimumReputation: 5` on both new playlists, and this reading of
v3 did not surface that field on the same objects. `divisionSpread` came
through, so the object shape is right. Whether v3 dropped the field or the two
extractions walked different structures is not established here, and
`minimumReputation` should not be quoted from v3 until it is.

The PC space points at a far older bundle and 403s anonymously, which fits it
being the frozen space.

**What this is and is not.** It is a real, zero-auth source of Season 0's
ranked playlist configuration. It is not a rank endpoint: neither bundle
contains an HTTP URL, so it supplies no resource path and no per-player data.
