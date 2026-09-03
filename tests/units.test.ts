import { test } from 'node:test';
import assert from 'node:assert/strict';

import { maskUrl, redactBody, redactString } from '../src/server/redact.ts';
import { normalizeQuery, profileXmlUrl } from '../src/server/providers/steam-query.ts';
import { validateUsername } from '../src/shared/validation.ts';
import { formatStatValue, LOCALE } from '../src/shared/format.ts';
import { attr, numberOrNull, tagBlocks, tagText } from '../src/server/providers/steam-xml.ts';

// --- redaction -------------------------------------------------------------

test('redaction strips a Ubisoft session ticket', () => {
  const input = 'Authorization: Ubi_v1 t=abcDEF123.456-789_xyzQQQ';
  assert.match(redactString(input), /Ubi_v1 t=<redacted>/);
  assert.doesNotMatch(redactString(input), /abcDEF123/);
});

test('redaction strips ticket and sessionId fields from a JSON body', () => {
  const body = JSON.stringify({
    ticket: 'super-secret-ticket-value',
    sessionId: 'sess-1',
    profileId: 'keep-me',
  });
  const out = redactBody(body);
  assert.doesNotMatch(out, /super-secret-ticket-value/);
  assert.doesNotMatch(out, /sess-1/);
  assert.match(out, /keep-me/);
});

test('redaction strips Basic and Bearer credentials', () => {
  assert.doesNotMatch(redactString('Basic dXNlcjpwYXNzd29yZA=='), /dXNlcjpwYXNz/);
  assert.doesNotMatch(redactString('Bearer aaaaaaaaaaaaaaaaaaaaaaaa'), /aaaaaaaaaaaaaaaaaaaa/);
});

test('redaction strips Steam-key and email shapes', () => {
  assert.doesNotMatch(redactString('0123456789ABCDEF0123456789ABCDEF'), /0123456789ABCDEF/);
  assert.doesNotMatch(redactString('contact player@example.com now'), /player@example\.com/);
});

test('redaction survives a non-JSON body', () => {
  assert.match(redactBody('<html>plain</html>'), /plain/);
});

test('redaction truncates long bodies', () => {
  const out = redactBody('x'.repeat(5000), 100);
  assert.ok(out.length < 200, 'expected truncation');
  assert.match(out, /truncated/);
});

test('maskUrl hides credential parameters but keeps identifiers', () => {
  const masked = maskUrl('https://api.example.com/x?key=abcd1234&steamid=76561190000000000');
  assert.doesNotMatch(masked, /abcd1234/);
  assert.match(masked, /76561190000000000/);
});

// --- username validation ---------------------------------------------------

test('validateUsername accepts ordinary names and rejects junk', () => {
  assert.equal(validateUsername('Knight_99').ok, true);
  assert.equal(validateUsername('  spaced name  ').ok, true);
  assert.equal(validateUsername('').ok, false);
  assert.equal(validateUsername('a').ok, false);
  assert.equal(validateUsername('<script>alert(1)</script>').ok, false);
  assert.equal(validateUsername('x'.repeat(200)).ok, false);
});

test('validateUsername trims before returning', () => {
  const result = validateUsername('  Warden  ');
  assert.equal(result.ok && result.value, 'Warden');
});

// --- Steam query parsing ---------------------------------------------------

test('normalizeQuery recognises a SteamID64', () => {
  assert.deepEqual(normalizeQuery('76561190000000000'), {
    kind: 'id',
    value: '76561190000000000',
  });
});

test('normalizeQuery recognises both profile URL forms', () => {
  assert.deepEqual(normalizeQuery('https://steamcommunity.com/id/someone/'), {
    kind: 'vanity',
    value: 'someone',
  });
  assert.deepEqual(normalizeQuery('steamcommunity.com/profiles/76561190000000000'), {
    kind: 'id',
    value: '76561190000000000',
  });
});

test('normalizeQuery rejects names it cannot use', () => {
  assert.equal(normalizeQuery(''), null);
  assert.equal(normalizeQuery('has spaces'), null);
});

test('profileXmlUrl builds the right endpoint for each kind', () => {
  assert.equal(
    profileXmlUrl({ kind: 'id', value: '765' }, '/stats/304390'),
    'https://steamcommunity.com/profiles/765/stats/304390?xml=1',
  );
  assert.equal(
    profileXmlUrl({ kind: 'vanity', value: 'a b' }),
    'https://steamcommunity.com/id/a%20b?xml=1',
  );
});

// --- Steam XML reading -----------------------------------------------------

const SAMPLE = `<?xml version="1.0"?><playerstats>
  <steamID64>76561190000000000</steamID64>
  <steamID><![CDATA[Sir Test & Co]]></steamID>
  <privacyState>public</privacyState>
  <achievements>
    <achievement closed="1">
      <apiname>ForHonor_Ach_1</apiname>
      <name><![CDATA[First Blood]]></name>
      <description><![CDATA[Win a duel]]></description>
      <unlockTimestamp>1600000000</unlockTimestamp>
      <iconClosed>https://example.invalid/a.jpg</iconClosed>
    </achievement>
    <achievement closed="0">
      <apiname>ForHonor_Ach_2</apiname>
      <name>Locked One</name>
    </achievement>
  </achievements>
</playerstats>`;

test('tagText reads text and decodes CDATA and entities', () => {
  assert.equal(tagText(SAMPLE, 'steamID64'), '76561190000000000');
  assert.equal(tagText(SAMPLE, 'steamID'), 'Sir Test & Co');
  assert.equal(tagText(SAMPLE, 'missing'), null);
});

test('tagBlocks separates each achievement and exposes its attributes', () => {
  const blocks = tagBlocks(SAMPLE, 'achievement');
  assert.equal(blocks.length, 2);
  assert.equal(attr(blocks[0].attrs, 'closed'), '1');
  assert.equal(attr(blocks[1].attrs, 'closed'), '0');
  assert.equal(tagText(blocks[0].inner, 'name'), 'First Blood');
  assert.equal(tagText(blocks[1].inner, 'description'), null);
});

test('numberOrNull parses numbers and rejects everything else', () => {
  assert.equal(numberOrNull('1,234.5'), 1234.5);
  assert.equal(numberOrNull(''), null);
  assert.equal(numberOrNull(null), null);
  assert.equal(numberOrNull('abc'), null);
});

// --- For Honor progression derivation --------------------------------------

import {
  deriveCombat,
  deriveFactionWar,
  deriveGameModes,
  deriveReputation,
  deriveStory,
  unlockedSet,
} from '../src/server/providers/forhonor-progression.ts';

const NOTHING = unlockedSet([]);

test('derivation reports nothing when no achievement is unlocked', () => {
  assert.equal(deriveCombat(NOTHING).every((stat) => stat.value === null), true);
  assert.equal(deriveGameModes(NOTHING).every((mode) => mode.wins === null), true);
  assert.equal(deriveGameModes(NOTHING).every((mode) => mode.played === false), true);
});

test('an unlocked threshold proves the higher bound, not the lower one', () => {
  const both = unlockedSet([
    { apiName: 'forhonor_ach_30', unlocked: true }, // win first Duel
    { apiName: 'forhonor_ach_31', unlocked: true }, // win 20 Duels
  ]);
  const duel = deriveGameModes(both).find((mode) => mode.mode === 'Duel');
  assert.equal(duel?.wins, 20);
  assert.equal(duel?.played, true);
  assert.equal(duel?.confirmedMinimum, true);
});

test('a locked higher threshold does not inflate the confirmed value', () => {
  const firstOnly = unlockedSet([
    { apiName: 'forhonor_ach_30', unlocked: true },
    { apiName: 'forhonor_ach_31', unlocked: false },
  ]);
  assert.equal(deriveGameModes(firstOnly).find((mode) => mode.mode === 'Duel')?.wins, 1);
});

test('achievement api names are matched case-insensitively', () => {
  const upper = unlockedSet([{ apiName: 'ForHonor_Ach_29', unlocked: true }]);
  const soldiers = deriveCombat(upper).find((stat) => stat.label === 'Soldiers killed');
  assert.equal(soldiers?.value, 5000);
  assert.match(soldiers?.note ?? '', /At least/);
});

test('unconfirmed metrics are null with an explanation, never zero', () => {
  const parries = deriveCombat(NOTHING).find((stat) => stat.label === 'Parries');
  assert.equal(parries?.value, null);
  assert.match(parries?.note ?? '', /Not confirmed/);
});

test('reputation takes the highest proven tier', () => {
  const reps = unlockedSet([
    { apiName: 'forhonor_ach_14', unlocked: true }, // reputation 1 Knight
    { apiName: 'forhonor_ach_17', unlocked: true }, // reputation 5 any hero
  ]);
  const derived = deriveReputation(reps);
  assert.equal(derived.find((stat) => stat.label === 'Highest hero reputation')?.value, 5);
  assert.equal(derived.find((stat) => stat.label === 'Wu Lin reputation')?.value, null);
});

test('story progression reports level, chapters and difficulty', () => {
  const story = deriveStory(
    unlockedSet([
      { apiName: 'forhonor_ach_10', unlocked: true }, // story level 10
      { apiName: 'forhonor_ach_11', unlocked: true }, // story level 20
      { apiName: 'forhonor_ach_1', unlocked: true }, // knight chapter
      { apiName: 'forhonor_ach_2', unlocked: true }, // viking chapter
      { apiName: 'forhonor_ach_8', unlocked: true }, // hard difficulty
    ]),
  );
  assert.equal(story.find((stat) => stat.key === 'story-level')?.value, 20);
  assert.equal(story.find((stat) => stat.key === 'story-chapters')?.value, 2);
  assert.equal(story.find((stat) => stat.key === 'story-difficulty')?.value, 'Hard');
});

test('story difficulty prefers the hardest cleared', () => {
  const story = deriveStory(
    unlockedSet([
      { apiName: 'forhonor_ach_7', unlocked: true },
      { apiName: 'forhonor_ach_9', unlocked: true },
    ]),
  );
  assert.equal(story.find((stat) => stat.key === 'story-difficulty')?.value, 'Realistic');
});

// --- Ubisoft For Honor stat mapping ----------------------------------------

import {
  heroFactsFromStatCard,
  mapForHonorStats,
  mergeSpaceStats,
  playedRangeFromStatCard,
} from '../src/server/providers/forhonor-ubisoft-stats.ts';
import type { RawStats } from '../src/server/providers/forhonor-ubisoft-stats.ts';
import {
  cleanHandle,
  platformProfiles,
} from '../src/server/providers/forhonor-ubisoft-stats.ts';

const s = (value: string | number) => ({ value: String(value) });

test('maps global For Honor totals and decodes faction', () => {
  const mapped = mapForHonorStats({
    GamesPlayedPVP: s(14895),
    GamesPlayedPVE: s(18),
    GamesPlayedCustomGame: s(253),
    GamesPlayedPrivateMatch: s(56),
    AssistTotal: s(22987),
    DeathTotal: s(34073),
    Faction: s('vk'),
    CampaignProgression: s(0),
  });
  const overview = Object.fromEntries(mapped.overview.map((x) => [x.key, x.value]));
  assert.equal(overview.faction, 'Vikings');
  assert.equal(overview['total-matches'], 14895 + 18 + 253 + 56);
  const overall = Object.fromEntries(mapped.overall.map((x) => [x.key, x.value]));
  assert.equal(overall.assists, 22987);
  assert.equal(overall.deaths, 34073);
  // Match counts are split into a dedicated "by game type" group.
  const byType = mapped.extraGroups.find((g) => g.key === 'matches-by-type');
  const types = Object.fromEntries((byType?.stats ?? []).map((x) => [x.key, x.value]));
  assert.equal(types['gt-pvp'], 14895);
  assert.equal(types['gt-pve'], 18);
  assert.equal(types['gt-custom'], 253);
  assert.equal(types['gt-private'], 56);
});

test('groups per-hero level, reputation and time played by hero', () => {
  const mapped = mapForHonorStats({
    HeroAztecLevel: s(10),
    HeroAztecReputation: s(15),
    HeroAztecTimePlayed: s(182720),
    HeroBenkeiLevel: s(10),
    HeroBenkeiReputation: s(7),
    HeroBenkeiTimePlayed: s(69212),
  });
  const benkei = mapped.heroes.find((h) => h.name === 'Sohei');
  assert.ok(benkei, 'Benkei codename maps to Sohei (a historical warrior monk)');
  assert.equal(benkei.reputation, 7);
  assert.equal(benkei.level, 10);
  assert.equal(benkei.timePlayedHours, Math.round((69212 / 3600) * 10) / 10);
  // Known heroes carry their faction and a portrait from the roster.
  assert.equal(benkei.faction, 'Samurai');
  assert.match(benkei.portraitUrl ?? '', /hero-images\/sohei\.jpg$/);
  // Sorted by reputation, Aztec (15) before Benkei (7).
  assert.equal(mapped.heroes[0].reputation, 15);
});

test('player-confirmed codename correction: Sakura maps to Hitokiri', () => {
  const mapped = mapForHonorStats({ HeroSakuraReputation: s(2), HeroSakuraLevel: s(17) });
  const hitokiri = mapped.heroes.find((h) => h.name === 'Hitokiri');
  assert.ok(hitokiri, 'Sakura codename maps to Hitokiri');
  assert.equal(hitokiri.faction, 'Samurai');
  assert.match(hitokiri.portraitUrl ?? '', /hero-images\/hitokiri\.jpg$/);
});

test('unknown hero codenames render readably and still get a faction', () => {
  const mapped = mapForHonorStats({ HeroKnightMysteryReputation: s(3) });
  const hero = mapped.heroes[0];
  assert.equal(hero.name, 'Mystery');
  assert.equal(hero.reputation, 3);
  // Faction still resolves from the codename prefix, even with no name match.
  assert.equal(hero.faction, 'Knights');
  assert.equal(hero.portraitUrl, null);
});

test('bare newer-hero codenames resolve to their real name, faction and portrait', () => {
  const mapped = mapForHonorStats({
    HeroAztecReputation: s(15),
    HeroGazelleReputation: s(9),
    HeroVarangianReputation: s(6),
  });
  const byName = (n: string) => mapped.heroes.find((h) => h.name === n);
  const ocelotl = byName('Ocelotl');
  assert.ok(ocelotl, 'Aztec codename maps to Ocelotl');
  assert.equal(ocelotl.faction, 'Outlanders');
  assert.match(ocelotl.portraitUrl ?? '', /hero-images\/ocelotl\.jpg$/);
  const afeera = byName('Afeera');
  assert.ok(afeera, 'Gazelle codename maps to Afeera');
  assert.equal(afeera.faction, 'Outlanders');
  const varangian = byName('Varangian Guard');
  assert.ok(varangian, 'Varangian codename maps to Varangian Guard');
  assert.equal(varangian.faction, 'Vikings');
});

test('the last two Viking codenames resolve to Shaman and Jormungandr', () => {
  const mapped = mapForHonorStats({
    HeroHuntressReputation: s(23),
    HeroHuldaReputation: s(13),
  });
  const shaman = mapped.heroes.find((h) => h.name === 'Shaman');
  assert.ok(shaman, 'Huntress codename maps to Shaman');
  assert.equal(shaman.faction, 'Vikings');
  assert.match(shaman.portraitUrl ?? '', /hero-images\/shaman\.jpg$/);
  const jormungandr = mapped.heroes.find((h) => h.name === 'Jormungandr');
  assert.ok(jormungandr, 'Hulda codename maps to Jormungandr');
  assert.equal(jormungandr.faction, 'Vikings');
  assert.match(jormungandr.portraitUrl ?? '', /hero-images\/jormungandr\.jpg$/);
});

test('a faction-prefixed codename still resolves via its bare mapping', () => {
  // Confirmed live: the "matches played per hero" stat family prefixes the
  // same bare codenames HERO_NAMES already maps (e.g. "SamuraiNinja" for the
  // hero otherwise stored as bare "Ninja"). Both forms must resolve the same
  // way rather than one silently falling through to the raw codename.
  const mapped = mapForHonorStats({
    HeroSamuraiNinjaReputation: s(11),
    HeroSamuraiRoninReputation: s(4),
  });
  const shinobi = mapped.heroes.find((h) => h.name === 'Shinobi');
  assert.ok(shinobi, 'SamuraiNinja resolves the same as bare Ninja');
  assert.equal(shinobi.faction, 'Samurai');
  const aramusha = mapped.heroes.find((h) => h.name === 'Aramusha');
  assert.ok(aramusha, 'SamuraiRonin resolves the same as bare Ronin');
  assert.equal(aramusha.faction, 'Samurai');
});

test('heroes with no signal are dropped', () => {
  const mapped = mapForHonorStats({ HeroAztecLevel: s(0), HeroAztecReputation: s(0) });
  // level 0 and rep 0 are numeric but present; kept only if any is non-null.
  assert.equal(mapped.heroes.length, 1);
  const empty = mapForHonorStats({});
  assert.equal(empty.heroes.length, 0);
});

test('a key with no hand-written label is counted, never shown', () => {
  // Generating a label from a key's spelling is what produced rows like
  // "Last Players Killedanygamemode" and "Meta Game Manual Deploy Count":
  // real words, no meaning. An unlabelled key is now counted instead, so the
  // page can say how much is not covered without printing nonsense.
  const mapped = mapForHonorStats({ SomeNewCounter: s(42), AnotherOne: s(7) });
  assert.equal(mapped.undecoded, 2);
  const everyStat = [
    ...mapped.overview,
    ...mapped.overall,
    ...mapped.extraGroups.flatMap((group) => group.stats),
  ];
  assert.ok(!everyStat.some((stat) => /Some New Counter|SomeNewCounter/i.test(stat.label)));
});

test('the keys that used to read as gibberish now have written labels', () => {
  const mapped = mapForHonorStats({
    LastPlayersKilledanygamemode: s(3),
    MetaGameManualDeployCount: s(572),
    MetaGameManualDeployCurrentSeasonCount: s(1),
  });
  // All three are named, so none of them counts as undecoded.
  assert.equal(mapped.undecoded, 0);

  const combat = Object.fromEntries(mapped.overall.map((x) => [x.label, x.value]));
  assert.equal(combat['Kills in last match'], 3);

  const war = mapped.extraGroups.find((group) => group.key === 'faction-war');
  assert.ok(war, 'the Faction War counters get a section of their own');
  const values = Object.fromEntries(war.stats.map((x) => [x.label, x.value]));
  assert.equal(values['War assets deployed'], 572);
  assert.equal(values['Deployed this season'], 1);
  // And the section explains what the Faction War is, because the label alone
  // does not tell a player what they are looking at.
  assert.match(war.explanation ?? '', /territory battle/i);
});

test('internal plumbing keys are neither shown nor counted as missing', () => {
  const mapped = mapForHonorStats({
    SkillRatingDuelSigma: s(4.1),
    SomeGuidThing: s('abc'),
  });
  assert.equal(mapped.undecoded, 0);
});

test('every stat lands in the section a player would look for it in', () => {
  const mapped = mapForHonorStats({
    GamesPlayedPVP: s(21953),
    GamesPlayedPVE: s(83),
    GamesPlayedCustomGame: s(366),
    GamesPlayedPrivateMatch: s(58),
    'MatchesWonwithanyHero.T_Win.1': s(1815),
    'MatchesPlayedpergamemode.S_Type.DMN': s(1368),
    'MatchesWonpergamemode.T_Win.1.S_Type.DMN': s(996),
    KillTotal: s(81202),
    DeathTotal: s(53821),
    TimePlayedTotal: s(12524120),
    TimePlayedPVP: s(7227330),
    SkillRatingDuelMu: s(46),
    CampaignProgression: s(1),
    Reputation: s(697),
  });
  const section = (key: string) => mapped.extraGroups.find((group) => group.key === key);
  const keysIn = (key: string) => (section(key)?.stats ?? []).map((stat) => stat.key);

  // Match counts and the win rate derived from them sit together.
  assert.ok(keysIn('matches-by-type').includes('gt-pvp'));
  assert.ok(keysIn('matches-by-type').includes('win-rate'));
  // Hours are their own section, not mixed in with match counts.
  assert.ok(keysIn('playtime').includes('time-pvp'));
  assert.ok(!keysIn('matches-by-type').includes('time-pvp'));
  // Matchmaking ratings are separated from combat totals and explained.
  assert.ok(keysIn('matchmaking').includes('duel-skill'));
  assert.match(section('matchmaking')?.explanation ?? '', /not the Ranked Duel rank/i);
  // Progression stays in the overview; raw combat totals stay in combat.
  assert.ok(mapped.overview.some((stat) => stat.key === 'campaign'));
  assert.ok(mapped.overall.some((stat) => stat.key === 'kills'));
  assert.ok(!mapped.overall.some((stat) => stat.key === 'duel-skill'));
});

test('Wu Lin codenames map to the hero Ubisoft says, one codename at a time', () => {
  // Asserted one codename at a time on purpose. This test used to feed all
  // five in together and only check that each name appeared somewhere in the
  // result, which is true even when two of them are swapped — and two of them
  // were: Ubisoft's own stat card labels HeroChineseGeneral as "Tiandi" and
  // HeroChineseOldMaster as "Jiang Jun", the reverse of what this file had.
  const only = (codename: string) =>
    mapForHonorStats({ [`Hero${codename}Reputation`]: s(4) }).heroes[0];

  assert.equal(only('ChineseGeneral').name, 'Tiandi');
  assert.equal(only('ChineseOldMaster').name, 'Jiang Jun');
  assert.equal(only('ChineseSunDa').name, 'Zhanhu');
  assert.equal(only('ChineseBodyguard').name, 'Nuxia');
  assert.equal(only('ChineseShaolin').name, 'Shaolin');
  for (const codename of [
    'ChineseGeneral',
    'ChineseOldMaster',
    'ChineseSunDa',
    'ChineseBodyguard',
    'ChineseShaolin',
  ]) {
    const hero = only(codename);
    assert.equal(hero.faction, 'Wu Lin', `${codename} is Wu Lin`);
    assert.ok(hero.portraitUrl, `${codename} resolves to a real hero with a portrait`);
  }
});

test('per-hero level/reputation and per-hero matches-played merge onto one row', () => {
  // These two stat families spell the same hero's codename differently —
  // bare "PirateQueen" for level/reputation/time, "Hero_OutlandersH030PirateQueen"
  // for matches played — and must land on the same table row, not two.
  const mapped = mapForHonorStats({
    HeroPirateQueenReputation: s(16),
    HeroPirateQueenLevel: s(12),
    'MatchesPlayedperHero.Hero.Hero_OutlandersH030PirateQueen': s(437),
  });
  assert.equal(mapped.heroes.length, 1);
  const pirate = mapped.heroes[0];
  assert.equal(pirate.name, 'Pirate');
  assert.equal(pirate.reputation, 16);
  assert.equal(pirate.level, 12);
  assert.equal(pirate.matches, 437);
  // The matches-played key is consumed, not left as an unlabelled value.
  assert.equal(mapped.undecoded, 0);
});

test('a matches-played-only hero (no level/reputation entry) still shows', () => {
  const mapped = mapForHonorStats({
    'MatchesPlayedperHero.Hero.Hero_KnightAssassin': s(211),
  });
  const peacekeeper = mapped.heroes.find((h) => h.name === 'Peacekeeper');
  assert.ok(peacekeeper, 'a hero with only a matches-played entry still appears');
  assert.equal(peacekeeper.matches, 211);
  assert.equal(peacekeeper.reputation, null);
});

test('an unrated skill rating (TrueSkill default) is reported as absent, not as a rating of 25', () => {
  // TrueSkill seeds every player at mu = 25, so exactly 25 means "never
  // rated". Confirmed live: a player with 15,000+ matches still reports 25
  // for Kill and Objective, and an account actively playing Ranked Duel
  // reports 25 for Duel. Showing that as a rank would be inventing one.
  const unrated = mapForHonorStats({
    SkillRatingDuelMu: s(25),
    SkillRatingKillMu: s(25),
    SkillRatingObjectiveMu: s(25),
  });
  // With every rating unset there is nothing to show, so the section is not
  // built at all rather than rendering three dashes.
  assert.equal(
    unrated.extraGroups.find((group) => group.key === 'matchmaking'),
    undefined,
  );

  // A genuine, non-default rating still comes through.
  const rated = mapForHonorStats({ SkillRatingDuelMu: s(46), SkillRatingKillMu: s(25) });
  const matchmaking = rated.extraGroups.find((group) => group.key === 'matchmaking');
  const val = (k: string) => matchmaking?.stats.find((x) => x.key === k)?.value;
  assert.equal(val('duel-skill'), 46);
  // The unrated one is still listed, with no value, so the section says which
  // categories this player has never been rated in.
  assert.equal(val('kill-skill'), null);
});

test('the season the snapshot came from is surfaced, not hidden', () => {
  const mapped = mapForHonorStats({ MetaGameSeason: s(34) });
  // It describes the snapshot rather than the player, so it travels with the
  // rest of the provenance instead of sitting in a panel of their figures.
  assert.equal(mapped.season, 34);
  // It is consumed, so it is not counted as an unlabelled value.
  assert.equal(mapped.undecoded, 0);
});

test('release-slot codenames resolve to the hero that shipped in that slot', () => {
  // The matches-played family tags each hero with its release slot, and those
  // slots run in release order: H023-H026 are Year 3 Seasons 1-4 (Black Prior,
  // Hitokiri, Jormungandr, Zhanhu) and H029 is Year 5 Season 2 (Kyoshin). The
  // faction each codename carries matches, and so does the codename's meaning
  // (Hitokiri literally means "manslayer"; Kyoshin fights masked).
  const mapped = mapForHonorStats({
    'MatchesPlayedperHero.Hero.Hero_KnightH023Darkwarden': s(889),
    'MatchesPlayedperHero.Hero.Hero_SamuraiH024Manslayer': s(89),
    'MatchesPlayedperHero.Hero.Hero_VikingH025Zealot': s(501),
    'MatchesPlayedperHero.Hero.Hero_ChineseH026Betrayer': s(403),
    'MatchesPlayedperHero.Hero.Hero_SamuraiH029Faceless': s(361),
  });
  const byName = (n: string) => mapped.heroes.find((h) => h.name === n);
  assert.equal(byName('Black Prior')?.matches, 889);
  assert.equal(byName('Hitokiri')?.matches, 89);
  assert.equal(byName('Jormungandr')?.matches, 501);
  assert.equal(byName('Zhanhu')?.matches, 403);
  assert.equal(byName('Kyoshin')?.matches, 361);
  // Every one resolves, so no raw codename is left showing.
  for (const hero of mapped.heroes) {
    assert.ok(hero.portraitUrl, `${hero.name} should resolve to a real hero with a portrait`);
  }
});

test('matches-played family merges onto a hero whose bare codename already matches its real name', () => {
  // Highlander, Gryphon and Medjay need no HERO_NAMES entry at all in the
  // level/reputation family — their bare codename already is their real
  // name. The matches-played family glues a release-slot marker onto that
  // same bare codename ("VikingDLC2Highlander", "KnightH028Gryphon"), which
  // once produced a bogus second row ("DLC2Highlander") instead of merging
  // into the existing one.
  const mapped = mapForHonorStats({
    HeroHighlanderReputation: s(33),
    'MatchesPlayedperHero.Hero.Hero_VikingDLC2Highlander': s(1439),
    'MatchesPlayedperHero.Hero.Hero_KnightH028Gryphon': s(399),
  });
  assert.equal(mapped.heroes.length, 2);
  const highlander = mapped.heroes.find((h) => h.name === 'Highlander');
  assert.ok(highlander, 'no separate "DLC2Highlander" row is created');
  assert.equal(highlander.reputation, 33);
  assert.equal(highlander.matches, 1439);
  const gryphon = mapped.heroes.find((h) => h.name === 'Gryphon');
  assert.ok(gryphon, 'a matches-only entry still resolves its slot-stripped bare name');
  assert.equal(gryphon.faction, 'Knights');
  assert.equal(gryphon.matches, 399);
});

test('player-confirmed codenames: Titan is Juren and Brawler is Arakure', () => {
  // The two newest heroes appear only on the live crossplay space, and they
  // carry a codename of their own in the matches-played family. Confirmed by
  // the player against their own in-game roster.
  const mapped = mapForHonorStats({
    'MatchesPlayedperHero.Hero.Hero_ChineseTitan': s(217),
    'MatchesPlayedperHero.Hero.Hero_SamuraiBrawler': s(130),
  });
  const juren = mapped.heroes.find((h) => h.name === 'Juren');
  assert.ok(juren, 'Titan resolves to Juren, not a raw codename row');
  assert.equal(juren.faction, 'Wu Lin');
  assert.equal(juren.matches, 217);
  assert.ok(juren.portraitUrl, 'Juren resolves against the roster, so it has a portrait');

  const arakure = mapped.heroes.find((h) => h.name === 'Arakure');
  assert.ok(arakure, 'Brawler resolves to Arakure');
  assert.equal(arakure.faction, 'Samurai');
  assert.equal(arakure.matches, 130);
  assert.ok(arakure.portraitUrl);
});

test('matches played and won are broken out per game mode, with named modes only', () => {
  const mapped = mapForHonorStats({
    'MatchesPlayedpergamemode.S_Type.DMN': s(1367),
    'MatchesWonpergamemode.T_Win.1.S_Type.DMN': s(995),
    'MatchesPlayedpergamemode.S_Type.DL': s(928),
    'MatchesWonpergamemode.T_Win.1.S_Type.DL': s(722),
  });
  // Sorted by matches played, so Dominion leads.
  assert.deepEqual(
    mapped.gameModes.map((m) => m.mode),
    ['Dominion', 'Duel'],
  );
  const dominion = mapped.gameModes[0];
  assert.equal(dominion.matches, 1367);
  assert.equal(dominion.wins, 995);
  assert.equal(dominion.losses, 1367 - 995);
  assert.equal(dominion.played, true);
  // Per-mode figures are exact counts, not achievement-derived lower bounds.
  assert.ok(!dominion.confirmedMinimum);

  // Every consumed key is accounted for, so none is counted as unlabelled.
  assert.equal(mapped.undecoded, 0);
});

test('an unnamed game-mode code is never shown under a guessed mode name', () => {
  const mapped = mapForHonorStats({
    'MatchesPlayedpergamemode.S_Type.ZZZ': s(40),
    'MatchesWonpergamemode.T_Win.1.S_Type.ZZZ': s(9),
  });
  assert.deepEqual(mapped.gameModes, []);
});

test('win rate is computed from the per-mode counters, not from mismatched lifetime totals', () => {
  // Confirmed live: "MatchesWonwithanyHero" and "GamesPlayedPVP" do not share
  // a scope — dividing one by the other reported an 8% win rate for a player
  // who actually wins roughly three quarters of their games. The per-mode
  // counters do share a scope, so the rate comes from those.
  const mapped = mapForHonorStats({
    GamesPlayedPVP: s(21953),
    'MatchesWonwithanyHero.T_Win.1': s(1813),
    'MatchesPlayedpergamemode.S_Type.DMN': s(1367),
    'MatchesWonpergamemode.T_Win.1.S_Type.DMN': s(995),
    'MatchesPlayedpergamemode.S_Type.DL': s(928),
    'MatchesWonpergamemode.T_Win.1.S_Type.DL': s(722),
  });
  const matches = mapped.extraGroups.find((group) => group.key === 'matches-by-type');
  const winRate = matches?.stats.find((x) => x.key === 'win-rate');
  assert.equal(winRate?.value, Math.round(((995 + 722) / (1367 + 928)) * 1000) / 10);
  assert.match(String(winRate?.note), /Dominion and Duel/);
  // The lifetime wins figure is still shown as its own count, just never as a rate.
  assert.equal(matches?.stats.find((x) => x.key === 'wins')?.value, 1813);
});

test('with no per-mode counters there is no win rate, rather than a wrong one', () => {
  const mapped = mapForHonorStats({
    GamesPlayedPVP: s(21953),
    'MatchesWonwithanyHero.T_Win.1': s(1813),
  });
  const matches = mapped.extraGroups.find((group) => group.key === 'matches-by-type');
  const winRate = matches?.stats.find((x) => x.key === 'win-rate');
  assert.equal(winRate?.value, null);
  assert.equal(winRate?.note, undefined);
});

test('Ubisoft\u2019s own stat-card labels name the heroes, overriding the codename table', () => {
  // The stat card carries the publisher's player-facing label for every stat,
  // one per hero. Where it disagrees with this file's table, it wins: it is
  // Ubisoft naming its own codenames rather than an inference about them.
  const cards = [
    { statName: 'HeroKnightChampionReputation', displayName: 'Warden Reputation', lastModified: '2026-08-29T22:12:24.157Z' },
    // Possessive labels appear for some heroes and must not survive into the name.
    { statName: 'HeroAztecReputation', displayName: 'Ocelotl\u2019s Reputation', lastModified: '2026-06-30T17:30:48.735Z' },
  ];
  const facts = heroFactsFromStatCard(cards);
  assert.equal(facts.get('KnightChampion')?.name, 'Warden');
  assert.equal(facts.get('Aztec')?.name, 'Ocelotl');

  const mapped = mapForHonorStats(
    { HeroKnightChampionReputation: s(25), HeroAztecReputation: s(17) },
    facts,
  );
  const warden = mapped.heroes.find((h) => h.name === 'Warden');
  assert.ok(warden);
  // The label also says when that hero was last played.
  assert.equal(warden.lastPlayedAt, Date.parse('2026-08-29T22:12:24.157Z'));
  assert.ok(mapped.heroes.find((h) => h.name === 'Ocelotl'));
});

test('a hero the codename table has never seen still gets its real name from the stat card', () => {
  const facts = heroFactsFromStatCard([
    { statName: 'HeroSomeFutureHeroReputation', displayName: 'Nightblade Reputation' },
  ]);
  const mapped = mapForHonorStats({ HeroSomeFutureHeroReputation: s(2) }, facts);
  assert.equal(mapped.heroes[0].name, 'Nightblade');
});

test('the roster\u2019s name is kept when Ubisoft\u2019s label is a shorter form of it', () => {
  // Ubisoft labels this hero "Varangian"; the roster (and the game's menus)
  // say "Varangian Guard", and only that form has a portrait.
  const facts = heroFactsFromStatCard([
    { statName: 'HeroVarangianReputation', displayName: 'Varangian Reputation' },
  ]);
  const mapped = mapForHonorStats({ HeroVarangianReputation: s(20) }, facts);
  assert.equal(mapped.heroes[0].name, 'Varangian Guard');
  assert.ok(mapped.heroes[0].portraitUrl);
});

test('first and last played come from the stat card\u2019s own timestamps', () => {
  const range = playedRangeFromStatCard([
    { statName: 'CampaignProgression', startDate: '2016-10-29T00:43:00.000Z', lastModified: '2025-09-11T16:26:46.962Z' },
    { statName: 'Reputation', startDate: '2016-10-29T00:45:00.000Z', lastModified: '2026-08-31T17:31:43.196Z' },
    { statName: 'KillTotal', startDate: '2016-10-29T01:08:00.000Z', lastModified: '2026-08-31T17:31:43.196Z' },
  ]);
  assert.equal(range.firstPlayedAt, Date.parse('2016-10-29T00:43:00.000Z'));
  assert.equal(range.lastPlayedAt, Date.parse('2026-08-31T17:31:43.196Z'));

  // Nothing usable in, nothing invented out.
  assert.deepEqual(playedRangeFromStatCard([]), { firstPlayedAt: null, lastPlayedAt: null });
  assert.deepEqual(playedRangeFromStatCard([{ statName: 'X', startDate: '', lastModified: null }]), {
    firstPlayedAt: null,
    lastPlayedAt: null,
  });
});

test('play sessions and average session come from the play-history count', () => {
  // Ubisoft's stats dictionary has no session count; the play-history endpoint
  // does, and it is the only thing that makes an average session computable.
  const mapped = mapForHonorStats(
    { TimePlayedTotal: s(12524120), GamesPlayedPVP: s(21953) },
    new Map(),
    2674,
  );
  const playtime = mapped.extraGroups.find((group) => group.key === 'playtime');
  const val = (k: string) => playtime?.stats.find((x) => x.key === k)?.value;
  assert.equal(val('sessions'), 2674);
  assert.equal(val('avg-session'), Math.round((12524120 / 2674 / 60) * 10) / 10);

  // Without a session count neither figure is invented.
  const without = mapForHonorStats({ TimePlayedTotal: s(12524120), GamesPlayedPVP: s(21953) });
  const plain = without.extraGroups.find((group) => group.key === 'playtime');
  assert.equal(plain?.stats.find((x) => x.key === 'sessions')?.value, null);
  assert.equal(plain?.stats.find((x) => x.key === 'avg-session')?.value, null);
});

test('the headline figures find a stat wherever its section moved to', () => {
  // The header picks its tiles by key. Win rate lives in the matches section,
  // not in combat or overview, and a lookup that only searched those two
  // rendered an empty tile for it on every page.
  const mapped = mapForHonorStats({
    'MatchesPlayedpergamemode.S_Type.DMN': s(1368),
    'MatchesWonpergamemode.T_Win.1.S_Type.DMN': s(996),
    KillTotal: s(81202),
    Reputation: s(697),
  });
  const everyGroup = [
    { stats: mapped.overview },
    { stats: mapped.overall },
    ...mapped.extraGroups,
  ];
  for (const key of ['reputation', 'kills', 'win-rate']) {
    const found = everyGroup.flatMap((group) => group.stats).find((stat) => stat.key === key);
    assert.ok(found, `${key} exists somewhere in the report`);
    assert.notEqual(found.value, null, `${key} has a value`);
  }
});

test('an older space fills gaps only; it never overrides the current snapshot', () => {
  // A player who predates crossplay has stats in two spaces and only one is
  // still written to. Reading just the freshest threw away anything the older
  // snapshot held and the newer one did not — but combining them figure by
  // figure is worse: the two spaces are separate records, not a subset and a
  // superset, so taking the larger of each produced a Dominion win rate that
  // was the ratio of no real scope at all.
  const live: RawStats = {
    MetaGameSeason: { value: '38' },
    Reputation: { value: '697' },
    'MatchesPlayedpergamemode.S_Type.DMN': { value: '1368' },
    'MatchesWonpergamemode.T_Win.1.S_Type.DMN': { value: '996' },
    Faction: { value: 'vk' },
  };
  const frozen: RawStats = {
    MetaGameSeason: { value: '34' },
    Reputation: { value: '441' },
    // Higher than the live figure, and must not win: pairing it with the live
    // win count would invent a rate neither space reports.
    'MatchesPlayedpergamemode.S_Type.DMN': { value: '1600' },
    'MatchesWonpergamemode.T_Win.1.S_Type.DMN': { value: '900' },
    // Only the old space knows about this hero.
    HeroKnightChampionReputation: { value: '9' },
    Faction: { value: 'kn' },
  };

  const merged = mergeSpaceStats([live, frozen]);
  assert.equal(merged.Reputation.value, '697');
  assert.equal(merged.MetaGameSeason.value, '38');
  assert.equal(merged.Faction.value, 'vk');
  // The pair stays internally consistent, so the derived rate stays true.
  assert.equal(merged['MatchesPlayedpergamemode.S_Type.DMN'].value, '1368');
  assert.equal(merged['MatchesWonpergamemode.T_Win.1.S_Type.DMN'].value, '996');
  const rate = mapForHonorStats(merged).extraGroups
    .find((group) => group.key === 'matches-by-type')
    ?.stats.find((stat) => stat.key === 'win-rate')?.value;
  assert.equal(rate, Math.round((996 / 1368) * 1000) / 10);

  // The hero only the old space knows about still survives.
  assert.equal(merged.HeroKnightChampionReputation.value, '9');

  assert.deepEqual(mergeSpaceStats([]), {});
});

test('the campaign figures are labelled for what Ubisoft actually stores', () => {
  // CampaignLastMissionCompleted is the index of the last mission finished,
  // not a count of missions finished, and it was labelled as the latter.
  const mapped = mapForHonorStats({
    CampaignProgression: s(1),
    CampaignLastMissionCompleted: s(0),
  });
  const labels = Object.fromEntries(mapped.overview.map((x) => [x.key, x.label]));
  assert.equal(labels.campaign, 'Completion');
  assert.equal(labels['campaign-mission'], 'Last mission');
});

test('a section that needs explaining carries its explanation', () => {
  // These read as bare numbers otherwise: a matchmaking rating is not the
  // in-game rank, and "war assets deployed" means nothing without the Faction
  // War. Each section says so itself rather than relying on the label.
  const mapped = mapForHonorStats({
    SkillRatingDuelMu: s(46),
    MetaGameManualDeployCount: s(572),
  });
  const explained = (key: string) =>
    mapped.extraGroups.find((group) => group.key === key)?.explanation ?? '';
  assert.match(explained('matchmaking'), /not the Ranked Duel rank/i);
  assert.match(explained('faction-war'), /Knights, Vikings, Samurai and Wu Lin/);
});

test('every achievement-derived figure is flagged as a floor, not a total', () => {
  // These are thresholds a player has passed, so each is a lower bound. The
  // note said so in words; the flag is what makes the UI mark it, and the
  // Steam-only path renders the same figures through a different component.
  const unlocked = unlockedSet([
    { apiName: 'forhonor_ach_29', unlocked: true },
    { apiName: 'forhonor_ach_18', unlocked: true },
    { apiName: 'forhonor_ach_49', unlocked: true },
    { apiName: 'forhonor_ach_11', unlocked: true },
  ]);
  for (const stat of [
    ...deriveCombat(unlocked),
    ...deriveFactionWar(unlocked),
    ...deriveReputation(unlocked),
  ]) {
    assert.equal(stat.minimum, true, `${stat.label} is flagged as a minimum`);
  }

  // Story is mixed on purpose. The level comes from a threshold, so it is a
  // floor; the chapter count and the cleared difficulty each have one
  // achievement apiece, so those are exact and must not be marked.
  const story = Object.fromEntries(deriveStory(unlocked).map((x) => [x.key, x]));
  assert.equal(story['story-level'].minimum, true);
  assert.equal(story['story-chapters'].minimum, undefined);
  assert.equal(story['story-difficulty'].minimum, undefined);
  // And the values really are the thresholds crossed.
  const combat = Object.fromEntries(deriveCombat(unlocked).map((x) => [x.label, x.value]));
  assert.equal(combat['Soldiers killed'], 5000);
  assert.equal(combat['Ledge kills'], 50);
});

test('a platform profile resolves to the account the stats hang off', () => {
  // Ubisoft keeps one profile per platform and one account behind them all,
  // and For Honor's stats hang off the account. A search matched on Steam,
  // PSN or Xbox returns that platform's profileId, which owns no game — so
  // searching a SteamID64 found the right person and showed nothing at all.
  // The account is the `userId` every one of those profiles carries.
  const profile = {
    profileId: '53faee1e-71d6-44ac-81f8-7d31c9b94755',
    userId: '64ae8a84-3e0d-4bf0-a4de-cd743b4d70ce',
    platformType: 'steam',
    idOnPlatform: '76561190000000000',
    nameOnPlatform: '76561190000000000',
  };
  assert.equal(profile.userId || profile.profileId, '64ae8a84-3e0d-4bf0-a4de-cd743b4d70ce');
  // And an older response with no userId still resolves to something usable.
  const legacy = { profileId: 'abc', userId: '' };
  assert.equal(legacy.userId || legacy.profileId, 'abc');
});

test('figures format the same on the server and in the browser', () => {
  // toLocaleString() with no locale takes the runtime's, which is Node's on
  // the server and the browser's on the client. Those disagree — 22,460
  // against 22.460 — and React reports the difference as a hydration
  // mismatch for any visitor whose browser is not set to English.
  const stat = { key: 'k', label: 'Kills', value: 81202, kind: 'number' as const };
  assert.equal(formatStatValue(stat), '81,202');
  assert.equal(formatStatValue({ ...stat, value: 74.85, kind: 'percent' }), '74.9%');
  assert.equal(formatStatValue({ ...stat, value: 1.5, kind: 'ratio' }), '1.50');
  assert.equal(LOCALE, 'en-US');
});

/**
 * Ubisoft's own hero labels, read from its stat card for an account that owns
 * every hero. This is the table the tracker falls back to when the stat card
 * is unavailable, so it has to agree with it — and one pair in it did not,
 * which is the whole reason this list is written down.
 */
const UBISOFT_HERO_LABELS: Array<[codename: string, name: string]> = [
  ['KnightChampion', 'Warden'],
  ['KnightTank', 'Conqueror'],
  ['KnightAssassin', 'Peacekeeper'],
  ['KnightHybrid', 'Lawbringer'],
  ['KnightWarmonger', 'Warmonger'],
  ['KnightVortiger', 'Black Prior'],
  ['KnightGladiator', 'Gladiator'],
  ['KnightCenturion', 'Centurion'],
  ['Gryphon', 'Gryphon'],
  ['VikingChampion', 'Raider'],
  ['VikingTank', 'Warlord'],
  ['VikingAssassin', 'Berserker'],
  ['VikingHybrid', 'Valkyrie'],
  ['VikingHighlander', 'Highlander'],
  ['VikingHuntress', 'Shaman'],
  ['VikingHulda', 'Jormungandr'],
  ['SamuraiChampion', 'Kensei'],
  ['SamuraiTank', 'Shugoki'],
  ['SamuraiAssassin', 'Orochi'],
  ['SamuraiHybrid', 'Nobushi'],
  ['SamuraiNinja', 'Shinobi'],
  ['SamuraiRonin', 'Aramusha'],
  ['SamuraiSakura', 'Hitokiri'],
  ['SamuraiKyoshin', 'Kyoshin'],
  ['Benkei', 'Sohei'],
  ['Arakure', 'Arakure'],
  ['ChineseGeneral', 'Tiandi'],
  ['ChineseOldMaster', 'Jiang Jun'],
  ['ChineseBodyguard', 'Nuxia'],
  ['ChineseShaolin', 'Shaolin'],
  ['ChineseSunDa', 'Zhanhu'],
  ['Juren', 'Juren'],
  ['PirateQueen', 'Pirate'],
  ['OutlanderMedjay', 'Medjay'],
  ['Gazelle', 'Afeera'],
  ['Aztec', 'Ocelotl'],
  ['Khatun', 'Khatun'],
  ['Virtuosa', 'Virtuosa'],
];

test('the codename table agrees with Ubisoft on every hero it names', () => {
  // Without the stat card — this is exactly the fallback path, and the point
  // is that it must not disagree with the source it stands in for.
  for (const [codename, name] of UBISOFT_HERO_LABELS) {
    const hero = mapForHonorStats({ [`Hero${codename}Reputation`]: s(3) }).heroes[0];
    assert.ok(hero, `${codename} resolves to a hero`);
    assert.equal(hero.name, name, `${codename} is ${name}`);
    assert.ok(hero.faction, `${name} has a faction`);
    assert.ok(hero.portraitUrl, `${name} has a portrait`);
  }
});

test('Varangian keeps the roster\u2019s fuller name', () => {
  // Ubisoft's label is "Varangian"; the game's own menus, the roster and the
  // portrait file all say "Varangian Guard", so the longer name wins here.
  const hero = mapForHonorStats({ HeroVarangianReputation: s(20) }).heroes[0];
  assert.equal(hero.name, 'Varangian Guard');
  assert.ok(hero.portraitUrl);
});

test('the table covers a whole roster without collisions', () => {
  // Feeding every codename at once must produce one row each: a duplicate
  // mapping would silently merge two heroes into one.
  const stats: Record<string, { value: string }> = {};
  for (const [codename] of UBISOFT_HERO_LABELS) stats[`Hero${codename}Reputation`] = s(2);
  const mapped = mapForHonorStats(stats);
  assert.equal(mapped.heroes.length, UBISOFT_HERO_LABELS.length);
  assert.equal(new Set(mapped.heroes.map((h) => h.name)).size, UBISOFT_HERO_LABELS.length);
});

test('a Ubisoft report shows only figures Ubisoft reports', () => {
  // Achievement thresholds are real lower bounds, but "at least 20 Brawl wins"
  // says nothing useful about a player with three thousand, and standing it
  // beside exact counts invites it to be read as one. The mapper is the only
  // thing that builds a Ubisoft report's stats, and it never sees an
  // achievement — so every figure it produces came from the stats dictionary.
  const mapped = mapForHonorStats({
    KillTotal: s(81202),
    'MatchesPlayedpergamemode.S_Type.DMN': s(1368),
    'MatchesWonpergamemode.T_Win.1.S_Type.DMN': s(996),
    MetaGameManualDeployCount: s(572),
    CampaignProgression: s(1),
  });

  const everyStat = [
    ...mapped.overview,
    ...mapped.overall,
    ...mapped.extraGroups.flatMap((group) => group.stats),
  ];
  for (const stat of everyStat) {
    assert.notEqual(stat.minimum, true, `${stat.label} is an exact figure, not a floor`);
    assert.ok(
      !/at least/i.test(stat.note ?? ''),
      `${stat.label} does not describe itself as a lower bound`,
    );
  }
  // Nor is any mode marked as achievement-derived.
  for (const mode of mapped.gameModes) {
    assert.notEqual(mode.confirmedMinimum, true, `${mode.mode} is an exact count`);
    assert.equal(mode.evidence, undefined);
  }
  // Only the modes Ubisoft actually counts.
  assert.deepEqual(
    mapped.gameModes.map((mode) => mode.mode),
    ['Dominion'],
  );
});

test('a player\u2019s platform handles never survive into a retained body', () => {
  // Confirmed live before this was fixed: the public player API accepted
  // ?diagnostics=1 with no token and returned the upstream bodies behind the
  // lookup, including the searched player's PSN id, Xbox gamertag, Discord tag
  // and SteamID64 — exactly what the report itself withholds. The route is
  // token-gated now; this is the second line of defence.
  const body = JSON.stringify({
    profiles: [
      { profileId: 'x', platformType: 'uplay', idOnPlatform: 'x', nameOnPlatform: 'TestDuelist' },
      { profileId: 'y', platformType: 'psn', idOnPlatform: '1000000000000000001', nameOnPlatform: 'SamplePlayer' },
      { profileId: 'z', platformType: 'discord', idOnPlatform: '100000000000000001', nameOnPlatform: 'SamplePlayer#0001' },
    ],
  });
  const out = redactBody(body);
  assert.doesNotMatch(out, /SamplePlayer/);
  assert.doesNotMatch(out, /1000000000000000001/);
  assert.doesNotMatch(out, /100000000000000001/);
  // The platform names themselves are game information and stay.
  assert.match(out, /psn/);
  assert.match(out, /discord/);
});

test('a console handle is shown, a contact handle and an account key are not', () => {
  // Ubisoft returns one profile per linked platform, each with a handle, and
  // they are not the same kind of thing. A PSN online id and an Xbox gamertag
  // are gaming identities — the name on the scoreboard. A Discord tag reaches
  // someone off the game, and a SteamID64 is an account key.
  const { links } = platformProfiles([
    { platformType: 'uplay', idOnPlatform: 'u', nameOnPlatform: 'TestDuelist' },
    { platformType: 'psn', idOnPlatform: '1000000000000000001', nameOnPlatform: 'SamplePlayer' },
    { platformType: 'xbl', idOnPlatform: '2500000000000001', nameOnPlatform: 'Sample Player' },
    { platformType: 'steam', idOnPlatform: '76561190000000000', nameOnPlatform: '76561190000000000' },
    { platformType: 'discord', idOnPlatform: '100000000000000001', nameOnPlatform: 'SamplePlayer#0001' },
  ]);
  const handle = (id: string) => links.find((link) => link.id === id)?.handle;

  assert.equal(handle('psn'), 'SamplePlayer');
  assert.equal(handle('xbl'), 'Sample Player');
  // Shown as platforms, but with no handle beside them.
  assert.equal(handle('uplay'), undefined);
  assert.equal(handle('steam'), undefined);
  // Discord is not a platform the game is played on, so it is not listed here
  // at all — neither its name nor its tag.
  assert.equal(
    links.find((link) => link.id === 'discord'),
    undefined,
  );
  assert.doesNotMatch(JSON.stringify(links), /0001|100000000000000001|76561190000000000/);
});

test('every listed platform carries a name a reader recognises', () => {
  const { links } = platformProfiles([
    { platformType: 'psn', nameOnPlatform: 'SamplePlayer' },
    { platformType: 'xbl', nameOnPlatform: 'Sample Player' },
    { platformType: 'uplay', nameOnPlatform: 'TestDuelist' },
    { platformType: 'amazonstream', nameOnPlatform: 'x' },
  ]);
  assert.deepEqual(
    links.map((link) => link.label),
    ['PlayStation', 'Xbox', 'Ubisoft Connect', 'Amazon Luna'],
  );
  // An unknown platform type is dropped rather than shown by its raw key.
  assert.equal(platformProfiles([{ platformType: 'stadia', nameOnPlatform: 'n' }]).links.length, 0);
});

test('an empty or numeric handle is not printed as a gamertag', () => {
  // The field comes back for every profile whether or not it holds a name.
  assert.equal(cleanHandle(''), null);
  assert.equal(cleanHandle('   '), null);
  assert.equal(cleanHandle(undefined), null);
  // Steam's is the 17-digit id restated; that is not what anyone is called.
  assert.equal(cleanHandle('76561190000000000'), null);
  assert.equal(cleanHandle('  SamplePlayer  '), 'SamplePlayer');
  // A name that is mostly digits is still a name.
  assert.equal(cleanHandle('123_xX'), '123_xX');
});

test('one chip per platform, and a blank duplicate does not erase the handle', () => {
  // An account can carry more than one profile row for the same platform.
  const { links } = platformProfiles([
    { platformType: 'psn', nameOnPlatform: 'SamplePlayer' },
    { platformType: 'psn', nameOnPlatform: '' },
  ]);
  assert.equal(links.length, 1);
  assert.equal(links[0].handle, 'SamplePlayer');
});

test('the account name and Steam id are still read for their own uses', () => {
  const parsed = platformProfiles([
    { platformType: 'uplay', nameOnPlatform: 'TestDuelist' },
    { platformType: 'steam', idOnPlatform: '76561190000000000' },
  ]);
  // The Ubisoft Connect name titles the page for a cross-platform lookup.
  assert.equal(parsed.accountName, 'TestDuelist');
  // The Steam id is the join to public achievements, server-side only.
  assert.equal(parsed.steamId64, '76561190000000000');
  // A malformed id is not passed on to Steam.
  assert.equal(platformProfiles([{ platformType: 'steam', idOnPlatform: '123' }]).steamId64, null);
});
