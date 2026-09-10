"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AlertTriangle, Download, FileText } from 'lucide-react'

type Employer = {
  name: string; taxId: string | null; branch: string | null; address: string | null
  ssoEmployerNo: string | null; ssoBranchCode: string | null; filerName: string | null; filerPosition: string | null
}
type Pnd1Row = { seq: number; employeeId: string; employeeNo: string | null; nationalId: string; name: string; incomeType: string; payDate: string; gross: number; wht: number; problems: string[] }
type Pnd1 = { monthCode: string; payDate: string; runNo: string | null; runStatus: string | null; employer: Employer; rows: Pnd1Row[]; totals: { count: number; gross: number; wht: number }; ready: boolean }
type SsoRow = { seq: number; employeeId: string; employeeNo: string | null; ssoNumber: string; nationalId: string; name: string; wage: number; employeeContribution: number; employerContribution: number; problems: string[] }
type Sso = { monthCode: string; runNo: string | null; runStatus: string | null; employer: Employer; rows: SsoRow[]; totals: { count: number; wage: number; employee: number; employer: number; total: number }; ready: boolean }
type EmployeeRow = { id: string; employee_no?: string | null; display_name?: string | null }

const money = (v: number) => v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const thisMonth = () => new Date().toISOString().slice(0, 7)

/**
 * เอกสารยื่นราชการ — the two monthly payroll returns and the annual
 * certificate, read straight from the payroll run so the figures cannot
 * disagree with the journal that posted them.
 *
 * What the screen will not do is pretend to be the filing itself: the
 * download is a spreadsheet for whoever keys the return in, and the page says
 * so, because an invented upload format is worse than none.
 */
export default function StatutoryPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [month, setMonth] = React.useState(thisMonth())
  const [year, setYear] = React.useState(String(new Date().getFullYear()))
  const [employeeId, setEmployeeId] = React.useState('')

  const pnd1 = useQuery({
    queryKey: ['orva_hr.statutory.pnd1', month, scopeVersion],
    queryFn: () => readApiResultOrThrow<Pnd1>(`/api/orva_hr/statutory/pnd1?month=${month}`),
  })
  const sso = useQuery({
    queryKey: ['orva_hr.statutory.sso', month, scopeVersion],
    queryFn: () => readApiResultOrThrow<Sso>(`/api/orva_hr/statutory/sso?month=${month}`),
  })
  const employees = useQuery({
    queryKey: ['orva_hr.statutory.employees', scopeVersion],
    queryFn: () => readApiResultOrThrow<{ items: EmployeeRow[] }>('/api/orva_hr/employees?page=1&pageSize=200&status=active'),
  })

  const employer = pnd1.data?.employer ?? sso.data?.employer ?? null
  const missingEmployer: string[] = []
  if (employer && !employer.taxId) missingEmployer.push(t('orva_hr.statutory.needTaxId', 'เลขประจำตัวผู้เสียภาษีของกิจการ (ตั้งค่า → เอกสาร)'))
  if (employer && !employer.ssoEmployerNo) missingEmployer.push(t('orva_hr.statutory.needSso', 'เลขที่บัญชีนายจ้าง ประกันสังคม (ตั้งค่าในหน้าเงินเดือน)'))

  const runBadge = (status: string | null, runNo: string | null) => {
    if (!status) return <Badge variant="outline">{t('orva_hr.statutory.noRun', 'ยังไม่มีรอบเงินเดือนเดือนนี้')}</Badge>
    const variant = status === 'posted' ? 'success' : 'warning'
    const label = status === 'posted'
      ? t('orva_hr.statutory.posted', 'ลงบัญชีแล้ว {run}')
      : t('orva_hr.statutory.calculated', 'คำนวณแล้ว ยังไม่ลงบัญชี {run}')
    return <Badge variant={variant as never}>{label.replace('{run}', runNo ?? '')}</Badge>
  }

  return (
    <Page>
      <PageHeader
        title={t('orva_hr.statutory.page.title', 'เอกสารยื่นราชการ (เงินเดือน)')}
        description={t('orva_hr.statutory.page.description', 'ภ.ง.ด.1 และ สปส.1-10 ของเดือนที่จ่ายเงินเดือนแล้ว และหนังสือรับรองหัก ณ ที่จ่าย 50 ทวิ รายปี — ตัวเลขมาจากรอบเงินเดือนโดยตรง')}
      />
      <PageBody>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t('orva_hr.statutory.month', 'เดือนที่จ่าย')}</span>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" data-testid="statutory-month" />
          </label>
          {employer ? (
            <div className="text-xs text-muted-foreground">
              <div>{employer.name || t('orva_hr.statutory.noEmployerName', 'ยังไม่ได้ตั้งชื่อกิจการ')}</div>
              <div>
                {t('orva_hr.statutory.taxId', 'เลขผู้เสียภาษี')} {employer.taxId ?? '—'}
                {' · '}
                {t('orva_hr.statutory.ssoNo', 'เลขที่บัญชีนายจ้าง')} {employer.ssoEmployerNo ?? '—'}
              </div>
            </div>
          ) : null}
        </div>

        {missingEmployer.length ? (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-status-warning-border bg-status-warning-bg p-3 text-sm text-status-warning-text">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <div className="font-medium">{t('orva_hr.statutory.employerIncomplete', 'ข้อมูลนายจ้างยังไม่ครบสำหรับการยื่น')}</div>
              <ul className="mt-1 list-inside list-disc">{missingEmployer.map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          </div>
        ) : null}

        <p className="mt-3 text-xs text-muted-foreground">
          {t('orva_hr.statutory.csvNote', 'ปุ่มดาวน์โหลดให้ไฟล์ตารางสำหรับคนที่ยื่นแบบ ไม่ใช่ไฟล์อัปโหลดของกรมสรรพากรหรือประกันสังคม')}
        </p>

        <section className="mt-6 rounded-lg border bg-card p-4" aria-labelledby="pnd1-title">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="pnd1-title" className="flex items-center gap-2 text-base font-semibold">
              <FileText className="h-4 w-4" aria-hidden /> {t('orva_hr.statutory.pnd1.title', 'ภ.ง.ด.1 — ภาษีหัก ณ ที่จ่าย พนักงาน')}
            </h2>
            <div className="flex items-center gap-2">
              {runBadge(pnd1.data?.runStatus ?? null, pnd1.data?.runNo ?? null)}
              <Button asChild variant="outline" size="sm" disabled={!pnd1.data?.rows.length}>
                <a href={`/api/orva_hr/statutory/pnd1?month=${month}&format=csv`} download>
                  <Download className="mr-1 h-4 w-4" aria-hidden /> {t('orva_hr.statutory.download', 'ดาวน์โหลดตาราง')}
                </a>
              </Button>
            </div>
          </div>
          {pnd1.isLoading ? <p className="text-sm text-muted-foreground">{t('orva_hr.statutory.loading', 'กำลังโหลด…')}</p> : null}
          {pnd1.isError ? <p className="text-sm text-status-error-text">{t('orva_hr.statutory.loadFailed', 'โหลดไม่สำเร็จ')}</p> : null}
          {pnd1.data && !pnd1.data.rows.length ? (
            <p className="text-sm text-muted-foreground">{t('orva_hr.statutory.emptyMonth', 'เดือนนี้ยังไม่มีการจ่ายเงินเดือน — คำนวณรอบเงินเดือนก่อน')}</p>
          ) : null}
          {pnd1.data?.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="pnd1-table">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">{t('orva_hr.statutory.col.seq', 'ลำดับ')}</th>
                    <th className="py-2 pr-3 font-medium">{t('orva_hr.statutory.col.name', 'ชื่อ-สกุล')}</th>
                    <th className="py-2 pr-3 font-medium">{t('orva_hr.statutory.col.nationalId', 'เลขประจำตัวประชาชน')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('orva_hr.statutory.col.gross', 'จำนวนเงินที่จ่าย')}</th>
                    <th className="py-2 text-right font-medium">{t('orva_hr.statutory.col.wht', 'ภาษีที่หัก')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pnd1.data.rows.map((row) => (
                    <tr key={row.employeeId}>
                      <td className="py-2 pr-3 tabular-nums">{row.seq}</td>
                      <td className="py-2 pr-3">
                        <div>{row.name || '—'}</div>
                        {row.problems.length ? <div className="text-xs text-status-error-text">{row.problems.join(' · ')}</div> : null}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{row.nationalId || '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{money(row.gross)}</td>
                      <td className="py-2 text-right tabular-nums">{money(row.wht)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="py-2 pr-3" colSpan={3}>{t('orva_hr.statutory.total', 'รวม {n} คน').replace('{n}', String(pnd1.data.totals.count))}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(pnd1.data.totals.gross)}</td>
                    <td className="py-2 text-right tabular-nums"><span className="orva-ledger-total">{money(pnd1.data.totals.wht)}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <section className="mt-6 rounded-lg border bg-card p-4" aria-labelledby="sso-title">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="sso-title" className="flex items-center gap-2 text-base font-semibold">
              <FileText className="h-4 w-4" aria-hidden /> {t('orva_hr.statutory.sso.title', 'สปส.1-10 — เงินสมทบประกันสังคม')}
            </h2>
            <Button asChild variant="outline" size="sm" disabled={!sso.data?.rows.length}>
              <a href={`/api/orva_hr/statutory/sso?month=${month}&format=csv`} download>
                <Download className="mr-1 h-4 w-4" aria-hidden /> {t('orva_hr.statutory.download', 'ดาวน์โหลดตาราง')}
              </a>
            </Button>
          </div>
          {sso.data && !sso.data.rows.length ? (
            <p className="text-sm text-muted-foreground">{t('orva_hr.statutory.emptyMonth', 'เดือนนี้ยังไม่มีการจ่ายเงินเดือน — คำนวณรอบเงินเดือนก่อน')}</p>
          ) : null}
          {sso.data?.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="sso-table">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">{t('orva_hr.statutory.col.seq', 'ลำดับ')}</th>
                    <th className="py-2 pr-3 font-medium">{t('orva_hr.statutory.col.name', 'ชื่อ-สกุล')}</th>
                    <th className="py-2 pr-3 font-medium">{t('orva_hr.statutory.col.ssoNumber', 'เลขประกันสังคม')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('orva_hr.statutory.col.wage', 'ค่าจ้าง')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('orva_hr.statutory.col.employee', 'ผู้ประกันตน')}</th>
                    <th className="py-2 text-right font-medium">{t('orva_hr.statutory.col.employer', 'นายจ้าง')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sso.data.rows.map((row) => (
                    <tr key={row.employeeId}>
                      <td className="py-2 pr-3 tabular-nums">{row.seq}</td>
                      <td className="py-2 pr-3">
                        <div>{row.name || '—'}</div>
                        {row.problems.length ? <div className="text-xs text-status-error-text">{row.problems.join(' · ')}</div> : null}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{row.ssoNumber || '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{money(row.wage)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{money(row.employeeContribution)}</td>
                      <td className="py-2 text-right tabular-nums">{money(row.employerContribution)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="py-2 pr-3" colSpan={3}>{t('orva_hr.statutory.remit', 'นำส่งรวม')}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(sso.data.totals.wage)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(sso.data.totals.employee)}</td>
                    <td className="py-2 text-right tabular-nums"><span className="orva-ledger-total">{money(sso.data.totals.employer)}</span></td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted-foreground">
                {t('orva_hr.statutory.ssoTotal', 'ยอดที่ต้องนำส่งประกันสังคมรวมสองฝ่าย {total} บาท').replace('{total}', money(sso.data.totals.total))}
              </p>
            </div>
          ) : null}
        </section>

        <section className="mt-6 rounded-lg border bg-card p-4" aria-labelledby="cert-title">
          <h2 id="cert-title" className="mb-3 flex items-center gap-2 text-base font-semibold">
            <FileText className="h-4 w-4" aria-hidden /> {t('orva_hr.statutory.cert.title', 'หนังสือรับรองหัก ณ ที่จ่าย 50 ทวิ (รายปี)')}
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            {t('orva_hr.statutory.cert.body', 'ออกให้พนักงานหนึ่งใบต่อปี รวมทุกเดือนที่ลงบัญชีแล้ว ประเภทเงินได้ 40(1) เงินเดือน')}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t('orva_hr.statutory.cert.employee', 'พนักงาน')}</span>
              <select
                className="h-9 w-64 rounded-md border bg-background px-2 text-sm"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                data-testid="cert-employee"
              >
                <option value="">{t('orva_hr.statutory.cert.pick', 'เลือกพนักงาน')}</option>
                {(employees.data?.items ?? []).map((e) => (
                  <option key={e.id} value={e.id}>{e.employee_no ? `${e.employee_no} · ` : ''}{e.display_name ?? e.id}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t('orva_hr.statutory.cert.year', 'ปี (ค.ศ.)')}</span>
              <Input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} className="w-28" />
            </label>
            <Button asChild disabled={!employeeId}>
              <Link href={`/backend/hr/statutory/certificate?employeeId=${employeeId}&year=${year}`}>
                {t('orva_hr.statutory.cert.open', 'เปิดหนังสือรับรอง')}
              </Link>
            </Button>
          </div>
          {employees.data && !employees.data.items.length ? (
            <p className="mt-3 text-sm text-muted-foreground">{t('orva_hr.statutory.cert.noEmployees', 'ยังไม่มีพนักงานในระบบ')}</p>
          ) : null}
        </section>
      </PageBody>
    </Page>
  )
}
