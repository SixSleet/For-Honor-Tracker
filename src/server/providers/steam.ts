import 'server-only';
import type {
  Achievement,
  StatGroup,
  PlayerReport,
  ProviderInfo,
  Stat,
} from '@/shared/types';
import { env } from '../env';
import { parseJson, tracedFetch, type TraceCollector } from '../http';
import { attr, numberOrNull, tagBlocks, tagText } from './steam-xml';
import { normalizeQuery, profileXmlUrl } from './steam-query';
import {
  countConfirmed,
  deriveCombat,
  deriveFactionWar,
  deriveGameModes,
  deriveReputation,
  deriveStory,
  unlockedSet,
} from './forhonor-progression';
import { ProviderError, type DataProvider } from './types';

/** For Honor's Steam application id. */
const FOR_HONOR_APPID = 304390;

const COMMUNITY = 'https://steamcommunity.com';
const WEB_API = 'https://api.steampowered.com';

const info: ProviderInfo = {
  id: 'steam',
  label: 'Steam (public profile)',
  description:
    "Steam's public community endpoints. Returns real For Honor playtime and achievement progress for players whose Steam profile and game details are public.",
  docsUrl: 'https://developer.valvesoftware.com/wiki/Steam_Web_API',
};

async function fetchGlobalAchievementPercents(
  trace: TraceCollector,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  try {
    const response = await tracedFetch(
      {
        provider: info.id,
        label: 'Global achievement rarity (keyless)',
        url: `${WEB_API}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${FOR_HONOR_APPID}`,
      },
      trace,
    );
    const parsed = parseJson<{
      achievementpercentages?: { achievements?: Array<{ name: string; percent: string }> };
    }>(response.text);
    for (const entry of parsed?.achievementpercentages?.achievements ?? []) {
      const percent = Number(entry.percent);
      // The Web API reports "ForHonor_Ach_13" while the community XML reports
      // "forhonor_ach_13" for the same achievement, so key on lower case.
      if (Number.isFinite(percent)) result.set(entry.name.toLowerCase(), percent);
    }
  } catch {
    // Rarity is a nice-to-have. A failure here must not fail the whole report.
  }
  return result;
}

/**
 * Playtime and ownership from the Steam Web API.
 *
 * Steam's keyless games list now redirects to a login page, so this is the
 * only remaining source for playtime — and it needs a (free) API key. Returns
 * null when no key is configured, which the caller reports honestly rather
 * than presenting as "does not own the game".
 */
async function fetchOwnedGame(
  steamId: string,
  trace: TraceCollector,
): Promise<{ owns: boolean; playtimeMinutes: number | null } | null> {
  if (!env.steamApiKey) return null;
  try {
    const url = new URL(`${WEB_API}/IPlayerService/GetOwnedGames/v1/`);
    url.searchParams.set('key', env.steamApiKey);
    url.searchParams.set('steamid', steamId);
    url.searchParams.set('include_appinfo', '0');
    url.searchParams.set('appids_filter[0]', String(FOR_HONOR_APPID));

    const response = await tracedFetch(
      { provider: info.id, label: 'Owned games and playtime (Web API)', url: url.toString() },
      trace,
    );
    if (!response.ok) return null;

    const game = parseJson<{
      response?: { games?: Array<{ appid: number; playtime_forever?: number }> };
    }>(response.text)?.response?.games?.find((entry) => entry.appid === FOR_HONOR_APPID);

    return game ? { owns: true, playtimeMinutes: game.playtime_forever ?? null } : null;
  } catch {
    // Playtime is supplementary; never fail the whole report over it.
    return null;
  }
}

/**
 * Steam stats the game itself registers, read from the same community XML as
 * the achievements. For Honor publishes very little here, so the values are
 * surfaced under their own names rather than being mapped onto tracker
 * concepts they may not mean.
 */
function readGameStats(xml: string): Stat[] {
  const statsBlock = tagBlocks(xml, 'stats')[0];
  if (!statsBlock) return [];
  const stats: Stat[] = [];
  const pattern = /<(\w+)>([^<]*)<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(statsBlock.inner)) !== null) {
    const value = numberOrNull(match[2]);
    if (value === null || value === 0) continue;
    stats.push({
      key: `game-stat-${match[1]}`,
      label: match[1].replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()),
      value,
      kind: 'number',
      note: 'Reported by the game to Steam',
    });
  }
  return stats;
}

interface ProfileXml {
  steamId64: string;
  displayName: string;
  avatarUrl?: string;
  countryCode?: string;
  privacyState?: string;
}

function readProfileXml(xml: string): ProfileXml | null {
  const steamId64 = tagText(xml, 'steamID64');
  if (!steamId64) return null;
  return {
    steamId64,
    displayName: tagText(xml, 'steamID') ?? steamId64,
    avatarUrl: tagText(xml, 'avatarFull') ?? tagText(xml, 'avatarMedium') ?? undefined,
    countryCode: tagText(xml, 'location') || undefined,
    privacyState: tagText(xml, 'privacyState') ?? undefined,
  };
}

/**
 * For Honor's Steam achievements for one SteamID64, read from the public
 * community XML — no API key, and nothing that is not already public on the
 * player's own profile page.
 *
 * Exported because a player found through Ubisoft is very often the same
 * person as a Steam account: Ubisoft's own profile service says which Steam
 * account an Ubisoft account is linked to, and that is the only way this
 * tracker can show achievements for a player searched by their Ubisoft name.
 */
export async function fetchForHonorAchievements(
  steamId64: string,
  trace: TraceCollector,
): Promise<{
  items: Achievement[];
  unlockedCount: number;
  totalCount: number;
  readable: boolean;
  privacyState: string | null;
}> {
  const empty = {
    items: [] as Achievement[],
    unlockedCount: 0,
    totalCount: 0,
    readable: false,
    privacyState: null as string | null,
  };
  if (!/^\d{17}$/.test(steamId64)) return empty;

  const [response, globalPercents] = await Promise.all([
    tracedFetch(
      {
        provider: info.id,
        label: 'For Honor achievements (community XML)',
        url: profileXmlUrl({ kind: 'id', value: steamId64 }, `/stats/${FOR_HONOR_APPID}`),
      },
      trace,
    ),
    fetchGlobalAchievementPercents(trace),
  ]);
  if (!response.ok) return empty;

  const privacyState = tagText(response.text, 'privacyState');
  const items: Achievement[] = [];
  for (const block of tagBlocks(response.text, 'achievement')) {
    const apiName = tagText(block.inner, 'apiname');
    if (!apiName) continue;
    const unlocked = attr(block.attrs, 'closed') === '1';
    const unlockTimestamp = numberOrNull(tagText(block.inner, 'unlockTimestamp'));
    items.push({
      apiName,
      name: tagText(block.inner, 'name') ?? apiName,
      description: tagText(block.inner, 'description') ?? undefined,
      unlocked,
      unlockedAt: unlockTimestamp ? unlockTimestamp * 1000 : undefined,
      iconUrl: tagText(block.inner, unlocked ? 'iconClosed' : 'iconOpen') ?? undefined,
      globalPercent: globalPercents.get(apiName.toLowerCase()),
    });
  }

  return {
    items,
    unlockedCount: items.filter((item) => item.unlocked).length,
    totalCount: items.length,
    readable: items.length > 0,
    privacyState,
  };
}

export const steamProvider: DataProvider = {
  info,

  isEnabled() {
    // Works with no API key at all — the community XML endpoints are public.
    return true;
  },

  disabledReason() {
    return null;
  },

  canHandle(query) {
    return normalizeQuery(query) !== null;
  },

  async getPlayerByUsername(username, trace) {
    const target = normalizeQuery(username);
    if (!target) {
      throw new ProviderError(
        'INVALID_USERNAME',
        'That does not look like a Steam profile name, SteamID64, or profile URL.',
      );
    }

    const response = await tracedFetch(
      { provider: info.id, label: 'Resolve profile (community XML)', url: profileXmlUrl(target) },
      trace,
    );

    if (response.status === 429) {
      throw new ProviderError(
        'PROVIDER_UNAVAILABLE',
        'Steam is rate-limiting this tracker right now. Please try again in a minute.',
      );
    }
    if (!response.ok) {
      throw new ProviderError(
        'PROVIDER_UNAVAILABLE',
        'Steam did not respond correctly. Please try again shortly.',
      );
    }

    const profile = readProfileXml(response.text);
    if (!profile) return null;

    return {
      id: profile.steamId64,
      displayName: profile.displayName,
      platform: 'steam',
      avatarUrl: profile.avatarUrl,
      countryCode: profile.countryCode,
      profileUrl: `${COMMUNITY}/profiles/${profile.steamId64}`,
    };
  },

  async getPlayerReport(identity, trace): Promise<PlayerReport> {
    const notices: string[] = [];
    const target = { kind: 'id' as const, value: identity.id };

    const [statsResponse, globalPercents, ownedGame] = await Promise.all([
      tracedFetch(
        {
          provider: info.id,
          label: 'For Honor achievements (community XML)',
          url: profileXmlUrl(target, `/stats/${FOR_HONOR_APPID}`),
        },
        trace,
      ),
      fetchGlobalAchievementPercents(trace),
      fetchOwnedGame(identity.id, trace),
    ]);

    // --- Achievements -------------------------------------------------------
    const achievements: Achievement[] = [];
    let achievementsReadable = false;
    let privacyState: string | null = null;
    let ownsForHonor = false;
    let gameReportedStats: Stat[] = [];

    if (statsResponse.ok) {
      privacyState = tagText(statsResponse.text, 'privacyState');

      // A <game> block is only present when Steam is willing to describe this
      // player's copy of the game, which makes it the authoritative public
      // signal for ownership.
      ownsForHonor = /for\s*honor/i.test(tagText(statsResponse.text, 'gameName') ?? '');

      for (const block of tagBlocks(statsResponse.text, 'achievement')) {
        const apiName = tagText(block.inner, 'apiname');
        if (!apiName) continue;
        const unlocked = attr(block.attrs, 'closed') === '1';
        const unlockTimestamp = numberOrNull(tagText(block.inner, 'unlockTimestamp'));
        achievements.push({
          apiName,
          name: tagText(block.inner, 'name') ?? apiName,
          description: tagText(block.inner, 'description') ?? undefined,
          unlocked,
          unlockedAt: unlockTimestamp ? unlockTimestamp * 1000 : undefined,
          iconUrl: tagText(block.inner, unlocked ? 'iconClosed' : 'iconOpen') ?? undefined,
          globalPercent: globalPercents.get(apiName.toLowerCase()),
        });
      }
      achievementsReadable = achievements.length > 0;

      // For Honor also registers Steam stats. Whatever it reports is surfaced
      // verbatim rather than being reinterpreted.
      gameReportedStats = readGameStats(statsResponse.text);
    }

    if (!achievementsReadable) {
      notices.push(
        privacyState && privacyState !== 'public'
          ? `Steam reports this profile's game details as "${privacyState}", so For Honor achievements are hidden. Only the player can change that, in Steam: Profile → Edit Profile → Privacy Settings → Game details → Public.`
          : 'For Honor achievements could not be read for this profile. Either the player does not own the game on Steam, or their game details are not public.',
      );
    }

    // --- Playtime -----------------------------------------------------------
    // Steam's public games list (/games/?tab=all&xml=1) now 302-redirects to a
    // login page even for public profiles, so playtime has no keyless source.
    // With a Steam Web API key it is available from IPlayerService.
    const playtimeHours =
      ownedGame?.playtimeMinutes != null
        ? Math.round((ownedGame.playtimeMinutes / 60) * 10) / 10
        : null;

    if (playtimeHours === null && achievementsReadable) {
      notices.push(
        env.steamApiKey
          ? 'Steam did not report For Honor playtime for this profile. Playtime requires the player to make their game details public.'
          : "Playtime is unavailable: Steam's public games list now requires a login. Set STEAM_API_KEY on the server to enable it.",
      );
    }

    if (ownedGame?.owns) ownsForHonor = true;

    // --- Overview -----------------------------------------------------------
    const overviewStats: Stat[] = [
      { key: 'platform', label: 'Platform', value: 'Steam (PC)', kind: 'text' },
      {
        key: 'playtime',
        label: 'For Honor playtime',
        value: playtimeHours,
        kind: 'number',
        note: playtimeHours === null ? 'Needs a Steam API key and public game details' : 'Hours',
      },
      {
        key: 'owns',
        label: 'Owns For Honor',
        value: ownsForHonor ? 'Yes' : null,
        kind: 'text',
        note: ownsForHonor ? undefined : 'Steam did not confirm ownership publicly',
      },
      {
        key: 'country',
        label: 'Country',
        value: identity.countryCode ?? null,
        kind: 'text',
        note: identity.countryCode ? undefined : 'Not shared on this profile',
      },
    ];

    // --- Overall ------------------------------------------------------------
    const unlockedCount = achievements.filter((achievement) => achievement.unlocked).length;
    const totalCount = achievements.length || globalPercents.size;
    const completion =
      achievementsReadable && totalCount > 0
        ? Math.round((unlockedCount / totalCount) * 1000) / 10
        : null;
    const rarest = achievements
      .filter((achievement) => achievement.unlocked && achievement.globalPercent != null)
      .sort((a, b) => (a.globalPercent ?? 100) - (b.globalPercent ?? 100))[0];

    const overallStats: Stat[] = [
      {
        key: 'achievements',
        label: 'Achievements unlocked',
        value: achievementsReadable ? unlockedCount : null,
        kind: 'number',
      },
      { key: 'achievement-total', label: 'Achievements available', value: totalCount || null, kind: 'number' },
      { key: 'completion', label: 'Completion', value: completion, kind: 'percent' },
      {
        key: 'rarest',
        label: 'Rarest unlocked',
        value: rarest ? `${rarest.name} (${rarest.globalPercent?.toFixed(1)}%)` : null,
        kind: 'text',
      },
      ...gameReportedStats,
    ];

    // --- Derived progression ------------------------------------------------
    // For Honor's achievements encode explicit numeric thresholds, so an
    // unlocked one proves a counter reached at least that value. These are
    // lower bounds, labelled as such — never estimates.
    const unlocked = unlockedSet(achievements);
    const derivedNote =
      'Confirmed minimums derived from unlocked achievements. Each figure is a value the player is proven to have reached — not an exact total. Ubisoft does not release the real counters.';

    const combat = deriveCombat(unlocked);
    const reputation = deriveReputation(unlocked);
    const story = deriveStory(unlocked);
    const factionWar = deriveFactionWar(unlocked);
    const modes = deriveGameModes(unlocked);
    const anyDerived =
      countConfirmed(combat) + countConfirmed(reputation) + countConfirmed(story) > 0;

    const extraGroups: StatGroup[] = achievementsReadable
      ? [
          {
            key: 'reputation',
            label: 'Reputation and heroes',
            availability: countConfirmed(reputation) ? 'confirmed' : 'unavailable',
            explanation: derivedNote,
            stats: reputation,
          },
          {
            key: 'combat',
            label: 'Combat',
            availability: countConfirmed(combat) ? 'confirmed' : 'unavailable',
            explanation: derivedNote,
            stats: combat,
          },
          {
            key: 'story',
            label: 'Story mode',
            availability: countConfirmed(story) ? 'confirmed' : 'unavailable',
            explanation: derivedNote,
            stats: story,
          },
          {
            key: 'faction-war',
            label: 'Faction War',
            availability: countConfirmed(factionWar) ? 'confirmed' : 'unavailable',
            explanation: derivedNote,
            stats: factionWar,
          },
        ]
      : [];

    const unavailableBecause =
      'Steam does not receive For Honor match, hero or reputation data. Ubisoft holds those and exposes no public access to them.';

    return {
      identity,
      provider: info,
      fetchedAt: Date.now(),
      cached: false,
      overview: {
        key: 'overview',
        label: 'Player overview',
        availability: 'confirmed',
        stats: overviewStats,
      },
      overall: {
        key: 'overall',
        label: 'Overall statistics',
        availability: achievementsReadable ? 'confirmed' : 'unavailable',
        explanation: achievementsReadable
          ? undefined
          : 'Achievement data is not readable for this profile.',
        stats: overallStats,
      },
      extraGroups,
      heroes: {
        availability: 'requires-auth',
        explanation:
          'Per-hero reputation, level and K/D are Ubisoft-side only. Reputation milestones proven by achievements appear under Reputation and heroes above.',
        items: [],
      },
      gameModes: {
        availability: achievementsReadable && anyDerived ? 'confirmed' : 'requires-auth',
        explanation: achievementsReadable
          ? `${derivedNote} Exact match counts, losses and K/D are Ubisoft-side only.`
          : unavailableBecause,
        items: achievementsReadable ? modes : [],
      },
      matches: { availability: 'requires-auth', explanation: unavailableBecause, items: [] },
      achievements: {
        availability: achievementsReadable ? 'confirmed' : 'unavailable',
        explanation: achievementsReadable
          ? undefined
          : 'This profile does not expose For Honor game details publicly.',
        items: achievements,
        unlockedCount,
        totalCount,
      },
      notices,
    };
  },
};

export const __testing = { readProfileXml, FOR_HONOR_APPID };
