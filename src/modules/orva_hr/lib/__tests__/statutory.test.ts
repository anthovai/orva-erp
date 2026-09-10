import { describe, expect, it } from '@jest/globals'
import {
  buildEmployeeCertificate,
  buildPnd1,
  buildSsoReturn,
  digitsOnly,
  fullNameTh,
  isValidThaiNationalId,
  type StatutoryEmployee,
  type StatutoryPayrollLine,
} from '../statutory'

const employee = (over: Partial<StatutoryEmployee> = {}): StatutoryEmployee => ({
  id: 'e1', employeeNo: 'EMP-0001', displayName: 'Somchai Jaidee',
  titleTh: 'นาย', firstNameTh: 'สมชาย', lastNameTh: 'ใจดี',
  // Checksum-valid, computed with the rule under test: 1-1010-10101-01-1.
  nationalId: '1101010101011', ssoNumber: null, address: '1 ถนนสุขุมวิท กรุงเทพฯ',
  ...over,
})

const line = (over: Partial<StatutoryPayrollLine> = {}): StatutoryPayrollLine => ({
  employeeId: 'e1', employeeNo: 'EMP-0001', employeeName: 'Somchai Jaidee',
  gross: 65000, ssoEmployee: 750, ssoEmployer: 750, wht: 3679.17, net: 60570.83,
  ...over,
})

describe('the national id check digit', () => {
  it('accepts an id whose checksum agrees', () => {
    expect(isValidThaiNationalId('1101010101011')).toBe(true)
    expect(isValidThaiNationalId('1-1010-10101-01-1')).toBe(true)
    expect(isValidThaiNationalId('3909999999995')).toBe(true)
  })

  it('rejects a wrong check digit, a short id and nothing at all', () => {
    expect(isValidThaiNationalId('1101010101015')).toBe(false)
    expect(isValidThaiNationalId('110101010101')).toBe(false)
    expect(isValidThaiNationalId(null)).toBe(false)
    expect(isValidThaiNationalId('')).toBe(false)
  })

  it('strips the punctuation people type', () => {
    expect(digitsOnly(' 1-1010 10101/01 1 ')).toBe('1101010101011')
  })
})

describe('the name on a return', () => {
  it('joins the Thai parts, and falls back to the snapshot when they are blank', () => {
    expect(fullNameTh(employee())).toBe('นาย สมชาย ใจดี')
    expect(fullNameTh(employee({ titleTh: null, firstNameTh: null, lastNameTh: null }))).toBe('Somchai Jaidee')
    expect(fullNameTh(employee({ titleTh: ' ', firstNameTh: 'สมชาย', lastNameTh: null }))).toBe('สมชาย')
  })
})

describe('ภ.ง.ด.1', () => {
  it('reports one row per person paid, with the totals the remittance must match', () => {
    const ret = buildPnd1({
      monthCode: '2026-09', payDate: '2026-09-30',
      lines: [line(), line({ employeeId: 'e2', employeeNo: 'EMP-0002', gross: 45000, wht: 1216.67, net: 43033.33 })],
      employees: [employee(), employee({ id: 'e2', employeeNo: 'EMP-0002', firstNameTh: 'พิมพ์ชนก', lastNameTh: 'ศรีสุวรรณ', titleTh: 'นางสาว', nationalId: '3909999999995' })],
    })
    expect(ret.rows.map((r) => r.seq)).toEqual([1, 2])
    expect(ret.rows[0]).toMatchObject({ name: 'นาย สมชาย ใจดี', incomeType: '40(1)', gross: 65000, wht: 3679.17, problems: [] })
    expect(ret.rows[1].name).toBe('นางสาว พิมพ์ชนก ศรีสุวรรณ')
    expect(ret.totals).toEqual({ count: 2, gross: 110000, wht: 4895.84 })
    expect(ret.ready).toBe(true)
  })

  it('keeps a person with a missing id in the return and says what is wrong', () => {
    const ret = buildPnd1({
      monthCode: '2026-09', payDate: '2026-09-30',
      lines: [line()],
      employees: [employee({ nationalId: null })],
    })
    expect(ret.totals.gross).toBe(65000)
    expect(ret.rows[0].problems).toEqual(['ยังไม่ได้กรอกเลขบัตรประชาชน'])
    expect(ret.ready).toBe(false)
  })

  it('flags an id that fails the checksum rather than filing it', () => {
    const ret = buildPnd1({ monthCode: '2026-09', payDate: '2026-09-30', lines: [line()], employees: [employee({ nationalId: '1101010101015' })] })
    expect(ret.rows[0].problems).toEqual(['เลขบัตรประชาชนไม่ถูกต้อง'])
    expect(ret.ready).toBe(false)
  })

  it('an empty month is not ready to file', () => {
    const ret = buildPnd1({ monthCode: '2026-09', payDate: '2026-09-30', lines: [], employees: [] })
    expect(ret.totals).toEqual({ count: 0, gross: 0, wht: 0 })
    expect(ret.ready).toBe(false)
  })
})

describe('สปส.1-10', () => {
  it('takes both halves from the payroll run and totals what is remitted', () => {
    const ret = buildSsoReturn({
      monthCode: '2026-09',
      lines: [line(), line({ employeeId: 'e2', gross: 12000, ssoEmployee: 600, ssoEmployer: 600, wht: 0, net: 11400 })],
      employees: [employee(), employee({ id: 'e2', ssoNumber: '9-9999-99999-99-9' })],
    })
    expect(ret.totals).toEqual({ count: 2, wage: 77000, employee: 1350, employer: 1350, total: 2700 })
    expect(ret.ready).toBe(true)
  })

  it('uses the national id when no separate social-security number is held', () => {
    const ret = buildSsoReturn({ monthCode: '2026-09', lines: [line()], employees: [employee({ ssoNumber: null })] })
    expect(ret.rows[0].ssoNumber).toBe('1101010101011')
  })

  it('prefers an explicit social-security number over the national id', () => {
    const ret = buildSsoReturn({ monthCode: '2026-09', lines: [line()], employees: [employee({ ssoNumber: '9999999999999' })] })
    expect(ret.rows[0].ssoNumber).toBe('9999999999999')
  })

  it('says so when neither number is on file', () => {
    const ret = buildSsoReturn({ monthCode: '2026-09', lines: [line()], employees: [employee({ ssoNumber: null, nationalId: null })] })
    expect(ret.rows[0].problems).toContain('ยังไม่ได้กรอกเลขประกันสังคมหรือเลขบัตรประชาชน')
    expect(ret.ready).toBe(false)
  })
})

describe('the annual 50 ทวิ figures', () => {
  it('adds up the months that were posted, in order', () => {
    const cert = buildEmployeeCertificate({
      year: 2026,
      employee: employee(),
      months: [
        { monthCode: '2026-09', payDate: '2026-09-30', gross: 65000, wht: 3679.17, ssoEmployee: 750 },
        { monthCode: '2026-08', payDate: '2026-08-31', gross: 65000, wht: 3679.17, ssoEmployee: 750 },
      ],
    })
    expect(cert.months.map((m) => m.monthCode)).toEqual(['2026-08', '2026-09'])
    expect(cert.totals).toEqual({ gross: 130000, wht: 7358.34, ssoEmployee: 1500 })
    expect(cert.problems).toEqual([])
  })

  it('refuses to look finished when the year has no posted month', () => {
    const cert = buildEmployeeCertificate({ year: 2026, employee: employee(), months: [] })
    expect(cert.totals).toEqual({ gross: 0, wht: 0, ssoEmployee: 0 })
    expect(cert.problems).toContain('ปีนี้ยังไม่มีรอบเงินเดือนที่ลงบัญชีแล้ว')
  })

  it('carries the identity problems onto the certificate too', () => {
    const cert = buildEmployeeCertificate({
      year: 2026,
      employee: employee({ nationalId: '' }),
      months: [{ monthCode: '2026-09', payDate: '2026-09-30', gross: 1, wht: 0, ssoEmployee: 0 }],
    })
    expect(cert.problems).toEqual(['ยังไม่ได้กรอกเลขบัตรประชาชน'])
  })
})
