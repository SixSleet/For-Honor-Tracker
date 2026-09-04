/**
 * Contracts shared by the UI and the API. The UI is written against these
 * types only — it never sees a provider's raw upstream payload. Adding a new
 * data provider means mapping into this shape, not changing the frontend.
 */

export type PlatformId = 'uplay' | 'steam' | 'psn' | 'xbl';

/** How much confidence we have in a piece of data, end to end. */
export type Availability =
  | 'confirmed' // fetched from a source we tested and it returned this data
  | 'requires-auth' // the source has it, but not without authorization we don't have
  | 'unavailable' // the source is reachable and simply does not expose this
  | 'dead' // the source used to expose this and no longer exists
  | 'unknown'; // not yet verified either way

export interface ProviderInfo {
  id: string;
  label: string;
  /** Short sentence shown in the UI describing where the numbers came from. */
  description: string;
  docsUrl?: string;
}

/**
 * One platform an account is linked to.
 *
 * `handle` is the name the player goes by there, and is only ever set for the
 * platforms whose handle is a gaming identity people share to be found in game
 * — a PSN online id, an Xbox gamertag. The same upstream response carries a
 * Discord tag and a SteamID64 for the same account; neither is a handle in
 * that sense, so neither is carried here.
 */
export interface PlatformLink {
  /** Ubisoft's own platform type: `uplay`, `steam`, `psn`, `xbl`, ... */
  id: string;
  /** Human name for the platform: "PlayStation", "Xbox". */
  label: string;
  /** What the player is called there, when it is one of the shown platforms. */
  handle?: string;
}

export interface PlayerIdentity {
  /** Stable id within the provider (Ubisoft profileId, SteamID64, ...). */
  id: string;
  displayName: string;
  platform: PlatformId;
  avatarUrl?: string;
  profileUrl?: string;
  /** Present only when the provider actually reports it. */
  countryCode?: string;
  /** Epoch millis. */
  lastSeenAt?: number;
}

/** A single displayable statistic. `value` is null when genuinely unknown. */
export interface Stat {
  /**
   * True when the figure is a proven lower bound rather than an exact total —
   * derived from an achievement threshold. The UI marks these so they are
   * never read as the real number.
   */
  minimum?: boolean;
  key: string;
  label: string;
  value: number | string | null;
  /** Rendering hint. */
  kind?: 'number' | 'percent' | 'duration-minutes' | 'text' | 'ratio';
  /** Why the value is null, when it is. */
  note?: string;
}

export interface StatGroup {
  key: string;
  label: string;
  availability: Availability;
  /** Explains an availability that is not 'confirmed'. */
  explanation?: string;
  stats: Stat[];
}

export interface HeroStat {
  name: string;
  reputation: number | null;
  level: number | null;
  matches: number | null;
  wins: number | null;
  losses: number | null;
  kills: number | null;
  deaths: number | null;
  /** Hours played on this hero, when the source reports it. */
  timePlayedHours?: number | null;
  /** Faction the hero belongs to, when known. */
  faction?: string | null;
  /** Portrait image URL, when the hero is in the known roster. */
  portraitUrl?: string | null;
  /** When the player last played this hero, epoch ms, when the source says. */
  lastPlayedAt?: number | null;
}

export interface GameModeStat {
  mode: string;
  matches: number | null;
  wins: number | null;
  losses: number | null;
  kills: number | null;
  deaths: number | null;
  /**
   * True when the figures are proven lower bounds rather than exact totals.
   * The UI must say so wherever it shows them.
   */
  confirmedMinimum?: boolean;
  /** Whether the player has any confirmed activity in this mode. */
  played?: boolean;
  /** The achievement wording each figure is derived from. */
  evidence?: string[];
}

export interface MatchSummary {
  id: string;
  playedAt: number;
  mode: string;
  result: 'win' | 'loss' | 'draw' | 'unknown';
  hero?: string;
  kills?: number;
  deaths?: number;
}

/** A For Honor achievement as reported by the data source. */
export interface Achievement {
  apiName: string;
  name: string;
  description?: string;
  unlocked: boolean;
  unlockedAt?: number;
  iconUrl?: string;
  /** Percent of all owners who have this, from the source's global stats. */
  globalPercent?: number;
}

export interface PlayerReport {
  identity: PlayerIdentity;
  provider: ProviderInfo;
  /** Epoch millis this data was fetched from upstream (not from cache). */
  fetchedAt: number;
  /** True when this response was served from cache. */
  cached: boolean;
  overview: StatGroup;
  overall: StatGroup;
  heroes: { availability: Availability; explanation?: string; items: HeroStat[] };
  gameModes: { availability: Availability; explanation?: string; items: GameModeStat[] };
  matches: { availability: Availability; explanation?: string; items: MatchSummary[] };
  /**
   * Additional stat groups a provider can supply beyond the fixed sections,
   * rendered in order. Used for derived progression breakdowns.
   */
  extraGroups: StatGroup[];
  achievements: {
    availability: Availability;
    explanation?: string;
    items: Achievement[];
    unlockedCount: number;
    totalCount: number;
  };
  /** Anything the provider wants the user to know about this specific result. */
  notices: string[];
  /** When they last played, epoch ms, when the source says. */
  lastPlayedAt?: number | null;
  /**
   * The earliest For Honor session the source has on record, epoch ms. Real
   * and per-player, but "on record" rather than "first ever": for an account
   * that predates the session service it can be later than the true first
   * match, so it must not be labelled as a start date.
   */
  firstSessionAt?: number | null;
  /** The platforms this account plays on, and what it is called on each. */
  platforms?: PlatformLink[];
  /** The game season the source's snapshot was last written in. */
  season?: number | null;
}

export type ApiErrorCode =
  | 'INVALID_USERNAME'
  | 'PLAYER_NOT_FOUND'
  | 'PROFILE_PRIVATE'
  | 'DATA_UNAVAILABLE'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_DISABLED'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export interface ApiError {
  ok: false;
  code: ApiErrorCode;
  /** Safe to show a user verbatim. */
  message: string;
  /** Optional next step, e.g. how to make a Steam profile public. */
  hint?: string;
  /** Present only when diagnostics are enabled. Always redacted. */
  diagnostics?: DiagnosticTrace[];
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  diagnostics?: DiagnosticTrace[];
}

export type ApiResult<T> = ApiSuccess<T> | ApiError;

/** One upstream call, recorded for the diagnostics page. Always redacted. */
export interface DiagnosticTrace {
  provider: string;
  label: string;
  method: string;
  /** Query values that identify a person are masked. */
  url: string;
  requestHeaderNames: string[];
  status: number | null;
  ok: boolean;
  durationMs: number;
  /** Truncated and redacted response body. */
  responseSnippet: string;
  error?: string;
}
