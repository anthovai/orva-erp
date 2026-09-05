"use client"
import { useCallback, useState } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'
import { EmailInput } from '@open-mercato/ui/primitives/email-input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Check } from 'lucide-react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { LEAD_SOURCES } from '../../../../lib/lead'

/**
 * ติดต่อเรา — the public enquiry form. Anyone with the link may submit; the
 * enquiry lands on the sales pipeline as a deal with ช่องทางที่มา already
 * filled in, so the owner never has to remember where a lead came from.
 *
 * Scope comes from the slug in the URL and is resolved on the server, so this
 * page sends no tenant or organization id.
 */
type Props = { params: { orgSlug: string } }

export default function LeadPage({ params }: Props) {
  const t = useT()
  const orgSlug = params.orgSlug

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [phone, setPhone] = useState('')
  const [source, setSource] = useState('')
  const [message, setMessage] = useState('')
  // Hidden from humans; a bot that fills it gets a success page and no deal.
  const [website, setWebsite] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      setError(null)
      setSubmitting(true)
      try {
        const res = await apiCall<{ ok: boolean }>('/api/orva/lead', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            orgSlug, name, email, website,
            company: company || null,
            phone: phone || null,
            source: source || null,
            message: message || null,
          }),
        })
        if (!res.ok) throw new Error('failed')
        setSuccess(true)
      } catch {
        setError(t('orva.lead.error', 'ส่งข้อความไม่สำเร็จ ลองอีกครั้งหรือติดต่อเราทางอีเมลโดยตรง'))
      } finally {
        setSubmitting(false)
      }
    },
    [orgSlug, name, email, company, phone, source, message, website, t],
  )

  if (success) {
    return (
      <div className="mx-auto w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-foreground text-background">
          <Check className="size-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{t('orva.lead.success.title', 'ได้รับข้อความแล้ว')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {t('orva.lead.success.description', 'ขอบคุณที่ติดต่อเข้ามา เราจะตอบกลับโดยเร็วที่สุด')}
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight">{t('orva.lead.title', 'ติดต่อเรา')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {t('orva.lead.description', 'เล่าสั้นๆ ว่าอยากได้อะไร แล้วเราจะติดต่อกลับ')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error ? (
          <Alert status="error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-name" className="text-overline font-semibold uppercase tracking-wider text-muted-foreground/70">
            {t('orva.lead.field.name', 'ชื่อ')}
          </Label>
          <Input id="lead-name" type="text" autoComplete="name" required maxLength={200}
            value={name} onChange={(e) => setName(e.target.value)} disabled={submitting} className="rounded-lg" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-email" className="text-overline font-semibold uppercase tracking-wider text-muted-foreground/70">
            {t('orva.lead.field.email', 'อีเมล')}
          </Label>
          <EmailInput id="lead-email" required maxLength={200} placeholder="you@example.com"
            value={email} onChange={(e) => setEmail(e.target.value)} disabled={submitting} className="rounded-lg" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-company" className="text-overline font-semibold uppercase tracking-wider text-muted-foreground/70">
            {t('orva.lead.field.company', 'บริษัท')}
          </Label>
          <Input id="lead-company" type="text" autoComplete="organization" maxLength={200}
            value={company} onChange={(e) => setCompany(e.target.value)} disabled={submitting} className="rounded-lg" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-phone" className="text-overline font-semibold uppercase tracking-wider text-muted-foreground/70">
            {t('orva.lead.field.phone', 'เบอร์โทร')}
          </Label>
          <Input id="lead-phone" type="tel" autoComplete="tel" maxLength={50}
            value={phone} onChange={(e) => setPhone(e.target.value)} disabled={submitting} className="rounded-lg" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-source" className="text-overline font-semibold uppercase tracking-wider text-muted-foreground/70">
            {t('orva.lead.field.source', 'รู้จักเราจากไหน')}
          </Label>
          <select id="lead-source" value={source} onChange={(e) => setSource(e.target.value)} disabled={submitting}
            className="rounded-lg border bg-background px-3 py-2 text-sm">
            <option value="">{t('orva.lead.field.sourcePlaceholder', 'เลือก (ไม่บังคับ)')}</option>
            {LEAD_SOURCES.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-message" className="text-overline font-semibold uppercase tracking-wider text-muted-foreground/70">
            {t('orva.lead.field.message', 'อยากได้อะไร')}
          </Label>
          <textarea id="lead-message" rows={4} maxLength={4000} value={message}
            onChange={(e) => setMessage(e.target.value)} disabled={submitting}
            className="rounded-lg border bg-background px-3 py-2 text-sm" />
        </div>

        {/* Honeypot: visually hidden but still in the DOM, because a bot reads
            the markup and fills every field it finds. `sr-only` rather than
            display:none, which some bots skip; aria-hidden + tabIndex keep it
            away from screen readers and the keyboard. */}
        <div aria-hidden className="sr-only">
          <label htmlFor="lead-website">Website</label>
          <input id="lead-website" type="text" tabIndex={-1} autoComplete="off"
            value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>

        <Button type="submit" disabled={submitting} className="mt-1 w-full rounded-lg">
          {submitting ? t('orva.lead.submitting', 'กำลังส่ง…') : t('orva.lead.submit', 'ส่งข้อความ')}
        </Button>
      </form>
    </div>
  )
}
