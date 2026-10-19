/**
 * Nomi collegati: una grafia diversa del nome nel file Excel ("Rosi") viene letta come un
 * nome già in elenco ("Rossi"). Il collegamento lo decide sempre l'utente; si ricorda su questo
 * dispositivo e vale per tutti i file.
 */

export type Alias = { from: string; to: string };

const ALIASES_KEY = "orari.aliases";

export function normName(v: string): string {
  return v.toLowerCase().replace(/\s+/g, " ").trim();
}

export function loadAliases(): Alias[] {
  try {
    const raw = localStorage.getItem(ALIASES_KEY);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(
      (a): a is Alias => !!a && typeof a.from === "string" && typeof a.to === "string" && !!a.from.trim() && !!a.to.trim(),
    );
  } catch {
    return [];
  }
}

export function saveAliases(list: Alias[]): void {
  try {
    localStorage.setItem(ALIASES_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/** grafia normalizzata -> nome giusto normalizzato */
export function aliasLookup(list: Alias[]): Map<string, string> {
  return new Map(list.map((a) => [normName(a.from), normName(a.to)]));
}

/** Aggiunge (o sostituisce) un collegamento; ignora quelli senza senso. */
export function withAlias(list: Alias[], from: string, to: string): Alias[] {
  const key = normName(from);
  if (!key || !to.trim() || key === normName(to)) return list;
  return [...list.filter((a) => normName(a.from) !== key), { from: from.trim(), to }];
}

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length]!;
}

/** Quanto è diverso `name` da `other`: 0 uguale, 1 del tutto diverso. */
export function nameDistance(name: string, other: string): number {
  const a = normName(name);
  const b = normName(other);
  const len = Math.max(a.length, b.length);
  return len === 0 ? 1 : distance(a, b) / len;
}

/** I nomi dell'elenco ordinati dal più simile a `name`. */
export function rankSimilar(name: string, options: string[]): string[] {
  return [...options].sort(
    (x, y) => nameDistance(name, x) - nameDistance(name, y) || x.localeCompare(y, "it", { sensitivity: "base" }),
  );
}

/** Differenza massima (circa un terzo del nome) per considerare due nomi "simili". */
export const SIMILAR_MAX = 0.34;

/** I nomi dell'elenco simili a `name` (probabile errore di battitura), dal più simile. */
export function similarNames(name: string, options: string[]): string[] {
  return rankSimilar(name, options).filter((o) => nameDistance(name, o) <= SIMILAR_MAX);
}
