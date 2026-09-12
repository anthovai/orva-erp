import { describe, expect, it } from '@jest/globals'
import { assessReadiness, readinessSummary, BACKUP_STALE_DAYS, THAI_VAT_RATE, type ReadinessFacts } from '../readiness'

/**
 * Each case here is something that was actually true of the live tenant and
 * that nobody could see from any screen. The assertions are about which of
 * them stop the day (`blocker`) and which merely spoil something later
 * (`warning`) — get that wrong and the panel is either ignored or panicked at.
 */

const ready: ReadinessFacts = {
  emailConfigured: true,
  pdfConfigured: true,
  seller: { legalName: true, taxId: true, address: true, paymentDetails: true },
  defaultTaxRate: THAI_VAT_RATE,
  openPeriods: 1,
  hourlyRate: 800,
  portalUsers: { total: 3, linked: 3 },
  schedules: { total: 5, active: 5 },
  unpostedInvoices: 0,
  backupAgeDays: 0,
  rlsEnforced: true,
}
const find = (facts: ReadinessFacts, id: string) => assessReadiness(facts).find((c) => c.id === id)!

describe('a tenant that is set up reports nothing to do', () => {
  it('is all ok, and says so', () => {
    const checks = assessReadiness(ready)
    expect(checks.every((c) => c.severity === 'ok')).toBe(true)
    expect(readinessSummary(checks)).toEqual({ blockers: 0, warnings: 0, ready: true })
  })

  it('still offers the screen that owns each fact', () => {
    expect(find(ready, 'tax').href).toBe('/backend/config/sales')
    expect(find(ready, 'period').href).toBe('/backend/gl/periods')
  })
})

describe('the things that stop a day of business', () => {
  it('treats a foreign default VAT rate as a blocker, naming both rates', () => {
    // The upstream seed ships 23% VAT as the default. A line added without
    // picking a class would carry it onto a Thai customer's invoice.
    const check = find({ ...ready, defaultTaxRate: 23 }, 'tax')
    expect(check.severity).toBe('blocker')
    expect(check.detail).toContain('23')
    expect(check.detail).toContain('7')
  })

  it('treats no default tax class at all as a blocker too', () => {
    const check = find({ ...ready, defaultTaxRate: null }, 'tax')
    expect(check.severity).toBe('blocker')
    expect(check.detail).toContain('ไม่มีคลาสภาษีเริ่มต้น')
  })

  it('blocks when no accounting period is open', () => {
    expect(find({ ...ready, openPeriods: 0 }, 'period').severity).toBe('blocker')
  })

  it('blocks when email cannot go out at all', () => {
    expect(find({ ...ready, emailConfigured: false }, 'email').severity).toBe('blocker')
  })

  it('blocks on a missing taxpayer id, but only warns on a missing address', () => {
    // The id is required on a ใบกำกับภาษี; the address only makes the paper
    // look unfinished.
    const noId = find({ ...ready, seller: { ...ready.seller, taxId: false } }, 'seller')
    expect(noId.severity).toBe('blocker')
    const noAddress = find({ ...ready, seller: { ...ready.seller, address: false } }, 'seller')
    expect(noAddress.severity).toBe('warning')
    expect(noAddress.detail).toContain('ที่อยู่')
  })
})

describe('the things that go quietly wrong later', () => {
  it('warns that project cost and margin will be blank with no hourly rate', () => {
    for (const rate of [null, 0]) {
      const check = find({ ...ready, hourlyRate: rate }, 'rate')
      expect(check.severity).toBe('warning')
    }
  })

  it('counts portal accounts that are not attached to a customer', () => {
    const check = find({ ...ready, portalUsers: { total: 3, linked: 0 } }, 'portal')
    expect(check.severity).toBe('warning')
    expect(check.detail).toContain('3')
  })

  it('says nothing is wrong when there are no portal accounts at all', () => {
    expect(find({ ...ready, portalUsers: { total: 0, linked: 0 } }, 'portal').severity).toBe('ok')
  })

  it('warns when no schedule is switched on, because the daily alerts go silent', () => {
    expect(find({ ...ready, schedules: { total: 5, active: 0 } }, 'schedules').severity).toBe('warning')
  })

  it('counts invoices with no journal behind them', () => {
    const check = find({ ...ready, unpostedInvoices: 2 }, 'posting')
    expect(check.severity).toBe('warning')
    expect(check.detail).toContain('2')
  })

  it('warns rather than blocks when the PDF renderer is unset', () => {
    // The preview still prints from the browser; only the download breaks.
    expect(find({ ...ready, pdfConfigured: false }, 'pdf').severity).toBe('warning')
  })
})

describe('the list is read worst-first', () => {
  it('puts blockers above warnings above ok', () => {
    const checks = assessReadiness({
      ...ready,
      defaultTaxRate: 23,          // blocker
      hourlyRate: null,            // warning
    })
    const severities = checks.map((c) => c.severity)
    expect(severities.indexOf('blocker')).toBe(0)
    expect(severities.indexOf('warning')).toBeLessThan(severities.indexOf('ok'))
    expect(readinessSummary(checks)).toEqual({ blockers: 1, warnings: 1, ready: false })
  })
})

describe('the two that decide whether the business survives a bad day', () => {
  it('blocks when the app connects with a role that bypasses RLS', () => {
    // Every Orva table carries a FORCE RLS policy. A superuser connection
    // makes all of them decoration, and on a SaaS that means one company
    // reading another's books — so this outranks anything cosmetic.
    const check = find({ ...ready, rlsEnforced: false }, 'rls')
    expect(check.severity).toBe('blocker')
    expect(check.detail).toContain('RLS')
  })

  it('warns, not blocks, when there has never been a backup — and says what to run', () => {
    // A missing backup does not stop today's invoice. Making it a blocker
    // would train the owner to ignore the panel, which costs more than it
    // buys.
    const check = find({ ...ready, backupAgeDays: null }, 'backup')
    expect(check.severity).toBe('warning')
    expect(check.detail).toContain('yarn db:backup')
  })

  it('warns once the newest backup is older than the stale mark, naming the age', () => {
    const stale = find({ ...ready, backupAgeDays: BACKUP_STALE_DAYS + 1 }, 'backup')
    expect(stale.severity).toBe('warning')
    expect(stale.detail).toContain(String(BACKUP_STALE_DAYS + 1))

    // Exactly at the mark is still fine: the boundary must not flicker.
    expect(find({ ...ready, backupAgeDays: BACKUP_STALE_DAYS }, 'backup').severity).toBe('ok')
  })

  it("says 'วันนี้' for a backup taken today rather than '0 วันก่อน'", () => {
    expect(find({ ...ready, backupAgeDays: 0 }, 'backup').detail).toBe('วันนี้')
    expect(find({ ...ready, backupAgeDays: 2 }, 'backup').detail).toContain('2')
  })

  it('puts the RLS blocker above the backup warning, worst first', () => {
    const checks = assessReadiness({ ...ready, rlsEnforced: false, backupAgeDays: null })
    const ids = checks.map((c) => c.id)
    expect(ids.indexOf('rls')).toBeLessThan(ids.indexOf('backup'))
    expect(readinessSummary(checks)).toEqual({ blockers: 1, warnings: 1, ready: false })
  })
})
