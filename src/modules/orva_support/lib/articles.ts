/**
 * Knowledge-base rules that do not touch the database, so they can be read
 * and tested on their own: how a title becomes a link, and how a search term
 * picks articles.
 */

export type ArticleLike = {
  title: string
  summary?: string | null
  body: string
  tags?: string[] | null
}

/**
 * A title becomes a URL segment. Thai keeps its characters — Thai is what the
 * owner writes and what the reader sees in the address bar — while spaces and
 * punctuation collapse into single dashes. Combining marks (\p{M}) are kept
 * alongside letters: Thai vowels and tone marks are marks, not letters, and
 * dropping them turns วิธี into ว-ธ.
 */
export function slugify(title: string): string {
  const cleaned = title
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned.slice(0, 120).replace(/-+$/g, '')
}

/**
 * The slug actually stored: the wanted one, or the same with -2, -3 … when
 * another live article already holds it. Deterministic, so the caller can
 * check availability with one query.
 */
export function uniqueSlug(wanted: string, taken: readonly string[]): string {
  const base = wanted || 'article'
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let i = 2; i < 200; i += 1) {
    const candidate = `${base}-${i}`.slice(0, 120)
    if (!used.has(candidate)) return candidate
  }
  return `${base}-${Date.now().toString(36)}`.slice(0, 120)
}

/** Title, summary, tags and body, case-insensitively; an empty term keeps all. */
export function matchesSearch(article: ArticleLike, term: string): boolean {
  const needle = term.trim().toLowerCase()
  if (!needle) return true
  const haystack = [article.title, article.summary ?? '', (article.tags ?? []).join(' '), article.body].join('\n').toLowerCase()
  return haystack.includes(needle)
}

/** The first line of prose, for a list where the writer left the summary empty. */
export function excerpt(body: string, max = 160): string {
  const line = body
    .split('\n')
    .map((row) => row.replace(/^[#>\-*\s]+/, '').trim())
    .find((row) => row.length > 0) ?? ''
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}
