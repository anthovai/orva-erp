/**
 * Binding a list to raw SQL through `em.execute`.
 *
 * The query builder expands a JavaScript array binding into a comma-separated
 * list of bindings — right for `in (?)`, wrong for `?::text[]`, where Postgres
 * then receives the first element as a bare string and answers `malformed
 * array literal`. Found twice (the tasking board's card move, then the
 * marketplace import preview), each time as an empty 500. Bind a Postgres
 * array literal as ONE string instead: `= any(?::text[])` with `toPgTextArray(list)`.
 *
 * Elements are quoted and escaped, so a SKU with a comma, a quote or a brace
 * cannot break out of the literal.
 */
export function toPgTextArray(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`
}
