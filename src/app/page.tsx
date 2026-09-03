import { SearchForm } from '@/components/SearchForm';

/** What the tracker actually shows, said in the terms a player would use. */
const HIGHLIGHTS: { title: string; body: string }[] = [
  {
    title: 'Every hero you play',
    body: 'Reputation, level, hours, matches and when you last played each one — all 39, searchable and sortable, with the faction you actually main.',
  },
  {
    title: 'How you fight',
    body: 'Kills, deaths, K/D and assists, as totals and per match, with win rates broken out by game mode rather than blended into one number.',
  },
  {
    title: 'The whole record',
    body: 'When you started, when you last played, hours against real players, sessions, matchmaking ratings and Faction War deployments.',
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
      <section className="flex flex-col items-center py-20 text-center sm:py-28">
        <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-6xl">
          For Honor Tracker
        </h1>
        <p className="mt-5 max-w-xl text-sm leading-relaxed text-ink-dim sm:text-base">
          Look up any player&rsquo;s full For Honor record. No account, no sign-in — just a name.
        </p>

        <div className="mt-9 w-full max-w-2xl">
          <SearchForm />
          <p className="mt-3 text-center text-xs text-ink-faint">
            A Ubisoft Connect username, spelled exactly as it appears in game.
          </p>
        </div>
      </section>

      <section className="pb-20">
        <div className="grid gap-3 sm:grid-cols-3">
          {HIGHLIGHTS.map((item) => (
            <article key={item.title} className="card p-5">
              <h2 className="text-base font-semibold text-ink">{item.title}</h2>
              <p className="mt-2.5 text-sm leading-relaxed text-ink-dim">{item.body}</p>
            </article>
          ))}
        </div>
        <p className="mt-6 text-center text-xs leading-relaxed text-ink-faint">
          Figures come from Ubisoft&rsquo;s own service, which updates on its own schedule, so very
          recent play can lag. Achievements come from a linked Steam profile where there is one.
        </p>
      </section>
    </div>
  );
}
