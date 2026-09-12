"use client"
import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@/components/orva/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { WhtCertificateSheet } from '@/modules/orva_finance/components/WhtCertificateSheet'

type Employer = { name: string; taxId: string | null; branch: string | null; address: string | null; filerName: string | null; filerPosition: string | null }
type Cert = {
  year: number
  employer: Employer
  employee: { id: string; employeeNo: string | null; name: string; nationalId: string; address: string | null }
  months: Array<{ monthCode: string; payDate: string; gross: number; wht: number; ssoEmployee: number }>
  totals: { gross: number; wht: number; ssoEmployee: number }
  problems: string[]
}

/**
 * An employee's 50 ทวิ for a year, on the same sheet the vendor certificate
 * prints. One line per posted month, income type 40(1), reported on ภ.ง.ด.1ก.
 */
export default function EmployeeCertificatePage() {
  const t = useT()
  const params = useSearchParams()
  const employeeId = params.get('employeeId')
  const year = params.get('year') ?? String(new Date().getFullYear())

  const { data, error } = useQuery({
    queryKey: ['orva_hr.statutory.certificate', employeeId, year],
    queryFn: () => readApiResultOrThrow<Cert>(`/api/orva_hr/statutory/certificate?employeeId=${employeeId}&year=${year}`),
    enabled: Boolean(employeeId),
  })

  return (
    <Page>
      <PageHeader
        title={t('orva_hr.statutory.cert.page.title', 'หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)')}
        actions={<Button variant="outline" className="print:hidden" onClick={() => window.print()} disabled={!data}>{t('orva_hr.statutory.print', 'พิมพ์')}</Button>}
      />
      <PageBody>
        {!employeeId ? <p className="text-sm text-muted-foreground">{t('orva_hr.statutory.cert.pickFirst', 'เลือกพนักงานจากหน้าเอกสารยื่นราชการก่อน')}</p> : null}
        {error ? <p className="text-sm text-destructive">{String(error)}</p> : null}
        {data?.problems.length ? (
          <div className="mb-4 rounded-md border border-status-warning-border bg-status-warning-bg p-3 text-sm text-status-warning-text print:hidden" data-testid="cert-problems">
            <div className="font-medium">{t('orva_hr.statutory.cert.notReady', 'ยังออกให้ไม่ได้จนกว่าจะแก้เรื่องนี้')}</div>
            <ul className="mt-1 list-inside list-disc">{data.problems.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        ) : null}
        {data && !data.problems.length ? (
          <div className="flex justify-center">
            <WhtCertificateSheet
              copyLabel={t('orva_hr.statutory.cert.copy', 'ฉบับที่ 1 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี)')}
              certNo={`${data.employee.employeeNo ?? ''}/${data.year}`}
              form="PND1A"
              payer={{ name: data.employer.name, taxId: data.employer.taxId, branch: data.employer.branch, address: data.employer.address }}
              payee={{ name: data.employee.name, taxId: data.employee.nationalId, branch: null, address: data.employee.address }}
              seqInForm={data.employee.employeeNo?.replace(/\D/g, '').replace(/^0+/, '') || null}
              rows={data.months.map((m) => ({
                label: `1. เงินเดือน ค่าจ้าง ฯลฯ ตามมาตรา 40(1) — ${m.monthCode}`,
                date: m.payDate,
                amount: m.gross,
                tax: m.wht,
              }))}
              signatureDate={data.months[data.months.length - 1]?.payDate ?? `${data.year}-12-31`}
              footnote={t('orva_hr.statutory.cert.ssoNote', 'เงินสมทบกองทุนประกันสังคมที่หักไว้ทั้งปี {sso} บาท').replace('{sso}', data.totals.ssoEmployee.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}
            />
          </div>
        ) : null}
      </PageBody>
    </Page>
  )
}
