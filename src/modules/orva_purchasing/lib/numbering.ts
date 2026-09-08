/**
 * PO numbers.
 *
 * A purchase order is issued by the legal entity, not by a brand, so unlike a
 * sales document it has one series per organization and no brand prefix
 * (spec A5). The format carries date tokens and one sequence token, and the
 * date tokens are what makes the counter periodic: `PO-{yyyy}{mm}-{seq:4}`
 * restarts every month, `PO-{yyyy}-{seq:5}` every year, and a format with no
 * date token never restarts at all. That rule lives in `periodKeyFor`, which
 * the send route compares against the stored key before it takes a number.
 *
 * Gregorian years, matching every other number series in this app. The
 * Buddhist year appears on printed sheets, not in identifiers.
 */
const SEQ_TOKEN = /\{seq(?::(\d+))?\}/g

function dateTokens(format: string, date: Date): string {
  const yyyy = String(date.getFullYear())
  return format
    .replace(/\{yyyy\}/g, yyyy)
    .replace(/\{yy\}/g, yyyy.slice(2))
    .replace(/\{mm\}/g, String(date.getMonth() + 1).padStart(2, '0'))
    .replace(/\{dd\}/g, String(date.getDate()).padStart(2, '0'))
}

/**
 * The period a counter belongs to: the format with its sequence token removed
 * and its date tokens rendered. Two sends whose keys differ start two runs.
 */
export function periodKeyFor(format: string, date: Date): string {
  return dateTokens(format.replace(SEQ_TOKEN, ''), date)
}

/** Renders the number for a given sequence value. `{seq}` defaults to 4 digits. */
export function formatPoNumber(format: string, args: { date: Date; seq: number }): string {
  return dateTokens(format, args.date).replace(SEQ_TOKEN, (_match, width?: string) =>
    String(args.seq).padStart(Number(width ?? 4), '0'),
  )
}

/**
 * Whether a stored counter still applies to the date being numbered.
 * A null stored key means the counter has never been used.
 */
export function seqAppliesTo(args: { storedPeriod: string | null | undefined; format: string; date: Date }): boolean {
  return args.storedPeriod != null && args.storedPeriod === periodKeyFor(args.format, args.date)
}
