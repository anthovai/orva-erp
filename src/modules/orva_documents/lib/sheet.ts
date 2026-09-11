/**
 * The printed sheet is a piece of A4, so its geometry is physical and stated
 * in millimetres — the same call `components/templates/label.tsx` makes for
 * its label grid.
 *
 * A hair under the full 297mm: at exactly one page height Chrome rounds up
 * and emits a blank second page (measured on the quotation — 297mm printed
 * two pages, 296mm one). The preview and the server-side PDF share this
 * number so what the operator sees is the paper they get.
 */
export const A4_SHEET_MIN_HEIGHT = '296mm'
