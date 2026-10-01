export interface CensusBar {
  key: string;
  label: string;
  value: number;
  /** CSS color of the bar (a tribe's token, or the secondary color for classes). */
  color: string;
}

/**
 * Horizontal bars for the census: 12 px tall, the count on the right. The width animates over the slow duration; the
 * global reduced-motion rule removes the animation. Each bar reads as "label: count" (never color alone).
 */
export function CensusBars({ title, bars }: { title: string; bars: CensusBar[] }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <section>
      <h3 className="mb-2 font-display">{title}</h3>
      <ul className="flex flex-col gap-1">
        {bars.map((bar) => (
          <li key={bar.key} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-2 text-sm">
            <span>{bar.label}</span>
            <span aria-hidden className="h-3 rounded-[4px] bg-surface">
              <span className="block h-3 rounded-[4px] transition-[width] duration-slow ease-out-soft" style={{ width: `${(bar.value / max) * 100}%`, background: bar.color }} />
            </span>
            <span className="text-right font-bold tabular-nums">{bar.value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
