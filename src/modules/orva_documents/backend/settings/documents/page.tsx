"use client"
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import {
  CrudForm,
  type CrudField,
  type CrudFormGroup,
} from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { TEMPLATE_IDS } from '../../../lib/document'
import { DOCUMENT_TEMPLATES } from '../../../components/templates'
import { LogoField } from '../../../components/LogoField'

type SettingsPayload = {
  sellerName: string
  sellerLegalName: string | null
  sellerTaxId: string | null
  sellerBranch: string | null
  sellerAddress: string | null
  sellerPhone: string | null
  sellerEmail: string | null
  templateQuotation: string
  templateInvoice: string
  templateTaxInvoice: string
  templateReceipt: string
  invoiceNumberFormat: string
  brandColor: string
  paymentDetails: string | null
  logoHeader: string | null
  logoFooter: string | null
  logoHeaderQuotation: string | null
  documentTerms: string | null
  etaxSenderEmail: string | null
  promptpayId: string | null
  updatedAt: string | null
}

const PREVIEW_HREF = '/backend/documents/preview'

export default function DocumentSettingsPage() {
  const t = useT()
  const [initial, setInitial] = React.useState<Record<string, unknown> | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    apiCall<SettingsPayload>('/api/orva_documents/settings')
      .then((call) => {
        if (cancelled) return
        if (!call.ok || !call.result) { setError(t('orva_documents.settings.loadFailed', 'ไม่สามารถโหลดการตั้งค่าได้')); return }
        setInitial({ ...call.result })
      })
      .catch(() => { if (!cancelled) setError(t('orva_documents.settings.loadFailed', 'ไม่สามารถโหลดการตั้งค่าได้')) })
    return () => { cancelled = true }
  }, [t])

  const templateOptions = React.useMemo(
    () => TEMPLATE_IDS.map((id) => ({
      value: id,
      label: t(DOCUMENT_TEMPLATES[id].labelKey, DOCUMENT_TEMPLATES[id].fallback),
    })),
    [t],
  )

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'sellerName', label: t('orva_documents.settings.sellerName', 'ชื่อกิจการ (ที่พิมพ์บนเอกสาร)'), type: 'text', required: true },
    { id: 'sellerLegalName', label: t('orva_documents.settings.sellerLegalName', 'ชื่อตามหนังสือรับรอง'), type: 'text' },
    { id: 'sellerTaxId', label: t('orva_documents.settings.sellerTaxId', 'เลขประจำตัวผู้เสียภาษี (13 หลัก)'), type: 'text' },
    { id: 'sellerBranch', label: t('orva_documents.settings.sellerBranch', 'สาขา'), type: 'text' },
    { id: 'sellerAddress', label: t('orva_documents.settings.sellerAddress', 'ที่อยู่'), type: 'textarea' },
    { id: 'sellerPhone', label: t('orva_documents.settings.sellerPhone', 'โทรศัพท์'), type: 'text' },
    { id: 'sellerEmail', label: t('orva_documents.settings.sellerEmail', 'อีเมล'), type: 'text' },
    {
      id: 'paymentDetails',
      label: t('orva_documents.settings.paymentDetails', 'การชำระเงิน (ชื่อบัญชี/ธนาคาร/เลขบัญชี/เงื่อนไข — พิมพ์บนเอกสารทุกใบ)'),
      type: 'textarea',
    },
    {
      id: 'documentTerms',
      label: t('orva_documents.settings.documentTerms', 'หมายเหตุมาตรฐาน (พิมพ์บนใบกำกับภาษี/ใบเสร็จ)'),
      type: 'textarea',
    },
    {
      id: 'etaxSenderEmail',
      label: t('orva_documents.settings.etaxSenderEmail', 'อีเมลผู้ส่ง e-Tax Invoice (ต้องลงทะเบียนกับกรมสรรพากรก่อน — เว้นว่าง = ปิดการส่ง e-Tax)'),
      type: 'text',
    },
    {
      id: 'promptpayId',
      label: t('orva_documents.settings.promptpayId', 'PromptPay (เบอร์โทร / เลขผู้เสียภาษี 13 หลัก) — ใส่แล้วใบแจ้งหนี้และใบวางบิลจะมี QR สแกนจ่ายตามยอด'),
      type: 'text',
    },
    {
      id: 'invoiceNumberFormat',
      label: t('orva_documents.settings.invoiceNumberFormat', 'รูปแบบเลขที่ใบแจ้งหนี้ (เช่น KK-INV-{yyyy}{seq:3})'),
      type: 'text',
    },
    {
      id: 'brandColor',
      label: t('orva_documents.settings.brandColor', 'สีประจำกิจการ (ใช้ในเทมเพลตแบบแบรนด์ เช่น #E8352A)'),
      type: 'text',
    },
    {
      id: 'logoHeader',
      label: t('orva_documents.settings.logoHeader', 'โลโก้หัวกระดาษ — เอกสารเรียกเก็บ (มีโลโก้แล้วไม่พิมพ์ชื่อกิจการ ยกเว้นเอกสารภาษีที่กฎหมายบังคับ)'),
      type: 'custom',
      component: (props) => <LogoField {...props} t={t} />,
    },
    {
      id: 'logoHeaderQuotation',
      label: t('orva_documents.settings.logoHeaderQuotation', 'โลโก้หัวกระดาษ — ใบเสนอราคา (ถ้าไม่ตั้ง ใช้โลโก้เอกสารเรียกเก็บ)'),
      type: 'custom',
      component: (props) => <LogoField {...props} t={t} />,
    },
    {
      id: 'logoFooter',
      label: t('orva_documents.settings.logoFooter', 'โลโก้ท้ายกระดาษ (พิมพ์เป็นสีขาวบนแถบสีกิจการ)'),
      type: 'custom',
      component: (props) => <LogoField {...props} darkPreview t={t} />,
    },
    { id: 'templateQuotation', label: t('orva_documents.type.quotation', 'ใบเสนอราคา'), type: 'select', options: templateOptions },
    { id: 'templateInvoice', label: t('orva_documents.type.invoice', 'ใบแจ้งหนี้'), type: 'select', options: templateOptions },
    { id: 'templateTaxInvoice', label: t('orva_documents.type.tax_invoice', 'ใบกำกับภาษี'), type: 'select', options: templateOptions },
    { id: 'templateReceipt', label: t('orva_documents.type.receipt', 'ใบกำกับภาษี/ใบเสร็จรับเงิน'), type: 'select', options: templateOptions },
  ], [t, templateOptions])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'seller',
      title: t('orva_documents.settings.groupSeller', 'ข้อมูลกิจการบนเอกสาร'),
      column: 1,
      fields: ['sellerName', 'sellerLegalName', 'sellerTaxId', 'sellerBranch', 'sellerAddress', 'sellerPhone', 'sellerEmail', 'paymentDetails', 'promptpayId', 'documentTerms', 'etaxSenderEmail'],
    },
    {
      id: 'templates',
      title: t('orva_documents.settings.groupTemplates', 'เทมเพลตประจำเอกสารแต่ละชนิด'),
      column: 2,
      fields: ['templateQuotation', 'templateInvoice', 'templateTaxInvoice', 'templateReceipt', 'invoiceNumberFormat', 'brandColor', 'logoHeader', 'logoHeaderQuotation', 'logoFooter'],
    },
  ], [t])

  if (error) return <Page><PageBody><ErrorMessage label={error} /></PageBody></Page>
  if (!initial) return null

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('orva_documents.settings.page.title', 'ตั้งค่าเอกสาร')}
          backHref={PREVIEW_HREF}
          cancelHref={PREVIEW_HREF}
          fields={fields}
          groups={groups}
          initialValues={initial}
          submitLabel={t('orva_finance.form.edit.submit', 'บันทึก')}
          onSubmit={async (values) => {
            const call = await apiCall<SettingsPayload>('/api/orva_documents/settings', {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(values),
            })
            if (!call.ok) throw new Error(t('orva_documents.settings.saveFailed', 'บันทึกไม่สำเร็จ'))
            flash(t('orva_documents.settings.saved', 'บันทึกการตั้งค่าเอกสารแล้ว'), 'success')
          }}
        />
      </PageBody>
    </Page>
  )
}
