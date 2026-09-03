/**
 * CSV for the accountant's Excel: UTF-8 with BOM (so Thai opens correctly in
 * Excel on Windows without an import wizard), CRLF rows, RFC 4180 quoting.
 */
export type CsvCell = string | number | null | undefined | boolean

function escapeCell(value: CsvCell): string {
  if (value == null) return ''
  const text = typeof value === 'number' ? value.toFixed(2) : typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  const lines = [header, ...rows].map((row) => row.map(escapeCell).join(','))
  return '﻿' + lines.join('\r\n') + '\r\n'
}

/** `12345.6789` → `12345.68`; keeps money out of exponent notation in Excel. */
export function money(value: string | number | null | undefined): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}
