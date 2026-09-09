"use client"
import * as React from 'react'
import type { LabelData, LabelSheet } from '../../lib/document'
import type { Encoded } from '../../lib/barcode'
import { totalModules } from '../../lib/barcode'
import type { TemplateProps } from './shared'

/**
 * ฉลากล็อต — a sheet of identical product labels for one lot.
 *
 * Not a party document: no seller, no buyer, no lines, no totals. What Thai
 * cosmetics labelling requires is here and nothing else — the brand, the
 * product and pack size, เลขที่ใบรับจดแจ้ง (อย.), the lot number, MFG and EXP,
 * and a code a scanner reads. Dates print as dd/mm/yyyy (CE): unambiguous on
 * the shelf and on an export carton alike.
 *
 * Geometry is physical, so it is stated in millimetres and inline: A4
 * portrait, 3 × 8 labels of 70 × 37 mm, the common "24 ดวง" sheet. More copies
 * than fit a sheet start a new page.
 */

/** dd/mm/yyyy from an ISO date; a dash when the lot has none. */
export function labelDate(iso: string | null): string {
  if (!iso) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return iso
  return `${match[3]}/${match[2]}/${match[1]}`
}

/** The bars as SVG elements, so nothing is injected as markup. */
function Barcode({ encoded, moduleWidth = 0.3, height = 9 }: { encoded: Encoded; moduleWidth?: number; height?: number }) {
  const quiet = encoded.symbology === 'ean13' ? 11 : 10
  const width = totalModules(encoded) * moduleWidth
  const rects: React.ReactNode[] = []
  let x = quiet * moduleWidth
  let isBar = true
  encoded.modules.forEach((run, index) => {
    if (isBar && run > 0) {
      rects.push(<rect key={index} x={x.toFixed(3)} y={0} width={(run * moduleWidth).toFixed(3)} height={height} fill="#000" />)
    }
    x += run * moduleWidth
    isBar = !isBar
  })
  return (
    <svg
      viewBox={`0 0 ${width.toFixed(3)} ${(height + 2.8).toFixed(3)}`}
      style={{ width: `${width.toFixed(2)}mm`, height: `${(height + 2.8).toFixed(2)}mm` }}
      role="img"
      aria-label={encoded.text}
    >
      {rects}
      <text x={(width / 2).toFixed(3)} y={(height + 2.4).toFixed(3)} fontFamily="ui-monospace, monospace" fontSize="2.4" textAnchor="middle" fill="#000">
        {encoded.text}
      </text>
    </svg>
  )
}

function Label({ label, brandMark, t }: { label: LabelData; brandMark: string | null; t: TemplateProps['t'] }) {
  return (
    <div
      className="flex flex-col justify-between overflow-hidden border border-dashed border-border text-foreground print:border-transparent"
      style={{ width: '70mm', height: '37mm', padding: '2.5mm 3mm', boxSizing: 'border-box' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-bold leading-tight">{label.productTitle}</div>
          {label.packSize ? <div className="text-xs leading-tight text-muted-foreground">{label.packSize}</div> : null}
        </div>
        {brandMark ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URI printed on paper, not a Next image
          <img src={brandMark} alt={label.brandName ?? ''} style={{ height: '7mm', maxWidth: '18mm', objectFit: 'contain' }} />
        ) : label.brandName ? (
          <div className="text-xs font-semibold uppercase tracking-wide">{label.brandName}</div>
        ) : null}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex flex-col text-xs leading-tight">
          <span>
            {t('orva_documents.label.fda', 'อย.')} {label.fdaNotification ?? '—'}
          </span>
          <span>
            {t('orva_documents.label.lot', 'LOT')} {label.lotNumber ?? '—'}
          </span>
          <span className="tabular-nums">
            {t('orva_documents.label.mfg', 'MFG')} {labelDate(label.manufacturedOn)} · {t('orva_documents.label.exp', 'EXP')} {labelDate(label.expiresOn)}
          </span>
        </div>
        {label.barcode ? <Barcode encoded={label.barcode} /> : null}
      </div>
    </div>
  )
}

/** One A4 page of the grid. */
function Page({ labels, sheet, brandMark, t, first }: { labels: LabelData[]; sheet: LabelSheet; brandMark: string | null; t: TemplateProps['t']; first: boolean }) {
  return (
    <div
      className={first ? '' : 'break-before-page'}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${sheet.columns}, 70mm)`,
        gridAutoRows: '37mm',
        justifyContent: 'center',
        columnGap: '0mm',
        rowGap: '0mm',
      }}
    >
      {labels.map((label, index) => (
        <Label key={index} label={label} brandMark={brandMark} t={t} />
      ))}
    </div>
  )
}

export function LabelSheetTemplate({ doc, t }: TemplateProps) {
  const sheet = doc.labelSheet
  if (!sheet) return null
  const perPage = sheet.columns * sheet.rows
  const pages: LabelData[][] = []
  for (let i = 0; i < sheet.labels.length; i += perPage) pages.push(sheet.labels.slice(i, i + perPage))
  return (
    <div className="flex flex-col text-foreground">
      {pages.map((labels, index) => (
        <Page key={index} labels={labels} sheet={sheet} brandMark={doc.logoHeader} t={t} first={index === 0} />
      ))}
    </div>
  )
}
