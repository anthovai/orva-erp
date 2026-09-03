"use client"
import * as React from 'react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'

/**
 * Reads the chosen image, downscales it to fit 512×512 on a canvas and stores
 * a PNG data URI — self-contained in settings, so the server-side PDF printer
 * renders it without an authenticated fetch. PNG keeps transparency.
 */
export async function fileToLogoDataUri(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return canvas.toDataURL('image/png')
}

/** Logo upload + preview + remove; shared by document settings and brand profiles. */
export function LogoField({ id, value, setValue, disabled, darkPreview, t }: Pick<CrudCustomFieldRenderProps, 'id' | 'value' | 'setValue' | 'disabled'> & {
  darkPreview?: boolean
  t: (key: string, fallback: string) => string
}) {
  const [error, setError] = React.useState<string | null>(null)
  const uri = typeof value === 'string' && value.startsWith('data:image/') ? value : null
  return (
    <div className="flex items-center gap-3">
      {uri ? (
        // eslint-disable-next-line @next/next/no-img-element -- local data URI preview
        <img
          src={uri}
          alt=""
          className={`h-14 w-14 rounded border object-contain p-1 ${darkPreview ? 'bg-foreground' : 'bg-background'}`}
        />
      ) : (
        <div className="flex h-14 w-14 items-center justify-center rounded border border-dashed text-xs text-muted-foreground">
          {t('orva_documents.settings.logoNone', 'ไม่มี')}
        </div>
      )}
      <input
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={disabled}
        className="max-w-56 text-xs"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) return
          setError(null)
          fileToLogoDataUri(file)
            .then((next) => {
              if (next.length > 400_000) {
                setError(t('orva_documents.settings.logoTooLarge', 'ไฟล์ใหญ่เกินไป — ลองภาพที่เล็กลง'))
                return
              }
              setValue(next)
            })
            .catch(() => setError(t('orva_documents.settings.logoReadFailed', 'อ่านไฟล์ภาพไม่สำเร็จ')))
        }}
      />
      {uri ? (
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => setValue(null)}>
          {t('orva_documents.settings.logoRemove', 'ลบโลโก้')}
        </Button>
      ) : null}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  )
}
