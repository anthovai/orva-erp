import { loadDictionary } from '@open-mercato/shared/lib/i18n/server'

/**
 * The Thai labels a printed sheet carries, pinned to Thai on purpose.
 *
 * "ใบกำกับภาษี", "ภาษีมูลค่าเพิ่ม", "เลขประจำตัวผู้เสียภาษีอากร" are what makes the
 * paper a Thai statutory document. Letting them follow the reader's
 * Accept-Language would mean the seller approves one sheet and the customer
 * prints another, and an English-labelled ใบกำกับภาษี is not a valid one. A
 * per-tenant document language, if it is ever wanted, belongs in document
 * settings rather than in the visitor's browser.
 *
 * Shared by the public link route and the customer portal so both doors serve
 * the same sheet.
 */
export async function documentLabels(): Promise<Record<string, string>> {
  const dictionary = await loadDictionary('th')
  return Object.fromEntries(
    Object.entries(dictionary).filter(([key]) => key.startsWith('orva_documents.')),
  ) as Record<string, string>
}
