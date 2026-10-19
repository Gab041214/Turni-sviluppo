import { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Riquadro di sola consultazione: i giorni del mese con straordinario e le relative ore, con il
 * totale in fondo. Si espande sotto la testata, con lo stesso stile e la stessa animazione delle
 * finestre "Modifica" e "Straordinario"; si chiude toccando l'intestazione. Il PDF si genera dal
 * menu Impostazioni.
 */
export function MonthOvertimePanel({
  onClose,
  subtitle,
  rows,
  total,
}: {
  onClose: () => void;
  subtitle: string;
  rows: { label: string; hours: string }[];
  total: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Su schermi bassi il riquadro aperto può finire sotto il bordo: lo porta in vista solo se serve.
  useEffect(() => {
    const t = setTimeout(() => ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 230);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      ref={ref}
      className="mx-auto mt-3 w-full max-w-[440px] rounded-2xl border border-border/60 bg-background p-5 shadow-lg animate-in fade-in-0 slide-in-from-top-2 duration-200 motion-reduce:animate-none"
    >
      <button
        type="button"
        onClick={onClose}
        aria-expanded
        className="flex w-full items-center justify-between gap-2 rounded-md text-left text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <h3 className="text-lg font-semibold">Straordinari del mese</h3>
        <ChevronDown className="size-5 shrink-0 rotate-180" />
      </button>

      <div className="mt-1 flex flex-col gap-3">
        <div className="text-base text-muted-foreground">{subtitle}</div>

        {rows.length > 0 ? (
          <>
            <ul className="rounded-xl px-3 py-1" style={{ backgroundColor: "var(--app-chip)" }}>
              {rows.map((r, i) => (
                <li
                  key={r.label}
                  className={
                    "flex min-h-11 items-center justify-between text-base text-foreground" +
                    (i > 0 ? " border-t border-border/60" : "")
                  }
                >
                  <span>{r.label}</span>
                  <span className="font-semibold">{r.hours}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between px-3">
              <span className="text-base font-semibold text-foreground">Totale</span>
              <span className="text-[22px] font-bold text-foreground">{total}</span>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Nessuno straordinario in questo mese.</p>
        )}
      </div>
    </div>
  );
}
