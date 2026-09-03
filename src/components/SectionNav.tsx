/**
 * Sticky jump links across the page's sections. On a dashboard this long,
 * reaching the roster or the mode record should not mean scrolling past
 * everything in between.
 */
export function SectionNav({ items }: { items: { id: string; label: string; count?: number }[] }) {
  if (items.length < 2) return null;
  return (
    <nav
      aria-label="Jump to section"
      className="sticky top-0 z-20 -mx-4 mt-4 border-y border-line bg-canvas/85 px-4 py-2.5 backdrop-blur-md sm:-mx-6 sm:px-6"
    >
      <ul className="flex flex-wrap items-center gap-2">
        {items.map((item) => (
          <li key={item.id}>
            <a href={`#${item.id}`} className="chip">
              {item.label}
              {item.count === undefined ? null : (
                <span className="numeral text-ink-faint">{item.count}</span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
