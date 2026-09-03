/**
 * Derives For Honor progression statistics from Steam achievement state.
 *
 * Ubisoft does not release For Honor's real counters, but the game registers
 * 60 Steam achievements and many of them are explicit
 * numeric thresholds: "Win 20 Duel PvP matches", "Kill 5000 soldiers",
 * "Reach Reputation 5 with any Hero". An unlocked achievement is therefore
 * hard evidence that a counter reached at least that value.
 *
 * Everything produced here is a **confirmed lower bound**, never an estimate,
 * and it is labelled that way everywhere it is displayed. Nothing is
 * interpolated between thresholds and nothing is projected past the highest
 * one. The thresholds below are taken verbatim from the achievement
 * descriptions Steam returns.
 */

import type { GameModeStat, Stat } from '@/shared/types';

interface Threshold {
  /** Achievement api name, lower case. */
  id: string;
  /** The value the counter is proven to have reached. */
  value: number;
  /** What the counter counts. */
  metric: string;
  /** The achievement's own wording, shown as the evidence. */
  evidence: string;
}

interface ModeDefinition {
  mode: string;
  wins: Threshold[];
  matches: Threshold[];
}

const MODES: ModeDefinition[] = [
  {
    mode: 'Duel',
    wins: [
      { id: 'forhonor_ach_30', value: 1, metric: 'wins', evidence: 'Win your first Duel PvP match.' },
      { id: 'forhonor_ach_31', value: 20, metric: 'wins', evidence: 'Win 20 Duel PvP matches.' },
    ],
    matches: [],
  },
  {
    mode: 'Brawl',
    wins: [
      { id: 'forhonor_ach_32', value: 1, metric: 'wins', evidence: 'Win your first Brawl PvP match.' },
      { id: 'forhonor_ach_33', value: 20, metric: 'wins', evidence: 'Win 20 Brawl PvP matches.' },
    ],
    matches: [],
  },
  {
    mode: 'Dominion',
    wins: [
      { id: 'forhonor_ach_34', value: 1, metric: 'wins', evidence: 'Win your first Dominion PvP match.' },
      { id: 'forhonor_ach_35', value: 20, metric: 'wins', evidence: 'Win 20 Dominion PvP matches.' },
    ],
    matches: [],
  },
  {
    mode: 'Skirmish',
    wins: [
      { id: 'forhonor_ach_36', value: 1, metric: 'wins', evidence: 'Win your first Skirmish PvP match.' },
      { id: 'forhonor_ach_37', value: 20, metric: 'wins', evidence: 'Win 20 Skirmish PvP matches.' },
    ],
    matches: [],
  },
  {
    mode: 'Elimination',
    wins: [
      { id: 'forhonor_ach_38', value: 1, metric: 'wins', evidence: 'Win your first Elimination PvP match.' },
      { id: 'forhonor_ach_39', value: 20, metric: 'wins', evidence: 'Win 20 Elimination PvP matches.' },
    ],
    matches: [],
  },
  {
    mode: 'Breach',
    wins: [
      { id: 'forhonor_ach_55', value: 1, metric: 'wins', evidence: 'Win your first Breach match.' },
    ],
    matches: [
      { id: 'forhonor_ach_56', value: 15, metric: 'matches', evidence: 'Complete 15 Breach matches.' },
    ],
  },
  {
    mode: 'Arcade',
    wins: [],
    matches: [
      { id: 'forhonor_ach_57', value: 1, metric: 'quests', evidence: 'Complete your first Quest in Arcade.' },
    ],
  },
];

/** Combat counters proven by achievements. */
const COMBAT: Threshold[] = [
  { id: 'forhonor_ach_29', value: 5000, metric: 'Soldiers killed', evidence: 'Kill 5000 soldiers.' },
  { id: 'forhonor_ach_18', value: 50, metric: 'Ledge kills', evidence: 'Kill 50 Opponents by throwing them off a ledge.' },
  { id: 'forhonor_ach_19', value: 50, metric: 'Environmental kills', evidence: 'Throw an opponent into fire or spikes 50 times.' },
  { id: 'forhonor_ach_21', value: 25, metric: 'Kills from above', evidence: 'Kill 25 Heroes by attacking them from above in PvP.' },
  { id: 'forhonor_ach_23', value: 50, metric: 'Honorable kills (4v4)', evidence: 'Complete 50 Honorable Kills in 4v4 PvP matches.' },
  { id: 'forhonor_ach_28', value: 50, metric: 'Parries', evidence: 'Parry attacks 50 Times.' },
  { id: 'forhonor_ach_27', value: 50, metric: 'Revenge activations', evidence: 'Activate Revenge mode 50 times.' },
  { id: 'forhonor_ach_24', value: 50, metric: 'Ally saves (4v4)', evidence: 'Save an ally 50 times in 4v4 PvP matches.' },
  { id: 'forhonor_ach_26', value: 50, metric: 'Max renown reached (Dominion)', evidence: 'Get the max Renown level 50 times in Dominion PvP matches.' },
  { id: 'forhonor_ach_25', value: 5, metric: 'Kill streaks of 5', evidence: 'Get 5 Kill Streaks of 5 kills in Elimination or Skirmish in PvP.' },
];

/** Reputation and hero progression proven by achievements. */
const REPUTATION: Threshold[] = [
  { id: 'forhonor_ach_60', value: 7, metric: 'Wu Lin reputation', evidence: 'Reach Reputation 7 with one of the Wu Lin Heroes.' },
  { id: 'forhonor_ach_17', value: 5, metric: 'Highest hero reputation', evidence: 'Reach Reputation 5 with any Hero.' },
  { id: 'forhonor_ach_14', value: 1, metric: 'Knight reputation', evidence: 'Reach Reputation 1 with one of the Knight Heroes.' },
  { id: 'forhonor_ach_15', value: 1, metric: 'Samurai reputation', evidence: 'Reach Reputation 1 with one of the Samurai Heroes.' },
  { id: 'forhonor_ach_16', value: 1, metric: 'Viking reputation', evidence: 'Reach Reputation 1 with one of the Viking Heroes.' },
  { id: 'forhonor_ach_13', value: 4, metric: 'Heroes recruited in one faction', evidence: 'Recruit 4 Heroes of a single Faction.' },
  { id: 'forhonor_ach_59', value: 10, metric: 'Wu Lin matches', evidence: 'Complete 10 matches with any Wu Lin Hero.' },
];

/** Story mode progression proven by achievements. */
const STORY: Threshold[] = [
  { id: 'forhonor_ach_12', value: 30, metric: 'Story level', evidence: 'Reach maximum Story Level 30 in Story Mode.' },
  { id: 'forhonor_ach_11', value: 20, metric: 'Story level', evidence: 'Reach Story Level 20 in Story Mode.' },
  { id: 'forhonor_ach_10', value: 10, metric: 'Story level', evidence: 'Reach Story Level 10 in Story Mode.' },
];

const STORY_CHAPTERS = ['forhonor_ach_1', 'forhonor_ach_2', 'forhonor_ach_3'];
const STORY_DIFFICULTY: Array<{ id: string; label: string }> = [
  { id: 'forhonor_ach_9', label: 'Realistic' },
  { id: 'forhonor_ach_8', label: 'Hard' },
  { id: 'forhonor_ach_7', label: 'Normal' },
];

/** Faction War participation proven by achievements. */
const FACTION_WAR: Threshold[] = [
  { id: 'forhonor_ach_52', value: 50, metric: 'Battles with manual deployment', evidence: 'Manually deploy Troops in 50 different Battles.' },
  { id: 'forhonor_ach_49', value: 100, metric: 'Manual troop deployments', evidence: 'Manually deploy Troops on territories 100 times.' },
  { id: 'forhonor_ach_51', value: 5, metric: 'Campaigns participated in', evidence: 'Manually deploy Troops in 5 different Campaigns.' },
  { id: 'forhonor_ach_53', value: 10, metric: 'Enemy territories contested', evidence: 'Manually deploy Troops on 10 enemy territories.' },
  { id: 'forhonor_ach_54', value: 10, metric: 'Friendly territories defended', evidence: 'Manually deploy Troops on 10 friendly territories.' },
];

export type UnlockedSet = ReadonlySet<string>;

export function unlockedSet(items: Array<{ apiName: string; unlocked: boolean }>): UnlockedSet {
  return new Set(
    items.filter((item) => item.unlocked).map((item) => item.apiName.toLowerCase()),
  );
}

/** The highest threshold in `list` that the player has actually proven. */
function highest(list: Threshold[], unlocked: UnlockedSet): Threshold | null {
  return (
    list
      .filter((threshold) => unlocked.has(threshold.id))
      .sort((a, b) => b.value - a.value)[0] ?? null
  );
}

/** Per-mode statistics, as confirmed lower bounds. */
export function deriveGameModes(unlocked: UnlockedSet): GameModeStat[] {
  return MODES.map(({ mode, wins, matches }) => {
    const bestWin = highest(wins, unlocked);
    const bestMatch = highest(matches, unlocked);
    const evidence = [bestWin?.evidence, bestMatch?.evidence].filter(
      (item): item is string => Boolean(item),
    );
    return {
      mode,
      matches: bestMatch?.value ?? null,
      wins: bestWin?.value ?? null,
      losses: null,
      kills: null,
      deaths: null,
      confirmedMinimum: true,
      played: evidence.length > 0,
      evidence,
    };
  });
}

function toStats(list: Threshold[], unlocked: UnlockedSet, prefix: string): Stat[] {
  const byMetric = new Map<string, Threshold>();
  for (const threshold of list) {
    if (!unlocked.has(threshold.id)) continue;
    const existing = byMetric.get(threshold.metric);
    if (!existing || threshold.value > existing.value) byMetric.set(threshold.metric, threshold);
  }
  return list
    .map((threshold) => threshold.metric)
    .filter((metric, index, all) => all.indexOf(metric) === index)
    .map((metric) => {
      const proven = byMetric.get(metric);
      return {
        key: `${prefix}-${metric.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        label: metric,
        value: proven ? proven.value : null,
        kind: 'number' as const,
        // Every figure here is an achievement threshold the player has passed,
        // so it is a floor rather than a total. Flagged as such so it renders
        // with a "≥" wherever it is shown, not only where the note is read.
        minimum: true,
        note: proven ? `At least — ${proven.evidence}` : 'Not confirmed by any achievement',
      };
    });
}

export function deriveCombat(unlocked: UnlockedSet): Stat[] {
  return toStats(COMBAT, unlocked, 'combat');
}

export function deriveReputation(unlocked: UnlockedSet): Stat[] {
  return toStats(REPUTATION, unlocked, 'rep');
}

export function deriveFactionWar(unlocked: UnlockedSet): Stat[] {
  return toStats(FACTION_WAR, unlocked, 'fw');
}

export function deriveStory(unlocked: UnlockedSet): Stat[] {
  const level = highest(STORY, unlocked);
  const chapters = STORY_CHAPTERS.filter((id) => unlocked.has(id)).length;
  const difficulty = STORY_DIFFICULTY.find((entry) => unlocked.has(entry.id));

  return [
    {
      key: 'story-level',
      label: 'Story level',
      value: level?.value ?? null,
      kind: 'number',
      // A threshold, so a floor: the achievements stop at 30 and the player
      // may have gone further.
      minimum: true,
      note: level ? `At least — ${level.evidence}` : 'Not confirmed by any achievement',
    },
    {
      key: 'story-chapters',
      label: 'Chapters completed',
      value: chapters > 0 ? chapters : null,
      kind: 'number',
      // Exact, not a floor: there is one achievement per chapter and all
      // three exist, so the count is complete.
      note: chapters > 0 ? `${chapters} of 3 faction chapters` : 'None confirmed',
    },
    {
      key: 'story-difficulty',
      label: 'Highest difficulty cleared',
      value: difficulty?.label ?? null,
      kind: 'text',
      // Exact for the same reason: every difficulty has its own achievement,
      // so the highest unlocked one is the highest cleared.
      note: difficulty ? 'Confirmed by achievement' : 'Not confirmed by any achievement',
    },
  ];
}

/** How many of the derived figures are actually backed by evidence. */
export function countConfirmed(stats: Stat[]): number {
  return stats.filter((stat) => stat.value !== null).length;
}
