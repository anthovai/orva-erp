"use client"
import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@/components/orva/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { WhtCertificateSheet, type CertificateFormCode, type CertificateParty } from './WhtCertificateSheet'

type Cert = {
  certNo: string | null
  form: string
  payer: CertificateParty
  payee: CertificateParty
  paymentDate: string
  incomeType: string | null
  rate: string | null
  amountPaid: string
  taxWithheld: string
  paymentNo: string | null
}

/**
 * หนังสือรับรองการหักภาษี ณ ที่จ่าย for one vendor payment — the certificate a
 * payer must give the payee for each withholding. The sheet is shared with
 * the employee certificate (`WhtCertificateSheet`); this page only says which
 * payment it is about.
 */
export default function WhtCertificate() {
  const t = useT()
  const params = useSearchParams()
  const paymentId = params.get('paymentId')
  const { data, error } = useQuery({
    queryKey: ['orva_finance.wht.cert', paymentId],
    queryFn: async () => readApiResultOrThrow<Cert>(`/api/orva_finance/reports/wht/certificate?paymentId=${paymentId}`),
    enabled: Boolean(paymentId),
  })

  return (
    <Page>
      <PageHeader
        title={t('orva_finance.whtCert.page.title', 'หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)')}
        actions={<Button variant="outline" className="print:hidden" onClick={() => window.print()} disabled={!data}>{t('orva_finance.reports.print', 'พิมพ์')}</Button>}
      />
      <PageBody>
        {!paymentId ? <p className="text-sm text-muted-foreground">{t('orva_finance.whtCert.pick', 'เปิดจากรายการจ่ายเงินที่มีการหักภาษี ณ ที่จ่าย')}</p> : null}
        {error ? <p className="text-sm text-destructive">{String(error)}</p> : null}
        {data ? (
          <div className="flex justify-center">
            <WhtCertificateSheet
              copyLabel={t('orva_finance.whtCert.copy', 'ฉบับที่ 1 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี)')}
              certNo={data.certNo}
              form={(data.form === 'PND53' ? 'PND53' : 'PND3') as CertificateFormCode}
              payer={data.payer}
              payee={data.payee}
              seqInForm={data.certNo?.replace(/\D/g, '').replace(/^0+/, '') || null}
              rows={[{
                label: `6. อื่น ๆ (ระบุ) ${data.incomeType ?? 'ค่าบริการ'} ${data.rate ? `— หัก ${Number(data.rate)}%` : ''}`.trim(),
                date: data.paymentDate,
                amount: Number(data.amountPaid),
                tax: Number(data.taxWithheld),
              }]}
              signatureDate={data.paymentDate}
              footnote={`${t('orva_finance.whtCert.ref', 'อ้างอิงรายการจ่าย')} ${data.paymentNo ?? '—'}`}
            />
          </div>
        ) : null}
      </PageBody>
    </Page>
  )
}
