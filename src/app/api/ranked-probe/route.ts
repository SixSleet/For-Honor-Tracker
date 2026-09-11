/**
 * Season 0 re-check, 2026-09-11 — one day after Ranked launched.
 *
 * Not for main. Runs on this branch's Vercel PREVIEW deployment via the
 * workflow beside it, because this container cannot reach ubi.com.
 *
 * Yesterday's pass is written up in RANKED-PROBE-FINDINGS.md. This is not
 * another dump of the same thing: it carries yesterday's measurements as a
 * baseline and reports only what MOVED. A day is exactly the window in which
 * Ubisoft would populate Season 0 boards or flip a switch, and a diff makes
 * that visible where a second 200-name dump would not.
 *
 * Baselines below were measured yesterday, both spaces identical:
 *   us-sdkClientUrls.fields    200 templates
 *   fh-customFeatureSwitches    28 switches
 *   fh-configuration            73 fields
 *
 * Output is schema only — names, counts, statuses. The log is public, so no
 * stat values and no ids.
 */
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

const BASE_URLS = new Set(`achievementsDefinitions achievementsPlayer allConnections allProfilesApplications allProfilesEntities allProfilesStats allSpacesEntities allSpacesItems allSpacesOffers allgroupTypes applications applicationsMetadata applicationsParameters avatars blocklist blocklistBlockedBy blocklistUnblock calendar calendarLists challenge challengeManualBanking challengeProgression cloudSavesProfilesCloudSaveFiles communityChallengesProfilesParticipations communityChallengesSpaces communityChallengesSpacesProgressions configsEvents connections events eventsDefinitions friends friendsConfigs gamesPlayed gamesPlayedProfiles groupType groups groupsGroupsInvitations groupsInvitationsConfig groupsInvitationsGroupTypeConfig groupsInvitationsInvites groupsInvitationsJoinRequests groupsInvitationsLockState groupsInvitationsProfiles groupsInvitationsUpdateInvite groupsInvitationsUpdateJoinRequest groupsMatchmaking groupsMatchmakingMatches groupsMembers groupsRetentionExpiry groupsRichPresences groupsUgcGenericContents groupsUgcGenericContentsOwn localization localizationAll matchmakingGroupsMatchesPrecise matchmakingProfilesGlobalHarboursocial matchmakingSpaceGlobalHarboursocial moderation moderationPOST news oauthProfilesIdToken partyXboxSync personaProfile personaSpace playerActivityContextsProfiles playerActivityProfiles playerConsents playerConsentsCategory playerConsentsNextAcceptances playerConsentsNextConfig playerConsentsNextProfile playerPrivilegesProfile playerReportsProfile playerReportsSpaceCategories policies profiles profilesActions profilesApplications profilesBattlepassesSeasons profilesBattlepassesSeasonsTiers profilesChallenges profilesEntities profilesExternal profilesFriends profilesGroups profilesInventory profilesInventoryExpiredDetails profilesInventoryInstances profilesInventoryInstancesTransactions profilesInventoryPrimarystore profilesInventoryReserves profilesInventoryTransactions profilesLeaderboard profilesMatches profilesMatchmakingMatches profilesMatchmakingOnlineAccess profilesMeBattlepassesSeasons profilesMeBattlepassesSeasonsSeasonId profilesMeCommunityChallenges profilesMeEvents profilesMeInventoryPrimarystore profilesMeLeaderboard profilesMeRoamingProfiles profilesNotifications profilesNotificationsBatch profilesOffersDiscounts profilesOffersDiscountsMatches profilesOffersDiscountsResolutions profilesParties profilesPlayerPreferences profilesPlayerPreferencesStandard profilesPreciseMatchmakingClient profilesPreciseMatchmakingMatch profilesProfileChallenges profilesProgressionGraph profilesReputation profilesRewards profilesRichPresences profilesSeasonChallenges profilesStats profilesStatsCard profilesToken profilesUgcExternalVideos profilesUgcFavorites profilesUgcGenericContents profilesUgcGenericContentsOwn profilesUgcPhotos profilesUgcPhotosOwn profilesUgcRatings profilesUgcReportContent profilesUgcRequestReportedContent profilesUgcUpdateFavorite profilesUgcUpdateRating profilesUgcViews recommendations remoteLogs sanctionsAppliedSanctions sandboxes secondaryStoreInventoryRulesExecution sessions spacesActions spacesBattlepasses spacesBattlepassesSeasons spacesBattlepassesSeasonsSeasonId spacesChallengepools spacesChallenges spacesCommunityChallenges spacesConfigsPrimarystore spacesConfigsSsiAttributes spacesConfigsSsiListsOfAttributes spacesConfigsSsiRules spacesConfigsUgc spacesEntities spacesGroupsInvitations spacesItems spacesLeaderboard spacesMatches spacesNews spacesOffers spacesParameters spacesParties spacesPartiesPartyIdMembersProfileId spacesPlayerActivity spacesPlayerPreferences spacesPlayerPreferencesStandard spacesRewards spacesRichPresences spacesSeasonChallenges spacesStats spacesStatsCard tLog telemetry tokenProfile tokenSpace trackingSession tradesItemsGifts tradesItemsGiftsConfig tradesOfferGifts tradesOfferGiftsConfig tradesOfferGiftsSimulation tradesProfilesMarketableItems tradesSpaceMarketableItems ubiConnectApplicableTimeLimitedChallengesProfiles ubiConnectCommunityChallengesProfile ubiConnectCommunityChallengesSpace ubiConnectRewardsProfile ubiConnectRewardsSpace ubiConnectTimeLimitedChallengesProfile ubiConnectTimeLimitedChallengesSpace users usersMeOnlineStatuses usersMeOnlineStatusesManualStatus usersOnlineStatuses usersPolicies voicechatConfigPlayfab voicechatConfigVivox voicechatNetworkPlayfab voicechatTokenVivox websocketNotifications websocketServer`.split(' '));
const BASE_SWITCHES = new Set(`Game Cloud Bazaar Balmung Mercury Metagame RDV_Event RDV_Login RDV_Health Tournament ActivityAfk Arbitration Matchmaking SkillRating MatureFilter PlayerProfile RDV_Challenge US_EventsFlush PlayerReporting Storm_Onion_Auth ActivityAfkSilent ExclusiveFullscreen FileCacheMemProtect ForceCompatFallback StormDedicatedRouter PersistentPlayerGroup SeamlessPlaylistUpdates MatchmakingBlacklistPlayers`.split(' '));
const BASE_CONFIG_FIELDS = 73;

/** Leaderboard names that 404'd yesterday. Season 0 may have created them. */
const LEADERBOARDS = [
  'RankingPointsPerGameModeSeasonal.gameMode.R_DL2',
  'RankingPointsPerGameModeSeasonal.gameMode.R_DM2',
  'RankingPointsPerGameModeSeasonal.gameMode.R_DOM',
  'RankingPointsPerGameModeSeasonal',
  'SeasonalLeaderboard',
];

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

  const report: Record<string, unknown> = {};

  for (const spaceId of FOR_HONOR_SPACE_IDS) {
    const short = spaceId.slice(0, 8);
    const space: Record<string, unknown> = {};

    const response = await fetch(`${UBI_SERVICES}/v1/spaces/${spaceId}/parameters`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      const body = (await response.json()) as Record<string, unknown>;
      const inner = ((body['parameters'] ?? body) as Record<string, unknown>) ?? {};
      const group = (name: string) =>
        ((inner[name] as Record<string, unknown>)?.['fields'] ?? {}) as Record<string, unknown>;

      const urlNames = Object.keys(group('us-sdkClientUrls'));
      const switchNames = Object.keys(group('fh-customFeatureSwitches'));
      const configFields = Object.keys(group('fh-configuration'));

      space['urlTemplates'] = {
        count: urlNames.length,
        added: urlNames.filter((n) => !BASE_URLS.has(n)),
        removed: [...BASE_URLS].filter((n) => !urlNames.includes(n)),
      };
      space['featureSwitches'] = {
        count: switchNames.length,
        added: switchNames.filter((n) => !BASE_SWITCHES.has(n)),
        removed: [...BASE_SWITCHES].filter((n) => !switchNames.includes(n)),
        // Values matter as much as names here: a switch flipping on is the
        // change a new mode would show up as.
        values: Object.fromEntries(
          Object.entries(group('fh-customFeatureSwitches')).filter(([k]) =>
            /rank|season|tournament|skill|compet|ladder|elo/i.test(k),
          ),
        ),
      };
      space['configFields'] = { count: configFields.length, baseline: BASE_CONFIG_FIELDS };
      // Any title service whose name is ranked-ish, with its URL.
      space['rankedServices'] = Object.fromEntries(
        Object.entries(group('fh-configuration')).filter(([k]) =>
          /rank|season|leaderboard|skill|compet/i.test(k),
        ),
      );
    } else {
      space['parameters'] = `HTTP ${response.status}`;
    }

    // The two endpoints that were live yesterday, and the boards that were not.
    const checks: Record<string, string> = {};
    const ask = async (name: string, url: string) => {
      try {
        const r = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
        const t = await r.text();
        let keys = '';
        try {
          keys = Object.keys(JSON.parse(t) as object).join(',');
        } catch {
          keys = '(non-JSON)';
        }
        checks[name] = `${r.status} keys:${keys}`;
      } catch (error) {
        checks[name] = `ERROR ${String(error).slice(0, 60)}`;
      }
    };

    await ask('communitystats v1', `${UBI_SERVICES}/v1/spaces/${spaceId}/communitystats`);
    await ask('battlepasses/seasons v2', `${UBI_SERVICES}/v2/spaces/${spaceId}/battlepasses/seasons`);
    await ask('profiles/me/ranks v1', `${UBI_SERVICES}/v1/profiles/me/ranks`);
    await ask('profiles/{id}/reputation v1', `${UBI_SERVICES}/v1/profiles/${profileId}/reputation`);
    for (const name of LEADERBOARDS) {
      await ask(
        `leaderboard ${name}`,
        `${UBI_SERVICES}/v1/spaces/${spaceId}/leaderboards/${encodeURIComponent(name)}?profileId=${profileId}`,
      );
    }
    space['checks'] = checks;
    report[short] = space;
  }

  return NextResponse.json(
    { ok: true, at: new Date().toISOString(), commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null, report },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
