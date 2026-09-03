/**
 * Straight-line depreciation math (วิธีเส้นตรง) — pure, unit-tested.
 *
 * Monthly charge = (cost − salvage) / useful life in months, rounded to
 * satang; the final month absorbs the rounding remainder so accumulated
 * depreciation lands exactly on cost − salvage and never overshoots.
 * The acquisition month is depreciated in full (the common Thai SME practice
 * for monthly books; pro-rating by day is a policy choice, not a rule).
 */
export type DepreciableAsset = {
  cost: number | string
  salvage: number | string
  usefulLifeMonths: number
  /** months already depreciated (count of prior runs) */
  monthsDone: number
  /** amount already depreciated */
  accumulated: number | string
}

export function monthlyDepreciation(asset: DepreciableAsset): number {
  const cost = Number(asset.cost)
  const salvage = Number(asset.salvage) || 0
  const base = cost - salvage
  if (!(base > 0) || asset.usefulLifeMonths <= 0) return 0
  const remaining = Math.round((base - Number(asset.accumulated || 0)) * 100) / 100
  if (remaining <= 0) return 0
  const monthsLeft = asset.usefulLifeMonths - asset.monthsDone
  if (monthsLeft <= 1) return remaining
  const straight = Math.round((base / asset.usefulLifeMonths) * 100) / 100
  return Math.min(straight, remaining)
}

/** YYYY-MM of the acquisition ≤ period month → the asset is in service that period. */
export function inServiceFor(acquiredOn: string, periodStart: string, periodEnd: string): boolean {
  return acquiredOn <= periodEnd && acquiredOn.slice(0, 7) <= periodStart.slice(0, 7)
}
