# For Honor Tracker

An unofficial For Honor player-stat tracker built from Ubisoft UbiServices and public Steam data.

The project only displays data returned by the upstream services. Missing values are left unavailable rather than guessed or reconstructed.

## APIs used

### Ubisoft UbiServices

Base URL:

```text
https://public-ubiservices.ubi.com
```

The tracker uses Ubisoft's authenticated UbiServices endpoints for the main For Honor profile data.

| Purpose | Endpoint |
| --- | --- |
| Find a player by platform name | `GET /v2/profiles?platformType={platform}&nameOnPlatform={name}` |
| Find the For Honor spaces/applications owned by a profile | `GET /v1/profiles/gamesplayed?profileIds={profileId}` |
| Read For Honor statistics | `GET /v1/profiles/stats?spaceId={spaceId}&profileIds={profileId}` |
| Read Ubisoft's stat-card labels and timestamps | `GET /v1/profiles/{profileId}/statscard?spaceId={spaceId}` |
| Read linked platform profiles | `GET /v2/profiles?userId={userId}` |
| Read application/session information | `GET /v2/profiles/{profileId}/applications?applicationIds={ids}` |
| Create or renew a Ubisoft session | `POST /v3/profiles/sessions` |

Typical authenticated requests use headers such as:

```http
Authorization: Ubi_v1 t=<session-ticket>
Ubi-AppId: <app-id>
Ubi-SessionId: <session-id>
Ubi-LocaleCode: en-US
Content-Type: application/json
```

Ubisoft player endpoints are not anonymous. Anyone using these endpoints must authenticate with their own valid Ubisoft session and is responsible for complying with Ubisoft's terms and rate limits.

The profile lookup checks these Ubisoft platform types:

```text
uplay
steam
psn
xbl
```

For Honor can have more than one Ubisoft stats space for the same account. The tracker reads the relevant spaces and uses the freshest available stats snapshot rather than assuming the first returned space is current.

### Steam

For Honor's Steam App ID is:

```text
304390
```

Steam is used for public profile and achievement data.

| Purpose | Endpoint |
| --- | --- |
| Resolve/read a public Steam profile | `https://steamcommunity.com/id/{vanity}/?xml=1` or `https://steamcommunity.com/profiles/{steamId64}/?xml=1` |
| Read public For Honor achievements | `https://steamcommunity.com/profiles/{steamId64}/stats/304390/?xml=1` |
| Read global achievement percentages | `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=304390` |
| Read owned games/playtime | `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/` |

The public community XML and global achievement-percentage endpoints do not require a Steam API key. `GetOwnedGames` requires a Steam Web API key and only works when the player's privacy settings permit the data to be read.

## Using the tracker API

The application exposes the normalized player report as JSON:

```http
GET /api/player?username=<username>
```

Example:

```bash
curl "https://your-deployment.example/api/player?username=ExampleUser"
```

The response is a normalized report assembled from the available providers, so consumers do not need to understand Ubisoft's raw stat-key format.

The report can contain:

- overall For Honor statistics;
- reputation, level, time played and matches;
- Duel and Dominion statistics where Ubisoft returns them;
- per-hero reputation, level and playtime;
- first/last-played timestamps from Ubisoft's stat card;
- linked platforms;
- Steam achievements when a readable Steam profile is available.

## Keeping the Ubisoft session alive

Ubisoft issues the session ticket the whole site runs on, and it lasts about
two hours. Something has to renew it more often than that, or the session
lapses, every lookup falls back to Steam-only data, and it takes a manual
re-seed to recover.

`GET /api/ubisoft-refresh` does the renewal. It returns 200 when the session is
healthy and 503 when it needs re-seeding, so a scheduler that watches HTTP
status doubles as the alarm.

Two things drive it:

1. **`.github/workflows/keep-session-alive.yml`**, every 30 minutes. This is
   the one that keeps the site up, and it needs no configuration at all — no
   secret is stored in the repository and none has to be. The job asks GitHub
   for a short-lived OIDC token describing the run, and the route verifies it
   against GitHub's published signing keys and checks that the run belongs to
   this repository (`src/server/github-oidc.ts`). Nothing to paste, nothing to
   rotate, nothing to get wrong. Note that GitHub disables scheduled workflows
   in a public repo after 60 days with no repository activity, and emails the
   owner when it does.
2. **Vercel Cron** (`vercel.json`), daily, authorized by `CRON_SECRET` if that
   variable is set. Far too infrequent to keep the session alive on its own —
   the Hobby plan will not accept a shorter schedule — but it is a floor.

The route also accepts `?token=<CRON_SECRET>` for an external pinger, and
`?token=<DIAGNOSTICS_TOKEN>` for a one-off manual run. Prefer `CRON_SECRET` for
anything long-lived: a URL handed to a third-party scheduler lives in that
service's settings and its request logs, and `CRON_SECRET` authorizes nothing
but this idempotent refresh, while `DIAGNOSTICS_TOKEN` can also seed or clear
the shared session.

Every one of those is optional. With none of them configured the route refuses
everything except the GitHub workflow, which is the right default: each call
spends a real request against Ubisoft on the operator's own account, so an
endpoint anyone could drive would be worse than one that occasionally does not
run.

## Known limitations

The tracker does not invent data that the upstream APIs do not provide.

Currently unavailable as reliable public player data:

- full match history;
- Ranked Duel rank;
- general player rankings/leaderboards;
- per-hero wins, losses or K/D when Ubisoft does not return those values.

If an upstream field or endpoint is missing, stale, private or inaccessible, the API reports it as unavailable instead of estimating it.

## Disclaimer

This project is unofficial and is not affiliated with or endorsed by Ubisoft or Valve. Ubisoft and For Honor are trademarks of their respective owners.
