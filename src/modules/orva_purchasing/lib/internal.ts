/**
 * Calls another module's API route on this same server with the caller's
 * cookies.
 *
 * Purchasing orchestrates: goods move through `orva_stock`'s receive route,
 * which is the only writer of lot costs and the only caller of WMS. Going
 * over HTTP rather than into its tables keeps that module's guards, features,
 * events and audit exactly as they are when the operator uses its own screen
 * — and keeps this module out of its schema. Same helper, same reasoning, as
 * `orva_stock/lib/internal.ts` uses against WMS.
 *
 * The call is NOT part of the caller's transaction: it runs in its own
 * database session and commits on its own. Consequence, stated where it can
 * be read: call it first, write the local rows after it returns 2xx, and rely
 * on `orva_purchasing reconcile` for the window in between.
 */
export async function callInternal<T = Record<string, unknown>>(
  req: Request,
  path: string,
  body: Record<string, unknown> | null,
  method: 'POST' | 'GET' | 'PUT' = 'POST',
): Promise<T> {
  const origin = new URL(req.url).origin
  const res = await fetch(new URL(path, origin), {
    method,
    headers: { 'content-type': 'application/json', cookie: req.headers.get('cookie') ?? '' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  })
  const json = (await res.json().catch(() => null)) as T | null
  if (!res.ok) {
    const message =
      (json as { error?: string; message?: string } | null)?.error ??
      (json as { message?: string } | null)?.message ??
      `HTTP ${res.status}`
    // The other module's own wording is the useful one — a missing warehouse
    // or a revoked stock grant should read as itself, not as "receive failed".
    throw Object.assign(new Error(message), { status: res.status >= 500 ? 502 : res.status })
  }
  return (json ?? {}) as T
}
