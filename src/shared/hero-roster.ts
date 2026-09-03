/**
 * The full For Honor hero roster: every hero's faction and portrait.
 *
 * This is the authority the tracker uses to (a) give every hero a faction —
 * Ubisoft's stat feed does not always carry one — and (b) show a portrait next
 * to each hero. Portraits are the operator's own images, served from public
 * storage, so nothing is hotlinked from a third party at render time.
 *
 * Pure data, no I/O, safe to import from server and client alike.
 */

const PORTRAIT_BASE =
  'https://xjfexrlejdkssnwkljet.supabase.co/storage/v1/object/public/hero-images';

export interface RosterHero {
  name: string;
  faction: string;
  slug: string;
}

// name, faction, slug — grouped by faction for readability.
const ROSTER: RosterHero[] = [
  // Knights
  { name: 'Warden', faction: 'Knights', slug: 'warden' },
  { name: 'Conqueror', faction: 'Knights', slug: 'conqueror' },
  { name: 'Peacekeeper', faction: 'Knights', slug: 'peacekeeper' },
  { name: 'Lawbringer', faction: 'Knights', slug: 'lawbringer' },
  { name: 'Warmonger', faction: 'Knights', slug: 'warmonger' },
  { name: 'Black Prior', faction: 'Knights', slug: 'black-prior' },
  { name: 'Gladiator', faction: 'Knights', slug: 'gladiator' },
  { name: 'Centurion', faction: 'Knights', slug: 'centurion' },
  { name: 'Gryphon', faction: 'Knights', slug: 'gryphon' },
  // Vikings
  { name: 'Raider', faction: 'Vikings', slug: 'raider' },
  { name: 'Warlord', faction: 'Vikings', slug: 'warlord' },
  { name: 'Berserker', faction: 'Vikings', slug: 'berserker' },
  { name: 'Valkyrie', faction: 'Vikings', slug: 'valkyrie' },
  { name: 'Highlander', faction: 'Vikings', slug: 'highlander' },
  { name: 'Shaman', faction: 'Vikings', slug: 'shaman' },
  { name: 'Jormungandr', faction: 'Vikings', slug: 'jormungandr' },
  { name: 'Varangian Guard', faction: 'Vikings', slug: 'varangian-guard' },
  // Samurai
  { name: 'Kensei', faction: 'Samurai', slug: 'kensei' },
  { name: 'Shugoki', faction: 'Samurai', slug: 'shugoki' },
  { name: 'Orochi', faction: 'Samurai', slug: 'orochi' },
  { name: 'Nobushi', faction: 'Samurai', slug: 'nobushi' },
  { name: 'Aramusha', faction: 'Samurai', slug: 'aramusha' },
  { name: 'Hitokiri', faction: 'Samurai', slug: 'hitokiri' },
  { name: 'Shinobi', faction: 'Samurai', slug: 'shinobi' },
  { name: 'Kyoshin', faction: 'Samurai', slug: 'kyoshin' },
  { name: 'Sohei', faction: 'Samurai', slug: 'sohei' },
  { name: 'Arakure', faction: 'Samurai', slug: 'arakure' },
  // Wu Lin
  { name: 'Tiandi', faction: 'Wu Lin', slug: 'tiandi' },
  { name: 'Jiang Jun', faction: 'Wu Lin', slug: 'jiang-jun' },
  { name: 'Nuxia', faction: 'Wu Lin', slug: 'nuxia' },
  { name: 'Shaolin', faction: 'Wu Lin', slug: 'shaolin' },
  { name: 'Zhanhu', faction: 'Wu Lin', slug: 'zhanhu' },
  { name: 'Juren', faction: 'Wu Lin', slug: 'juren' },
  // Outlanders
  { name: 'Medjay', faction: 'Outlanders', slug: 'medjay' },
  { name: 'Pirate', faction: 'Outlanders', slug: 'pirate' },
  { name: 'Afeera', faction: 'Outlanders', slug: 'afeera' },
  { name: 'Ocelotl', faction: 'Outlanders', slug: 'ocelotl' },
  { name: 'Khatun', faction: 'Outlanders', slug: 'khatun' },
  { name: 'Virtuosa', faction: 'Outlanders', slug: 'virtuosa' },
];

/** Normalize a hero name to a stable lookup key (case- and space-insensitive). */
function keyOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const BY_KEY = new Map(ROSTER.map((hero) => [keyOf(hero.name), hero]));

export interface HeroIdentity {
  faction: string;
  portraitUrl: string;
}

/** Look up a hero by display name, returning its faction and portrait URL. */
export function heroIdentity(name: string): HeroIdentity | null {
  const hero = BY_KEY.get(keyOf(name));
  if (!hero) return null;
  return { faction: hero.faction, portraitUrl: `${PORTRAIT_BASE}/${hero.slug}.jpg` };
}
