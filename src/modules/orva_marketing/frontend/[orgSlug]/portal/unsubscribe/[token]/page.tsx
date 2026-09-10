"use client"
import { useCallback, useEffect, useState } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Check, MailX, SearchX } from 'lucide-react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

/**
 * ยกเลิกรับข่าวสาร — the page behind the link in every broadcast. Shows who
 * the link is for and whether they still receive news, and one button that
 * withdraws consent. No login: the token in the URL is the credential, and
 * the server resolves the tenant from it, so the page sends nothing else.
 */
type Props = { params: { orgSlug: string; token: string } }
type State = { ok: boolean; displayName: string; consent: boolean }

export default function UnsubscribePage({ params }: Props) {
  const t = useT()
  const token = params.token
  const [state, setState] = useState<State | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiCall<State>(`/api/orva_marketing/unsubscribe?token=${encodeURIComponent(token)}`)
        if (cancelled) return
        if (!res.ok || !res.result) setNotFound(true)
        else setState(res.result)
      } catch {
        if (!cancelled) setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const withdraw = useCallback(async () => {
    setError(null)
    setSubmitting(true)
    try {
      const res = await apiCall<State>('/api/orva_marketing/unsubscribe', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }),
      })
      if (!res.ok || !res.result) throw new Error('failed')
      setState(res.result)
      setDone(true)
    } catch {
      setError(t('orva_marketing.unsubscribe.error', 'ยกเลิกไม่สำเร็จ ลองอีกครั้ง หรือตอบกลับอีเมลที่ได้รับเพื่อแจ้งเรา'))
    } finally {
      setSubmitting(false)
    }
  }, [token, t])

  if (loading) return <div className="flex items-center justify-center py-20"><Spinner /></div>

  if (notFound || !state) {
    return (
      <div className="mx-auto w-full max-w-md py-12">
        <EmptyState
          icon={<SearchX className="h-8 w-8" aria-hidden />}
          title={t('orva_marketing.unsubscribe.unknownTitle', 'ลิงก์นี้ใช้ไม่ได้')}
          description={t('orva_marketing.unsubscribe.unknownBody', 'ลิงก์อาจถูกตัดตอนคัดลอก หรือเป็นลิงก์เก่า — ตอบกลับอีเมลที่ได้รับเพื่อแจ้งยกเลิกได้เช่นกัน')}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-md py-12">
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted"><MailX className="h-5 w-5" aria-hidden /></span>
          <div>
            <h1 className="text-lg font-semibold" data-testid="unsubscribe-title">{t('orva_marketing.unsubscribe.title', 'ยกเลิกรับข่าวสาร')}</h1>
            <p className="text-sm text-muted-foreground">{state.displayName}</p>
          </div>
        </div>

        {done || !state.consent ? (
          <Alert data-testid="unsubscribe-done">
            <Check className="h-4 w-4" aria-hidden />
            <AlertDescription>
              {t('orva_marketing.unsubscribe.doneBody', 'เรียบร้อย — เราจะไม่ส่งอีเมลข่าวสารถึงคุณอีก หากเปลี่ยนใจ แจ้งเราได้ทุกเมื่อ')}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <p className="mb-4 text-sm">
              {t('orva_marketing.unsubscribe.confirmBody', 'ตอนนี้คุณรับอีเมลข่าวสารและโปรโมชันจากเราอยู่ กดปุ่มด้านล่างเพื่อหยุดรับ — มีผลทันที')}
            </p>
            {error ? <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert> : null}
            <Button onClick={withdraw} disabled={submitting} className="w-full" data-testid="unsubscribe-button">
              {submitting ? <Spinner className="mr-2 h-4 w-4" /> : null}
              {t('orva_marketing.unsubscribe.button', 'หยุดรับข่าวสาร')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
