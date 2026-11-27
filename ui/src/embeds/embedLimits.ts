/**
 * Rendering bounds for embedded layouts that do not have a windowed renderer.
 *
 * Notes can embed the same database many times. Without a bound, every board
 * column and gallery grid renders every matching row, so a large database
 * multiplied by many embeds produces tens of thousands of DOM nodes.
 *
 * Board and gallery stay read-only previews: they render an explicit subset and
 * say so in the embed. The database browser remains the unbounded, authoritative
 * view. Remove these caps only when the layouts use a real virtualiser.
 */

/** Cards rendered across one embedded board (shared by its visible columns). */
export const EMBED_BOARD_CARD_LIMIT = 60;

/** Columns rendered for one embedded board; extra Select options are counted, not drawn. */
export const EMBED_BOARD_COLUMN_LIMIT = 12;

/** Cards rendered for one embedded gallery. */
export const EMBED_GALLERY_CARD_LIMIT = 60;

/** Undated calendar events rendered for one embedded calendar. */
export const EMBED_UNDATED_LIMIT = 50;
