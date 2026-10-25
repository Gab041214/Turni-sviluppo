/**
 * Soglie fisse dell'app, raccolte in un solo punto. Sono in minuti dalla mezzanotte
 * (o in minuti di durata). Gli orari di apertura e chiusura non sono qui: si deducono dai file
 * e si correggono nelle impostazioni (vedi hours.ts). "Tardo" e il lato proposto per lo straordinario si decidono con la chiusura e l'apertura del giorno.
 */

/** Oltre questa durata di un turno (8 ore) si toglie la pausa. */
export const BREAK_AFTER_MIN = 8 * 60;

/** Durata della pausa tolta ai turni più lunghi (1 ora). */
export const BREAK_MIN = 60;

/** Un turno con meno di queste ore nette (7 ore) è "corto". */
export const SHORT_SHIFT_MIN = 7 * 60;
