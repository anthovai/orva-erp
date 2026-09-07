/**
 * Passing a list of ids to raw SQL.
 *
 * The query builder underneath `em.execute` expands a JavaScript array binding
 * into a comma-separated list of bindings — the behaviour you want for
 * `in (?)`, and exactly wrong for `?::uuid[]`, where Postgres then receives a
 * bare uuid string and reports `malformed array literal`. Bind a Postgres
 * array literal as a single string instead.
 *
 * Found the hard way: the board's card-move returned 500 on every drop.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `['a', 'b'] → '{a,b}'`, for binding to a `?::uuid[]` placeholder.
 *
 * Every element is checked against the uuid shape and anything else throws.
 * The value ends up inside a literal rather than as its own binding, so this
 * is the last place a non-uuid could do harm — even though every caller
 * already validates with zod.
 */
export function toUuidArray(ids: string[]): string {
  for (const id of ids) {
    if (!UUID.test(id)) throw new Error(`Not a uuid: ${JSON.stringify(id)}`)
  }
  return `{${ids.join(',')}}`
}
