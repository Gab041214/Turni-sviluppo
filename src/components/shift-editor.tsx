import { useEffect, useRef, useState } from "react";
import { ChevronDown, Minus, Undo2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { hasShiftOverride, type DayOverride } from "@/lib/overrides";
import {
  formatHours,
  minutesToTime,
  netMinutes,
  shiftWithOvertime,
  toMinutes,
  type DayData,
  type Overtime,
  type OvertimeSide,
} from "@/lib/shifts";

type Panel = "closed" | "edit" | "ot";
type ShiftDraft = { rest: boolean; start: string; end: string };
type OtDraft = { side: OvertimeSide | "all"; dur: string };

function draftFromShift(override: DayOverride | undefined, fileShift: DayData): ShiftDraft {
  if (override && hasShiftOverride(override)) {
    if (override.rest) return { rest: true, start: "", end: "" };
    return { rest: false, start: override.start ?? "", end: override.end ?? "" };
  }
  if (!fileShift) return { rest: false, start: "", end: "" };
  const s = toMinutes(fileShift.start);
  const e = toMinutes(fileShift.end);
  return {
    rest: false,
    start: s === null ? "" : minutesToTime(s),
    end: e === null ? "" : minutesToTime(e),
  };
}

/** Nuovo straordinario: durata a zero; lato "dopo" per i turni di apertura (inizio entro le 10:00), "prima" per gli altri. */
function otDraftFrom(ot: Overtime | undefined, ordinary: DayData): OtDraft {
  if (ot) return ot.side === "all" ? { side: "all", dur: "00:00" } : { side: ot.side, dur: minutesToTime(ot.min) };
  const start = ordinary ? toMinutes(ordinary.start) : null;
  return { side: start !== null && start <= 10 * 60 ? "after" : "before", dur: "00:00" };
}

const cardClass =
  "ios-card glass rounded-[28px] p-5";
const collapsedClass =
  "ios-card glass relative flex min-h-[60px] min-w-0 flex-1 items-center justify-between gap-1 rounded-[22px] pl-4 pr-3.5 text-left text-foreground disabled:opacity-40";
const inputClass =
  "box-border flex h-11 w-full min-w-0 max-w-full appearance-none items-center rounded-xl border border-border bg-clip-padding px-3 py-0 text-left text-[17px] leading-none text-foreground [-webkit-appearance:none] [&::-webkit-date-and-time-value]:m-0 [&::-webkit-date-and-time-value]:text-left";

/**
 * Finestre sotto "Apertura/Chiusura": "Modifica" (orario ordinario a mano) e "Straordinario"
 * (ore aggiunte prima o dopo l'ordinario). Chiuse stanno affiancate a metà larghezza; aprendone
 * una occupa tutta la larghezza e l'altra scompare. Va montata con una `key` diversa per ogni
 * giorno/nominativo, così riparte chiusa.
 */
export function DayEditPanels({
  subtitle,
  fileShift,
  ordinary,
  override,
  accent,
  accentText,
  onSaveShift,
  onResetShift,
  onSaveOvertime,
  onRemoveOvertime,
  onOpenChange,
}: {
  subtitle: string;
  /** Turno scritto nel file (null se il giorno è vuoto). */
  fileShift: DayData;
  /** Orario ordinario attuale (file o modificato a mano), senza straordinario; null se a riposo. */
  ordinary: DayData;
  override: DayOverride | undefined;
  accent: string;
  accentText: string;
  onSaveShift: (shift: ShiftDraft) => void;
  onResetShift: () => void;
  onSaveOvertime: (ot: Overtime) => void;
  onRemoveOvertime: () => void;
  /** Avvisa il pop-up quando un pannello si apre o si chiude (la scheda Apertura/Chiusura si riduce). */
  onOpenChange?: (open: boolean) => void;
}) {
  const [panel, setPanel] = useState<Panel>("closed");
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    onOpenChange?.(panel !== "closed");
    return () => onOpenChange?.(false);
  }, [panel, onOpenChange]);
  const [draft, setDraft] = useState<ShiftDraft>(() => draftFromShift(override, fileShift));
  const [otDraft, setOtDraft] = useState<OtDraft>(() => otDraftFrom(override?.ot, ordinary));

  const shiftModified = hasShiftOverride(override);
  const hasOt = !!override?.ot;
  const canOvertime = !!ordinary;

  const openEdit = () => {
    setDraft(draftFromShift(override, fileShift));
    setPanel("edit");
  };
  const openOt = () => {
    if (!canOvertime) return;
    setOtDraft(otDraftFrom(override?.ot, ordinary));
    setPanel("ot");
  };
  const close = () => setPanel("closed");

  if (panel === "closed") {
    return (
      <div className="flex gap-3.5">
        <button type="button" onClick={openEdit} aria-expanded={false} className={collapsedClass}>
          <span className="whitespace-nowrap text-base font-semibold">Modifica</span>
          {shiftModified && (
            <span
              role="img"
              aria-label="Turno modificato"
              className="absolute right-2 top-2 size-2 rounded-full"
              style={{ backgroundColor: accent }}
            />
          )}
          <ChevronDown className="size-4 shrink-0" />
        </button>
        <button
          type="button"
          onClick={openOt}
          disabled={!canOvertime}
          aria-expanded={false}
          className={collapsedClass}
        >
          <span className="whitespace-nowrap text-base font-semibold">Straordinario</span>
          {hasOt && (
            <span
              role="img"
              aria-label="Con straordinario"
              className="absolute right-2 top-2 size-2 rounded-full"
              style={{ backgroundColor: accent }}
            />
          )}
          <ChevronDown className="size-4 shrink-0" />
        </button>
      </div>
    );
  }

  if (panel === "edit") {
    const s = toMinutes(draft.start);
    const e = toMinutes(draft.end);
    const timesOk = s !== null && e !== null && draft.start !== draft.end;
    const valid = draft.rest || timesOk;
    const info = draft.rest
      ? "Il giorno resterà senza turno."
      : timesOk
        ? `Ore lavorate: ${formatHours(netMinutes(s, e))}`
        : "Inserisci inizio e fine del turno.";

    return (
      <div ref={cardRef} className={cardClass}>
        <button
          type="button"
          onClick={close}
          aria-expanded
          className="flex w-full items-center justify-between gap-2 rounded-md text-left text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <h3 className="text-lg font-semibold">Modifica turno</h3>
          <span className="inline-flex items-center gap-2.5">
            {shiftModified && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-2 rounded-full" style={{ backgroundColor: accent }} />
                Modificato
              </span>
            )}
            <ChevronDown className="size-5 shrink-0 rotate-180" />
          </span>
        </button>

        <div className="mt-1 flex flex-col gap-3">
          <div className="text-base text-muted-foreground">{subtitle}</div>

          <div className="flex min-h-11 items-center justify-between gap-3">
            <span id="shift-rest-label" className="text-[15px] text-foreground">
              Nessun turno (a riposo)
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={draft.rest}
              aria-labelledby="shift-rest-label"
              onClick={() => setDraft({ ...draft, rest: !draft.rest })}
              className="relative h-8 w-[52px] shrink-0 rounded-full"
              style={{ backgroundColor: draft.rest ? accent : "var(--app-switch-off)" }}
            >
              <span
                className="absolute top-[3px] size-[26px] rounded-full bg-white shadow"
                style={{ left: draft.rest ? 23 : 3 }}
              />
            </button>
          </div>

          <div className={cn("grid grid-cols-2 gap-2.5", draft.rest && "pointer-events-none opacity-40")}>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              Inizio
              <input
                type="time"
                value={draft.start}
                onChange={(ev) => setDraft({ ...draft, start: ev.target.value })}
                className={inputClass}
                style={{ backgroundColor: "var(--glass-chip)" }}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              Fine
              <input
                type="time"
                value={draft.end}
                onChange={(ev) => setDraft({ ...draft, end: ev.target.value })}
                className={inputClass}
                style={{ backgroundColor: "var(--glass-chip)" }}
              />
            </label>
          </div>

          <div className="min-h-5 text-sm text-muted-foreground">{info}</div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={close}
              className="min-h-11 flex-1 rounded-xl border border-border text-[15px] text-foreground"
            >
              Annulla
            </button>
            <button
              type="button"
              disabled={!valid}
              onClick={() => {
                onSaveShift(draft.rest ? { rest: true, start: "", end: "" } : draft);
                close();
              }}
              className="min-h-11 flex-1 rounded-xl text-[15px] font-semibold disabled:opacity-40"
              style={{ backgroundColor: accent, color: accentText }}
            >
              Salva
            </button>
          </div>

          {shiftModified && (
            <button
              type="button"
              onClick={() => {
                onResetShift();
                close();
              }}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-[15px] text-foreground"
            >
              <Undo2 className="size-[18px]" aria-hidden="true" />
              Ripristina turno originale
            </button>
          )}
        </div>
      </div>
    );
  }

  // panel === "ot"
  const durMin = toMinutes(otDraft.dur);
  const wholeShift = otDraft.side === "all";
  const otValid = !!ordinary && (wholeShift || (durMin !== null && durMin > 0));
  const preview =
    otValid && !wholeShift && durMin !== null && otDraft.side !== "all"
      ? shiftWithOvertime(ordinary, { side: otDraft.side, min: durMin })
      : null;
  const ordStart = ordinary ? toMinutes(ordinary.start) : null;
  const ordEnd = ordinary ? toMinutes(ordinary.end) : null;
  const ordinaryHours = ordStart !== null && ordEnd !== null ? formatHours(netMinutes(ordStart, ordEnd)) : "";
  const info =
    preview && preview.ot
      ? `Straordinario ${preview.ot.start} – ${preview.ot.end}. Totale con ordinario: ${preview.total ?? ""}`
      : "";

  const segClass = "min-h-11 min-w-0 flex-1 whitespace-nowrap rounded-xl px-0.5 text-center seg-label tracking-tight";
  const dim = wholeShift ? "opacity-40" : "";
  const segStyle = (on: boolean) =>
    on ? { backgroundColor: accent, color: accentText } : undefined;

  return (
    <div ref={cardRef} className={cardClass}>
      <button
        type="button"
        onClick={close}
        aria-expanded
        className="flex w-full items-center justify-between gap-2 rounded-md text-left text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <h3 className="text-lg font-semibold">Straordinario</h3>
        <span className="inline-flex items-center gap-2.5">
          {hasOt && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full" style={{ backgroundColor: accent }} />
              Aggiunto
            </span>
          )}
          <ChevronDown className="size-5 shrink-0 rotate-180" />
        </span>
      </button>

      <div className="mt-1 flex flex-col gap-3">
        <div className="text-base text-muted-foreground">{subtitle}</div>

        <div
          className="flex items-baseline justify-between rounded-xl px-3 py-2.5"
          style={{ backgroundColor: "var(--glass-chip)" }}
        >
          <div>
            <div className="text-xs text-muted-foreground">Orario ordinario</div>
            <div className="text-[17px] font-semibold text-foreground">
              {ordinary ? `${ordinary.start} – ${ordinary.end}` : ""}
            </div>
          </div>
          <div className="text-sm text-muted-foreground">{ordinaryHours}</div>
        </div>

        <div className="flex gap-1">
          <button
            type="button"
            aria-pressed={otDraft.side === "before"}
            onClick={() => setOtDraft({ ...otDraft, side: "before" })}
            className={cn(segClass, otDraft.side === "before" ? "font-semibold" : cn("border border-border text-foreground", dim))}
            style={segStyle(otDraft.side === "before")}
          >
            Aggiungi prima
          </button>
          <button
            type="button"
            aria-pressed={otDraft.side === "after"}
            onClick={() => setOtDraft({ ...otDraft, side: "after" })}
            className={cn(segClass, otDraft.side === "after" ? "font-semibold" : cn("border border-border text-foreground", dim))}
            style={segStyle(otDraft.side === "after")}
          >
            Aggiungi dopo
          </button>
          <button
            type="button"
            aria-pressed={wholeShift}
            onClick={() => setOtDraft({ ...otDraft, side: "all" })}
            className={cn(segClass, wholeShift ? "font-semibold" : "border border-border text-foreground")}
            style={segStyle(wholeShift)}
          >
            Tutto il turno
          </button>
        </div>

        {!wholeShift && (
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
            Inserisci la durata dello straordinario (ore e minuti)
            <input
              type="time"
              value={otDraft.dur}
              onChange={(ev) => setOtDraft({ ...otDraft, dur: ev.target.value })}
              className={inputClass}
              style={{ backgroundColor: "var(--glass-chip)" }}
            />
          </label>
        )}

        {info && <div className="text-sm leading-snug text-muted-foreground">{info}</div>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={close}
            className="min-h-11 flex-1 rounded-xl border border-border text-[15px] text-foreground"
          >
            Annulla
          </button>
          <button
            type="button"
            disabled={!otValid}
            onClick={() => {
              if (!otValid) return;
              if (otDraft.side === "all") onSaveOvertime({ side: "all" });
              else if (durMin !== null) onSaveOvertime({ side: otDraft.side, min: durMin });
              close();
            }}
            className="min-h-11 flex-1 rounded-xl text-[15px] font-semibold disabled:opacity-40"
            style={{ backgroundColor: accent, color: accentText }}
          >
            Salva
          </button>
        </div>

        {hasOt && (
          <button
            type="button"
            onClick={() => {
              onRemoveOvertime();
              close();
            }}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-[15px] text-foreground"
          >
            <Minus className="size-[18px]" aria-hidden="true" />
            Rimuovi straordinario
          </button>
        )}
      </div>
    </div>
  );
}
