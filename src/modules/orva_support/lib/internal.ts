/**
 * Calls another module's API route on this same server with the caller's
 * cookies — the pattern orva_documents, orva_stock and orva_purchasing use.
 * The `messages` module keeps its RBAC, guards, audit and email path exactly
 * as when the operator composes from its own screen; nothing here reaches
 * into its tables.
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
    const message = (json as { error?: string; message?: string } | null)?.error ?? (json as { message?: string } | null)?.message ?? `HTTP ${res.status}`
    throw Object.assign(new Error(`${path}: ${message}`), { status: res.status >= 500 ? 502 : res.status })
  }
  return (json ?? {}) as T
}
