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

`GET /api/ubisoft-refresh` does the renewal. It takes `CRON_SECRET` either as
`Authorization: Bearer <secret>` or as `?token=<secret>`, and returns 200 when
the session is healthy and 503 when it needs re-seeding, so any scheduler that
watches HTTP status doubles as the alarm.

Three layers drive it, in order of how much they can be relied on:

1. **An external pinger** every 30-60 minutes — a free cron-job.org or
   UptimeRobot monitor pointed at
   `https://<domain>/api/ubisoft-refresh?token=<CRON_SECRET>`. No dormancy
   rules, and it emails on failure. This is the one that keeps the site up.
2. **`.github/workflows/keep-session-alive.yml`**, every 30 minutes, needing
   only a `CRON_SECRET` repository secret. Note that GitHub disables scheduled
   workflows in a public repo after 60 days without repository activity.
3. **Vercel Cron** (`vercel.json`), daily. Too infrequent to keep the session
   alive on its own — the Hobby plan will not accept a shorter schedule — but
   it is a floor, and it is what catches a session that everything else missed.

Use `CRON_SECRET` for the scheduled callers and never `DIAGNOSTICS_TOKEN`. A
URL handed to a third-party service lives in that service's settings and its
request logs; `CRON_SECRET` can trigger nothing but this idempotent refresh,
while `DIAGNOSTICS_TOKEN` can also seed or clear the shared session.

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
