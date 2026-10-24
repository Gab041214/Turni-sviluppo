/**
 * Soglie fisse dell'app, raccolte in un solo punto. Sono in minuti dalla mezzanotte
 * (o in minuti di durata). Gli orari di apertura e chiusura non sono qui: si deducono dai file
 * e si correggono nelle impostazioni (vedi hours.ts). "Tardo" si decide con la chiusura del giorno.
 */

/** Oltre questa durata di un turno (8 ore) si toglie la pausa. */
export const BREAK_AFTER_MIN = 8 * 60;

/** Durata della pausa tolta ai turni più lunghi (1 ora). */
export const BREAK_MIN = 60;

/** Un turno con meno di queste ore nette (7 ore) è "corto". */
export const SHORT_SHIFT_MIN = 7 * 60;

/** Un turno che comincia entro quest'ora (10:00) è di apertura: lo straordinario nuovo va "dopo". */
export const OPENING_SHIFT_MAX_START_MIN = 10 * 60;
