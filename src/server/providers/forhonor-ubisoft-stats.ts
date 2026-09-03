// Pure mapping of Ubisoft's For Honor stat vocabulary into display types.
// No secrets and no I/O, so this stays importable from tests; the server-only
// guard lives on the modules that hold configuration and perform requests.
import type { GameModeStat, HeroStat, PlatformLink, Stat, StatGroup } from '@/shared/types';
import { heroIdentity } from '../../shared/hero-roster.ts';

/**
 * Maps Ubisoft's raw For Honor stat vocabulary into the tracker's display
 * types.
 *
 * The vocabulary was captured live from `/v1/profiles/stats` against For
 * Honor's space (codename "Hero", spaceId 882ad5b5-…): a flat dictionary of
 * `{ StatKey: { value, startDate, endDate, lastModified } }`. Two families:
 *
 *   - Global totals: GamesPlayedPVP, DeathTotal, Faction, CampaignProgression…
 *   - Per hero:      Hero<Codename>Level / Reputation / TimePlayed
 *
 * Nothing here is invented. Every value shown is a value Ubisoft returned;
 * unknown hero codenames are rendered from the codename itself rather than
 * guessed at, and stats the API does not return are simply absent.
 */

/**
 * One entry of Ubisoft's stat card — the panel the Ubisoft Connect overlay
 * shows for a game.
 *
 * It is the same underlying stats keyed by the same names, but Ubisoft
 * attaches its own player-facing label to each one, plus when the stat was
 * first written and when it last changed. That makes it three things this
 * tracker could not get anywhere else: the publisher's own hero names (so
 * codenames need no inference at all), when the player started, and when they
 * last played — overall and per hero.
 */
export interface StatCardEntry {
  statName?: string;
  displayName?: string;
  value?: string | number;
  /** When this stat first appeared for the player. */
  startDate?: string | null;
  /** When it last changed — i.e. when they last played this. */
  lastModified?: string | null;
  format?: string;
  unit?: string;
}

/** Facts read out of the stat card, keyed by hero codename. */
export interface HeroCardFact {
  /** Ubisoft's own name for the hero. */
  name: string;
  /** When the player last played this hero, epoch ms. */
  lastPlayedAt: number | null;
}

function epoch(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Strips the trailing stat word off a stat-card label, so "Warden Reputation"
 * and "Ocelotl’s Reputation" both yield the hero's name.
 */
function heroNameFromLabel(label: string): string | null {
  const trimmed = label.replace(/\s*Reputation\s*$/i, '').replace(/[’']s$/i, '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Reads the per-hero facts out of a stat card: Ubisoft's own name for each
 * hero codename, and when that hero was last played.
 */
export function heroFactsFromStatCard(cards: StatCardEntry[]): Map<string, HeroCardFact> {
  const facts = new Map<string, HeroCardFact>();
  for (const card of cards) {
    const match = /^Hero(.+)Reputation$/.exec(card.statName ?? '');
    if (!match || !card.displayName) continue;
    const name = heroNameFromLabel(card.displayName);
    if (!name) continue;
    facts.set(match[1], { name, lastPlayedAt: epoch(card.lastModified) });
  }
  return facts;
}

/**
 * When the player last played, from the latest change to any stat on the card.
 *
 * There is deliberately no "first played" counterpart. The card also carries a
 * `startDate` per stat, and it is tempting to read the earliest one as the day
 * the player started — but it is the date Ubisoft *defined the counter*, not
 * the date this account first played. It reads 2016-10-29 on every account,
 * which is before For Honor released in February 2017, so it cannot be anyone's
 * start date. Ubisoft exposes no per-account first-played timestamp, so the
 * report says nothing rather than repeating a constant as if it were personal.
 */
export function lastPlayedFromStatCard(cards: StatCardEntry[]): number | null {
  let last: number | null = null;
  for (const card of cards) {
    const modified = epoch(card.lastModified);
    if (modified !== null && (last === null || modified > last)) last = modified;
  }
  return last;
}

/** The raw stat entry shape Ubisoft returns. */
export interface RawStat {
  value?: string | number;
  startDate?: string | null;
  lastModified?: string | null;
}

export type RawStats = Record<string, RawStat>;

/**
 * TrueSkill's initial mean. Ubisoft seeds every skill rating at this value, so
 * it marks "never rated" rather than an actual rating of 25.
 */
const TRUESKILL_DEFAULT_MU = 25;

/** Known For Honor space ids (codename "Hero"), confirmed live. */
export const FOR_HONOR_SPACE_IDS = [
  '882ad5b5-f549-44a1-a434-c465d22fe4bf', // Hero PC
  'c2294cd6-bd01-4f19-81e9-4e5d32cb763a', // Hero CrossPlatform Live
];

/**
 * Game-mode codes Ubisoft stores in its per-mode counters, decoded.
 *
 * "DL" and "DMN" are confirmed live on a real account. A code that is not
 * listed here is left alone rather than guessed at, so it stays in the decoded
 * catch-all instead of being shown under an invented mode name.
 */
const GAME_MODES: Record<string, string> = {
  DL: 'Duel',
  DMN: 'Dominion',
};

/** Faction codes Ubisoft stores, decoded. Unknown codes pass through raw. */
const FACTIONS: Record<string, string> = {
  vk: 'Vikings',
  kt: 'Knights',
  sm: 'Samurai',
  kn: 'Knights',
  wl: 'Wu Lin',
};

/**
 * Hero codename → in-game name. Ubisoft stores internal codenames; these are
 * the confirmed mappings. A codename not listed here is de-camel-cased and
 * shown with its faction prefix stripped, so it stays readable and truthful
 * without a guess at the marketing name.
 */
const HERO_NAMES: Record<string, { name: string; faction: string }> = {
  KnightChampion: { name: 'Warden', faction: 'Knights' },
  KnightAssassin: { name: 'Peacekeeper', faction: 'Knights' },
  KnightHybrid: { name: 'Lawbringer', faction: 'Knights' },
  KnightTank: { name: 'Conqueror', faction: 'Knights' },
  KnightGladiator: { name: 'Gladiator', faction: 'Knights' },
  KnightCenturion: { name: 'Centurion', faction: 'Knights' },
  KnightVortiger: { name: 'Black Prior', faction: 'Knights' },
  KnightWarmonger: { name: 'Warmonger', faction: 'Knights' },
  SamuraiChampion: { name: 'Kensei', faction: 'Samurai' },
  SamuraiAssassin: { name: 'Orochi', faction: 'Samurai' },
  SamuraiHybrid: { name: 'Nobushi', faction: 'Samurai' },
  SamuraiTank: { name: 'Shugoki', faction: 'Samurai' },
  SamuraiSkirmisher: { name: 'Aramusha', faction: 'Samurai' },
  SamuraiKyoshin: { name: 'Kyoshin', faction: 'Samurai' },
  // "Benkei" names history's most famous Japanese warrior monk — "Sohei"
  // is literally the Japanese word for that class of warrior, so this is
  // the codename for Sohei, not a guess at Hitokiri (an earlier, unverified
  // assumption this replaces — see the Sakura correction below).
  Benkei: { name: 'Sohei', faction: 'Samurai' },
  VikingVanguard: { name: 'Raider', faction: 'Vikings' },
  VikingAssassin: { name: 'Berserker', faction: 'Vikings' },
  VikingHybrid: { name: 'Valkyrie', faction: 'Vikings' },
  VikingTank: { name: 'Warlord', faction: 'Vikings' },
  VikingHitman: { name: 'Highlander', faction: 'Vikings' },
  VikingShaman: { name: 'Shaman', faction: 'Vikings' },
  VikingJormungandr: { name: 'Jormungandr', faction: 'Vikings' },
  // Ubisoft's own stat card labels HeroChineseGeneralReputation as "Tiandi
  // Reputation" and HeroChineseOldMasterReputation as "Jiang Jun Reputation".
  // These two were previously swapped here, on the reasoning that "Jiang Jun"
  // (将军) is Chinese for "General" — true of the name, but not of Ubisoft's
  // codename. The publisher's own label wins over the inference.
  ChineseGeneral: { name: 'Tiandi', faction: 'Wu Lin' },
  ChineseShaolin: { name: 'Shaolin', faction: 'Wu Lin' },
  // Confirmed via a Ubisoft-press hands-on preview published under the URL
  // slug "sun-da-zhanhu" — "SunDa" is Zhanhu's codename, not Tiandi's (an
  // earlier, unverified assumption this replaces).
  ChineseSunDa: { name: 'Zhanhu', faction: 'Wu Lin' },
  // Nuxia's own in-universe lore names her role: "Nuxia was the name given
  // to female bodyguards" — a direct match, not a guess.
  ChineseBodyguard: { name: 'Nuxia', faction: 'Wu Lin' },
  // Confirmed by the stat card, as above: this is Jiang Jun, not Tiandi.
  ChineseOldMaster: { name: 'Jiang Jun', faction: 'Wu Lin' },
  OutlanderMedjay: { name: 'Medjay', faction: 'Outlanders' },
  PirateQueen: { name: 'Pirate', faction: 'Outlanders' },
  Ninja: { name: 'Shinobi', faction: 'Samurai' },
  Ronin: { name: 'Aramusha', faction: 'Samurai' },
  VikingChampion: { name: 'Raider', faction: 'Vikings' },
  // Confirmed live: Ubisoft's "matches played per hero" breakdown names
  // these by release slot (e.g. Hero_OutlandersH033Aztec, Hero_VikingH034Varangian),
  // which places them exactly where these heroes released — matching their
  // themes closely enough to be certain, not a guess.
  Gazelle: { name: 'Afeera', faction: 'Outlanders' },
  Aztec: { name: 'Ocelotl', faction: 'Outlanders' },
  Varangian: { name: 'Varangian Guard', faction: 'Vikings' },
  // Player-confirmed: Huntress is this account's codename for Shaman. Hulda
  // is the one remaining Viking codename once every other Viking hero in
  // this roster is accounted for, so it resolves to the only Viking hero
  // left unmatched: Jormungandr.
  Huntress: { name: 'Shaman', faction: 'Vikings' },
  Hulda: { name: 'Jormungandr', faction: 'Vikings' },
  // Player-confirmed: Sakura is this account's codename for Hitokiri. This
  // also resolves cleanly against the roster: with Sohei now correctly
  // mapped from Benkei above, Sakura was the only Samurai codename left
  // without a home, and Hitokiri was the only Samurai hero left unmatched.
  Sakura: { name: 'Hitokiri', faction: 'Samurai' },
  // From the "matches played per hero" family only (see resolveKnown below):
  // with every other Outlander accounted for, these are the two left.
  Mongol: { name: 'Khatun', faction: 'Outlanders' },
  Fencer: { name: 'Virtuosa', faction: 'Outlanders' },
  // Also matches-played-family-only. That family tags each hero with its
  // release slot (H023, H024, …), and those slots run in release order, so
  // each one lands on a specific hero — corroborated by the faction the
  // codename carries and by the codename's own meaning:
  //   H023 Knight  → Year 3 Season 1 → Black Prior ("dark warden")
  //   H024 Samurai → Year 3 Season 2 → Hitokiri (人斬り literally "manslayer")
  //   H025 Viking  → Year 3 Season 3 → Jormungandr (World Serpent zealot)
  //   H026 Wu Lin  → Year 3 Season 4 → Zhanhu (turned on their old masters)
  //   H029 Samurai → Year 5 Season 2 → Kyoshin (masked, concealed blade)
  Darkwarden: { name: 'Black Prior', faction: 'Knights' },
  Manslayer: { name: 'Hitokiri', faction: 'Samurai' },
  Zealot: { name: 'Jormungandr', faction: 'Vikings' },
  Betrayer: { name: 'Zhanhu', faction: 'Wu Lin' },
  Faceless: { name: 'Kyoshin', faction: 'Samurai' },
  // Player-confirmed, from the live crossplay space: the two newest heroes
  // carry a different codename again in the matches-played family.
  Titan: { name: 'Juren', faction: 'Wu Lin' },
  Brawler: { name: 'Arakure', faction: 'Samurai' },
  // Newer heroes are already stored under their in-game name, so they fall
  // through to the readable-codename path rather than being guessed at.
};

// Note: 'Pirate' is intentionally NOT a prefix — the hero codename is
// "PirateQueen", which is mapped explicitly above, not stripped to "Queen".
// 'Outlanders' (plural, used by the matches-played family) must be checked
// before 'Outlander' (singular) — otherwise the singular match fires first
// and leaves a stray "s" on the front of the remainder.
const FACTION_PREFIXES = ['Knight', 'Samurai', 'Viking', 'Chinese', 'Outlanders', 'Outlander'];

/**
 * Splits a codename into its faction prefix (if any) and a "core" with both
 * the prefix and a release-slot marker ("DLC1"…"DLC5", "H023"…"H037")
 * removed.
 *
 * Confirmed live: Ubisoft names the same hero differently across stat
 * families. The per-hero level/reputation/time family uses a bare or
 * faction-prefixed codename ("Ninja", "SamuraiNinja"); the per-hero
 * matches-played family glues a release-slot marker on top of that
 * ("Hero_SamuraiDLC1Ninja", "Hero_OutlandersH030PirateQueen"). Reducing
 * every form to the same "core" is what lets both families land on one
 * mapping — and one hero row — instead of needing an entry per variant.
 */
function coreCodename(codename: string): { core: string; prefix: string | null } {
  for (const prefix of FACTION_PREFIXES) {
    if (codename.startsWith(prefix)) {
      const core = codename.slice(prefix.length).replace(/^(DLC\d{1,2}|H0?\d{2,3})/, '');
      return { core, prefix };
    }
  }
  return { core: codename.replace(/^(DLC\d{1,2}|H0?\d{2,3})/, ''), prefix: null };
}

/** Looks up a codename in HERO_NAMES, trying the exact codename first, then its core form. */
function resolveKnown(codename: string): { name: string; faction: string } | undefined {
  if (HERO_NAMES[codename]) return HERO_NAMES[codename];
  const { core, prefix } = coreCodename(codename);
  if (prefix && HERO_NAMES[prefix + core]) return HERO_NAMES[prefix + core];
  if (HERO_NAMES[core]) return HERO_NAMES[core];
  return undefined;
}

// Ubisoft's codename prefixes map to a faction, so even a hero whose name we
// cannot resolve still gets its faction from the codename.
const FACTION_BY_PREFIX: Record<string, string> = {
  Knight: 'Knights',
  Samurai: 'Samurai',
  Viking: 'Vikings',
  Chinese: 'Wu Lin',
  Outlander: 'Outlanders',
};

function factionFromCodename(codename: string): string | null {
  for (const prefix of Object.keys(FACTION_BY_PREFIX)) {
    if (codename.startsWith(prefix)) return FACTION_BY_PREFIX[prefix];
  }
  return null;
}

function readableCodename(codename: string): string {
  // Use the same core (prefix and release-slot marker stripped) that
  // resolveKnown() matches against, so a codename that fails to resolve
  // still displays as "Highlander" rather than the unstripped "DLC2Highlander".
  const { core } = coreCodename(codename);
  // Split camelCase into words.
  return core.replace(/([a-z])([A-Z])/g, '$1 $2').trim() || codename;
}

/**
 * Stat keys Ubisoft returns that this file places by hand, with the label a
 * player can actually read.
 *
 * These used to fall through to a generic camelCase splitter, which turned
 * `LastPlayersKilledanygamemode` into "Last Players Killedanygamemode" and
 * `MetaGameManualDeployCount` into "Meta Game Manual Deploy Count" — strings
 * made of real words that tell a player nothing. Ubisoft's own vocabulary
 * calls the Faction War the "meta game" and calls placing war assets on its
 * map a "manual deploy", which is what those two counters record.
 *
 * A key that is not named here is not shown at all. Inventing a label from
 * the key's spelling is what produced the unreadable rows in the first place.
 */
const DECODED: Record<string, { label: string; note?: string }> = {
  LastPlayersKilledanygamemode: {
    label: 'Kills in last match',
    note: 'Players only, any mode',
  },
  MetaGameManualDeployCount: {
    label: 'War assets deployed',
    note: 'Faction War, all time',
  },
  MetaGameManualDeployCurrentSeasonCount: {
    label: 'Deployed this season',
    note: 'Faction War',
  },
};

function num(raw: RawStat | undefined): number | null {
  if (!raw || raw.value === undefined || raw.value === null || raw.value === '') return null;
  const n = Number(raw.value);
  return Number.isFinite(n) ? n : null;
}

function str(raw: RawStat | undefined): string | null {
  if (!raw || raw.value === undefined || raw.value === null || raw.value === '') return null;
  return String(raw.value);
}

/** Seconds → hours, rounded to one decimal. */
function toHours(seconds: number | null): number | null {
  return seconds === null ? null : Math.round((seconds / 3600) * 10) / 10;
}

export interface MappedForHonorStats {
  /**
   * The season the snapshot was last written in. Not a player statistic — it
   * describes the data, so it belongs with the other provenance rather than
   * in a panel of the player's own figures.
   */
  season: number | null;
  overview: Stat[];
  overall: Stat[];
  heroes: HeroStat[];
  /** Matches played and won per game mode, where Ubisoft breaks them out. */
  gameModes: GameModeStat[];
  extraGroups: StatGroup[];
  /**
   * How many values Ubisoft returned that this file has no player-readable
   * label for. Counted so the page can admit the gap without printing a row
   * whose name means nothing.
   */
  undecoded: number;
}

/**
 * Combines the stat dictionaries of every For Honor space a player owns.
 *
 * A player who predates crossplay has stats in both a per-platform space and
 * the crossplay one, and only one of them is still written to. The freshest is
 * authoritative for every key it holds; the others may only fill in keys it
 * does not have at all — a hero played before the move to crossplay, say.
 *
 * Nothing is combined key by key. Taking the larger of each figure looked
 * appealing and was wrong: the two spaces are separate records, not a subset
 * and a superset, so max(matches played) over max(matches won) is a ratio of
 * no real scope at all. It shifted one account's Dominion win rate by two
 * points against figures that were already correct. Whatever the freshest
 * space says about a stat, it says about every stat derived from it too.
 */
export function mergeSpaceStats(snapshots: RawStats[]): RawStats {
  const [freshest, ...rest] = snapshots;
  if (!freshest) return {};
  const merged: RawStats = { ...freshest };
  for (const older of rest) {
    for (const [key, entry] of Object.entries(older)) {
      if (!(key in merged)) merged[key] = entry;
    }
  }
  return merged;
}

export function mapForHonorStats(
  stats: RawStats,
  /**
   * Ubisoft's own hero names and last-played times, from the stat card. When
   * present these win over the codename table below: the publisher's label is
   * authoritative, and it covers heroes whose codename this file has never
   * seen. Absent (the endpoint failed, or another provider), the table stands.
   */
  heroFacts: Map<string, HeroCardFact> = new Map(),
  /**
   * How many separate sessions the player has launched the game for, from
   * Ubisoft's play-history endpoint. Not part of the stats dictionary, but it
   * belongs with the hours, so it is folded in here.
   */
  sessionsPlayed: number | null = null,
): MappedForHonorStats {
  const consumed = new Set<string>();
  const take = (key: string): RawStat | undefined => {
    if (key in stats) consumed.add(key);
    return stats[key];
  };

  // --- Faction ------------------------------------------------------------
  const factionRaw = str(take('Faction'));
  const faction = factionRaw ? (FACTIONS[factionRaw] ?? factionRaw) : null;

  // --- Global totals ------------------------------------------------------
  const pvp = num(take('GamesPlayedPVP'));
  const pve = num(take('GamesPlayedPVE'));
  const custom = num(take('GamesPlayedCustomGame'));
  const priv = num(take('GamesPlayedPrivateMatch'));
  const assists = num(take('AssistTotal'));
  const deaths = num(take('DeathTotal'));
  const kills = num(take('KillTotal'));
  const playersKilled = num(take('PlayersKilledanygamemode'));
  const wins = num(take('MatchesWonwithanyHero.T_Win.1'));
  const reputation = num(take('Reputation'));
  const timeTotal = num(take('TimePlayedTotal'));
  const timePvp = num(take('TimePlayedPVP'));
  take('Playtime'); // Alternate playtime key; TimePlayedTotal is the one shown.
  const campaignProgress = num(take('CampaignProgression'));
  const campaignMission = num(take('CampaignLastMissionCompleted'));

  // Matchmaking rating (TrueSkill); Mu is the rating, Sigma the uncertainty.
  // TrueSkill initialises every player at mu = 25, so a mu of exactly 25 means
  // "no rating was ever recorded", not "this player is rated 25". Confirmed on
  // real accounts: a player with 15,000+ matches still reports exactly 25 for
  // the Kill and Objective ratings, and an account actively playing Ranked
  // Duel today reports exactly 25 for the Duel rating. Showing that as a rank
  // would be inventing one, so it is reported as absent instead.
  const skillRating = (raw: number | null): number | null =>
    raw === null || raw === TRUESKILL_DEFAULT_MU ? null : Math.round(raw);

  const duelSkill = skillRating(num(take('SkillRatingDuelMu')));
  take('SkillRatingDuelSigma');
  const killSkill = skillRating(num(take('SkillRatingKillMu')));
  take('SkillRatingKillSigma');
  const objectiveSkill = skillRating(num(take('SkillRatingObjectiveMu')));
  take('SkillRatingObjectiveSigma');

  // The season this snapshot came from. Ubisoft's stats service can lag well
  // behind live play, so this is surfaced rather than hidden.
  const metaSeason = num(take('MetaGameSeason'));

  // --- Per game mode ------------------------------------------------------
  // Ubisoft breaks matches played and won down by mode, keyed by a short mode
  // code: MatchesPlayedpergamemode.S_Type.<CODE> and
  // MatchesWonpergamemode.T_Win.1.S_Type.<CODE>. Only codes this file can name
  // are consumed; anything else is left for the decoded catch-all rather than
  // shown under a guessed mode name.
  const modeAccum = new Map<string, { played: number | null; won: number | null }>();
  const modeRow = (code: string) => {
    const row = modeAccum.get(code) ?? { played: null, won: null };
    modeAccum.set(code, row);
    return row;
  };
  const playedKey = /^MatchesPlayedpergamemode\.S_Type\.(.+)$/;
  const wonKey = /^MatchesWonpergamemode\.T_Win\.1\.S_Type\.(.+)$/;

  for (const key of Object.keys(stats)) {
    const played = playedKey.exec(key);
    if (played && GAME_MODES[played[1]]) {
      consumed.add(key);
      modeRow(played[1]).played = num(stats[key]);
      continue;
    }
    const won = wonKey.exec(key);
    if (won && GAME_MODES[won[1]]) {
      consumed.add(key);
      modeRow(won[1]).won = num(stats[key]);
    }
  }

  const gameModes: GameModeStat[] = [...modeAccum.entries()]
    .map(([code, row]) => ({
      mode: GAME_MODES[code],
      matches: row.played,
      wins: row.won,
      losses: row.played !== null && row.won !== null ? row.played - row.won : null,
      kills: null,
      deaths: null,
      played: (row.played ?? 0) > 0,
    }))
    .filter((mode) => mode.matches !== null || mode.wins !== null)
    .sort((a, b) => (b.matches ?? 0) - (a.matches ?? 0));

  const totalMatches =
    pvp !== null || pve !== null
      ? (pvp ?? 0) + (pve ?? 0) + (custom ?? 0) + (priv ?? 0)
      : null;
  const kd = kills !== null && deaths ? Math.round((kills / deaths) * 100) / 100 : null;

  // Per-match rates. Ubisoft reports lifetime totals and a lifetime match
  // count on the same scope, so dividing them is sound — and a rate is what a
  // player can actually compare against someone else, where a total only says
  // who has played longer.
  const perMatch = (total: number | null): number | null =>
    total !== null && totalMatches ? Math.round((total / totalMatches) * 100) / 100 : null;

  // Win rate comes from the per-mode counters, which count wins and matches on
  // the same scope. The lifetime "matches won" figure does NOT share a scope
  // with lifetime PvP matches — dividing one by the other produced an 8%
  // win rate for a player who actually wins about three quarters of their
  // games — so it is never used for a rate.
  const modePlayed = gameModes.reduce((sum, mode) => sum + (mode.matches ?? 0), 0);
  const modeWon = gameModes.reduce((sum, mode) => sum + (mode.wins ?? 0), 0);
  const winRate = modePlayed > 0 ? Math.round((modeWon / modePlayed) * 1000) / 10 : null;
  const winRateModes = gameModes
    .filter((mode) => mode.matches !== null && mode.wins !== null)
    .map((mode) => mode.mode);

  // Keys decoded by hand above, read here so they are consumed like any other.
  const decoded = new Map<string, Stat>();
  for (const [key, meta] of Object.entries(DECODED)) {
    const value = num(take(key));
    if (value === null) continue;
    decoded.set(key, {
      key: `decoded-${key}`,
      label: meta.label,
      value,
      kind: 'number',
      note: meta.note,
    });
  }

  // Sections are grouped by what a player would go looking for, not by the
  // shape of Ubisoft's key names: progression apart from combat, matches apart
  // from the time they took, and matchmaking ratings apart from both.
  const overview: Stat[] = [
    { key: 'faction', label: 'Faction', value: faction, kind: 'text' },
    { key: 'reputation', label: 'Total reputation', value: reputation, kind: 'number' },
    { key: 'total-matches', label: 'Matches played', value: totalMatches, kind: 'number' },
    { key: 'playtime', label: 'Time played', value: toHours(timeTotal), kind: 'number', note: 'Hours' },
    {
      key: 'campaign',
      label: 'Completion',
      value: campaignProgress,
      kind: 'percent',
      note: 'As Ubisoft records it',
    },
    {
      // Ubisoft's key is CampaignLastMissionCompleted — the index of the last
      // mission finished, not a count of missions finished.
      key: 'campaign-mission',
      label: 'Last mission',
      value: campaignMission,
      kind: 'number',
    },
  ];

  const overall: Stat[] = [
    { key: 'kills', label: 'Kills', value: kills, kind: 'number' },
    { key: 'deaths', label: 'Deaths', value: deaths, kind: 'number' },
    { key: 'kd', label: 'K / D', value: kd, kind: 'ratio' },
    { key: 'assists', label: 'Assists', value: assists, kind: 'number' },
    {
      key: 'players-killed',
      label: 'Player kills',
      value: playersKilled,
      kind: 'number',
      note: 'Excludes AI opponents',
    },
    { key: 'kills-per-match', label: 'Kills per match', value: perMatch(kills), kind: 'ratio' },
    { key: 'deaths-per-match', label: 'Deaths per match', value: perMatch(deaths), kind: 'ratio' },
    { key: 'assists-per-match', label: 'Assists per match', value: perMatch(assists), kind: 'ratio' },
    ...(decoded.get('LastPlayersKilledanygamemode')
      ? [decoded.get('LastPlayersKilledanygamemode') as Stat]
      : []),
  ];

  // --- Heroes -------------------------------------------------------------
  // Two independent stat families cover heroes: Hero<Codename><Level|
  // Reputation|TimePlayed> gives rep/level/hours, and
  // MatchesPlayedperHero.Hero.Hero_<Codename> gives a match count. The two
  // families spell the same hero's codename differently (e.g. bare "Ninja"
  // vs "Hero_SamuraiDLC1Ninja"), so entries are merged by resolved identity
  // — the hero's real name — rather than by raw codename, so both families
  // land on the same row instead of creating a duplicate.
  interface HeroAccum {
    level: number | null;
    rep: number | null;
    time: number | null;
    matches: number | null;
    faction: string | null;
    portraitUrl: string | null;
    lastPlayedAt: number | null;
  }
  const heroMap = new Map<string, HeroAccum>();

  function heroRow(codename: string): HeroAccum {
    const known = resolveKnown(codename);
    // Ubisoft's own label first, then the codename table, then a readable form
    // of the codename itself. The label is looked up under both the raw
    // codename and its core form, because the stat card and the per-hero
    // match counters spell the same hero differently.
    const fact = heroFacts.get(codename) ?? heroFacts.get(coreCodename(codename).core);
    const tableName = known?.name ?? readableCodename(codename);
    // Prefer whichever name the roster recognises, so the hero keeps its
    // portrait and faction: Ubisoft calls one hero "Varangian" where the
    // roster (and the game's own menus) say "Varangian Guard".
    const name =
      fact && heroIdentity(fact.name) ? fact.name : heroIdentity(tableName) ? tableName : (fact?.name ?? tableName);
    // The roster is authoritative for faction and portrait; fall back to the
    // codename's own mapping, then to the faction its prefix encodes, so
    // every hero shows a faction even when the name is unknown.
    const roster = heroIdentity(name);
    const faction = roster?.faction ?? known?.faction ?? factionFromCodename(codename);
    const existing = heroMap.get(name);
    if (existing) {
      if (existing.lastPlayedAt === null && fact) existing.lastPlayedAt = fact.lastPlayedAt;
      return existing;
    }
    const row: HeroAccum = {
      level: null,
      rep: null,
      time: null,
      matches: null,
      faction,
      portraitUrl: roster?.portraitUrl ?? null,
      lastPlayedAt: fact?.lastPlayedAt ?? null,
    };
    heroMap.set(name, row);
    return row;
  }

  const heroLevelKey = /^Hero(.+?)(Level|Reputation|TimePlayed)$/;
  const heroMatchesKey = /^MatchesPlayedperHero\.Hero\.Hero_(.+)$/;

  for (const key of Object.keys(stats)) {
    const levelMatch = heroLevelKey.exec(key);
    if (levelMatch) {
      consumed.add(key);
      const [, codename, field] = levelMatch;
      const row = heroRow(codename);
      if (field === 'Level') row.level = num(stats[key]);
      else if (field === 'Reputation') row.rep = num(stats[key]);
      else row.time = num(stats[key]);
      continue;
    }
    const matchesMatch = heroMatchesKey.exec(key);
    if (matchesMatch) {
      consumed.add(key);
      const [, codename] = matchesMatch;
      heroRow(codename).matches = num(stats[key]);
    }
  }

  // Names produced by heroRow() are keyed by resolved hero name, so the
  // original raw codename is gone here — Map.entries() below yields
  // [name, row] directly.
  const heroes: HeroStat[] = [...heroMap.entries()]
    .map(([name, row]) => ({
      name,
      faction: row.faction,
      portraitUrl: row.portraitUrl,
      reputation: row.rep,
      level: row.level,
      timePlayedHours: toHours(row.time),
      matches: row.matches,
      lastPlayedAt: row.lastPlayedAt,
      wins: null,
      losses: null,
      kills: null,
      deaths: null,
    }))
    // Only heroes the player has actually touched (any signal present).
    .filter(
      (hero) =>
        hero.reputation !== null ||
        hero.level !== null ||
        hero.timePlayedHours ||
        hero.matches !== null,
    )
    .sort(
      (a, b) =>
        (b.reputation ?? 0) - (a.reputation ?? 0) ||
        (b.timePlayedHours ?? 0) - (a.timePlayedHours ?? 0),
    );

  // --- Anything the mapper did not place ----------------------------------
  // Counted, never shown. A key with no hand-written label cannot be turned
  // into a sentence a player understands, and a grid of half-guessed phrases
  // is worse than an honest count of what is not covered yet.
  let undecoded = 0;
  for (const key of Object.keys(stats)) {
    if (consumed.has(key)) continue;
    // Matchmaking uncertainty and other plumbing are not "missing data".
    if (/sigma$|^_|guid|uuid|version$|timestamp$/i.test(key)) continue;
    if ((num(stats[key]) ?? str(stats[key])) === null) continue;
    undecoded += 1;
  }

  const extraGroups: StatGroup[] = [];

  const push = (key: string, label: string, stats: Stat[], explanation?: string) => {
    const present = stats.filter((stat) => stat.value !== null && stat.value !== undefined);
    if (present.length === 0) return;
    extraGroups.push({ key, label, availability: 'confirmed', explanation, stats });
  };

  // Matches, split by the kind of game rather than by mode — Ubisoft counts
  // both, and they answer different questions.
  push('matches-by-type', 'Matches by type', [
    { key: 'gt-pvp', label: 'Versus players', value: pvp, kind: 'number' },
    { key: 'gt-pve', label: 'Versus AI', value: pve, kind: 'number' },
    { key: 'gt-custom', label: 'Custom', value: custom, kind: 'number' },
    { key: 'gt-private', label: 'Private', value: priv, kind: 'number' },
    { key: 'wins', label: 'Matches won', value: wins, kind: 'number' },
    {
      key: 'win-rate',
      label: 'Win rate',
      value: winRate,
      kind: 'percent',
      note: winRateModes.length > 0 ? `Across ${winRateModes.join(' and ')}` : undefined,
    },
  ]);

  // Hours, plus the two things the raw hours do not say on their own: how much
  // of that time was against real players, and how long a match actually runs.
  const pvpShare =
    timeTotal && timePvp !== null ? Math.round((timePvp / timeTotal) * 1000) / 10 : null;
  const avgMatchMinutes =
    timeTotal !== null && totalMatches
      ? Math.round((timeTotal / totalMatches / 60) * 10) / 10
      : null;
  push('playtime', 'Time played', [
    { key: 'time-total', label: 'All modes', value: toHours(timeTotal), kind: 'number', note: 'Hours' },
    { key: 'time-pvp', label: 'Versus players', value: toHours(timePvp), kind: 'number', note: 'Hours' },
    { key: 'time-pvp-share', label: 'Spent versus players', value: pvpShare, kind: 'percent' },
    {
      key: 'avg-match',
      label: 'Average match',
      value: avgMatchMinutes,
      kind: 'number',
      note: 'Minutes, across every mode',
    },
    {
      key: 'sessions',
      label: 'Play sessions',
      value: sessionsPlayed,
      kind: 'number',
      note: 'Times the game was launched',
    },
    {
      key: 'avg-session',
      label: 'Average session',
      value:
        sessionsPlayed && timeTotal !== null
          ? Math.round((timeTotal / sessionsPlayed / 60) * 10) / 10
          : null,
      kind: 'number',
      note: 'Minutes',
    },
  ]);

  push(
    'matchmaking',
    'Matchmaking ratings',
    [
      { key: 'duel-skill', label: 'Duel', value: duelSkill, kind: 'number' },
      { key: 'kill-skill', label: 'Kills', value: killSkill, kind: 'number' },
      { key: 'objective-skill', label: 'Objectives', value: objectiveSkill, kind: 'number' },
    ],
    'What Ubisoft matches you on internally. It is not the Ranked Duel rank shown in game, and a player who has never been rated in a category simply has no number here.',
  );

  push(
    'faction-war',
    'Faction War',
    [
      decoded.get('MetaGameManualDeployCount') ?? {
        key: 'fw-total',
        label: 'War assets deployed',
        value: null,
        kind: 'number',
      },
      decoded.get('MetaGameManualDeployCurrentSeasonCount') ?? {
        key: 'fw-season',
        label: 'Deployed this season',
        value: null,
        kind: 'number',
      },
    ],
    'The territory battle between Knights, Vikings, Samurai and Wu Lin. Deploying war assets on its map is how a player takes part.',
  );

  return { season: metaSeason, overview, overall, heroes, gameModes, extraGroups, undecoded };
}

/** One entry of Ubisoft's `GET /v2/profiles?userId=` response. */
export interface RawPlatformProfile {
  platformType?: string;
  idOnPlatform?: string;
  nameOnPlatform?: string;
}

export interface PlatformProfiles {
  links: PlatformLink[];
  /** Used server-side only, to look up public Steam achievements. */
  steamId64: string | null;
  /** The Ubisoft Connect name, which is the one a player recognises. */
  accountName: string | null;
}

const PLATFORM_LABELS: Record<string, string> = {
  uplay: 'Ubisoft Connect',
  steam: 'Steam',
  psn: 'PlayStation',
  xbl: 'Xbox',
  amazonstream: 'Amazon Luna',
};

/**
 * Platforms whose handle is shown beside the platform's symbol.
 *
 * A PSN online id and an Xbox gamertag are gaming identities — the name a
 * player gives out to be added in game, and the name their opponents already
 * read on the scoreboard. A Discord tag is a way to reach someone off the game
 * entirely, and a SteamID64 is an account key rather than a name anyone goes
 * by. Only the first kind is shown: this is a tracker anyone can point at
 * anyone.
 */
const HANDLE_SHOWN_ON = new Set(['psn', 'xbl']);

/**
 * A handle worth printing, or null.
 *
 * Ubisoft returns the field for every profile whether or not it holds a name,
 * so an empty string would otherwise render as a gamertag. A handle that is
 * nothing but digits is the platform id under another name — which is what
 * Steam returns — and is not what a player is called.
 */
export function cleanHandle(raw: string | undefined): string | null {
  const handle = (raw ?? '').trim();
  if (!handle || handle.length > 64) return null;
  if (/^\d+$/.test(handle)) return null;
  return handle;
}

/** Read the linked-profiles response into what the page and the lookup need. */
export function platformProfiles(profiles: RawPlatformProfile[]): PlatformProfiles {
  const links = new Map<string, PlatformLink>();
  let steamId64: string | null = null;
  let accountName: string | null = null;

  for (const profile of profiles) {
    const id = profile.platformType ?? '';
    const label = PLATFORM_LABELS[id];
    if (label) {
      // One entry per platform, and a second profile for the same platform
      // that carries no handle must not blank the one that did.
      const handle = HANDLE_SHOWN_ON.has(id)
        ? cleanHandle(profile.nameOnPlatform) ?? links.get(id)?.handle ?? null
        : null;
      links.set(id, { id, label, ...(handle ? { handle } : {}) });
    }
    if (id === 'uplay' && profile.nameOnPlatform) accountName = profile.nameOnPlatform;
    if (id === 'steam' && /^\d{17}$/.test(profile.idOnPlatform ?? '')) {
      steamId64 = profile.idOnPlatform as string;
    }
  }

  return { links: [...links.values()], steamId64, accountName };
}
