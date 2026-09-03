import type { PrintableDocument } from './document'

/**
 * ขมธอ. 3-2560 v2.0 (ETDA TaxInvoice_CrossIndustryInvoice) XML — the
 * machine-readable half of an e-Tax PDF/A-3, embedded as ETDA-invoice.xml.
 *
 * Field mapping follows ETDA's PDF/A-3 workshop and the soda-etax samples:
 * TXID = 13-digit taxpayer id + 5-digit branch (สำนักงานใหญ่ = 00000),
 * document type codes T02 (ใบแจ้งหนี้/ใบกำกับภาษี) and T03
 * (ใบเสร็จรับเงิน/ใบกำกับภาษี), dates as UNCEFACT format 102 (YYYYMMDD).
 * Validate the first real file against the RD XSD (etax.rd.go.th
 * XMLSchemaV2.zip) before relying on it.
 */

const esc = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const money = (value: number) => value.toFixed(2)

/** สำนักงานใหญ่ → 00000; a 5-digit branch code passes through. */
export function branchCode(branch: string | null | undefined): string {
  const digits = String(branch ?? '').match(/\d{5}/)?.[0]
  return digits ?? '00000'
}

const txid = (taxId: string | null | undefined, branch: string | null | undefined) =>
  `${String(taxId ?? '').replace(/\D/g, '')}${branchCode(branch)}`

const postcode = (address: string | null | undefined) =>
  String(address ?? '').match(/\b\d{5}\b(?!.*\b\d{5}\b)/)?.[0] ?? '00000'

const dateFormat102 = (isoDate: string) => isoDate.replace(/-/g, '')

export const ETAX_TYPE_CODES = {
  tax_invoice: { code: 'T02', name: 'ใบแจ้งหนี้/ใบกำกับภาษี', subjectTag: 'INV' },
  receipt: { code: 'T03', name: 'ใบเสร็จรับเงิน/ใบกำกับภาษี', subjectTag: 'RCT' },
} as const

export type EtaxDocumentType = keyof typeof ETAX_TYPE_CODES

/**
 * The program's email subject: [issue date, Buddhist era ddMMyyyy][type tag]
 * [document number] — e.g. [02092569][INV][KK-INV-2026012].
 */
export function etaxSubject(doc: PrintableDocument, type: EtaxDocumentType): string {
  const [y, m, d] = doc.issueDate.split('-')
  const buddhistYear = Number(y) + 543
  return `[${d}${m}${buddhistYear}][${ETAX_TYPE_CODES[type].subjectTag}][${doc.number}]`
}

function tradeParty(tag: string, party: PrintableDocument['seller'] | PrintableDocument['buyer']): string {
  const name = ('legalName' in party ? party.legalName : null) ?? party.name
  return `      <ram:${tag}>
        <ram:Name>${esc(name)}</ram:Name>
        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="TXID">${txid(party.taxId, party.branch)}</ram:ID>
        </ram:SpecifiedTaxRegistration>
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>${postcode(party.address)}</ram:PostcodeCode>
          <ram:LineOne>${esc(party.address ?? '-')}</ram:LineOne>
          <ram:CountryID schemeID="ISO3166-1">TH</ram:CountryID>
        </ram:PostalTradeAddress>
      </ram:${tag}>`
}

export function buildEtaxXml(doc: PrintableDocument, type: EtaxDocumentType): string {
  const meta = ETAX_TYPE_CODES[type]
  const issue = dateFormat102(doc.issueDate)
  const lines = doc.lines
    .map(
      (line, index) => `    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>${index + 1}</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>${esc(line.description)}</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:GrossPriceProductTradePrice>
          <ram:ChargeAmount currencyID="${doc.currencyCode}">${money(line.unitPrice)}</ram:ChargeAmount>
        </ram:GrossPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="C62">${line.quantity}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CalculatedRate>${doc.taxRate ?? 7}</ram:CalculatedRate>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:NetLineTotalAmount currencyID="${doc.currencyCode}">${money(line.amount)}</ram:NetLineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`,
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:TaxInvoice_CrossIndustryInvoice
  xmlns:rsm="urn:etda:uncefact:data:standard:TaxInvoice_CrossIndustryInvoice:2"
  xmlns:ram="urn:etda:uncefact:data:standard:TaxInvoice_ReusableAggregateBusinessInformationEntity:2"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID schemeAgencyID="ETDA" schemeVersionID="v2.0">ER3-2560</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${esc(doc.number)}</ram:ID>
    <ram:Name>${meta.name}</ram:Name>
    <ram:TypeCode>${meta.code}</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">${issue}</udt:DateTimeString>
    </ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
${tradeParty('SellerTradeParty', doc.seller)}
${tradeParty('BuyerTradeParty', doc.buyer)}
    </ram:ApplicableHeaderTradeAgreement>
${lines}
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${doc.currencyCode}</ram:InvoiceCurrencyCode>
      <ram:ApplicableTradeTax>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:CalculatedRate>${doc.taxRate ?? 7}</ram:CalculatedRate>
        <ram:BasisAmount currencyID="${doc.currencyCode}">${money(doc.subtotal - doc.discount)}</ram:BasisAmount>
        <ram:CalculatedAmount currencyID="${doc.currencyCode}">${money(doc.taxAmount)}</ram:CalculatedAmount>
      </ram:ApplicableTradeTax>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:TaxBasisTotalAmount currencyID="${doc.currencyCode}">${money(doc.subtotal - doc.discount)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${doc.currencyCode}">${money(doc.taxAmount)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount currencyID="${doc.currencyCode}">${money(doc.grandTotal)}</ram:GrandTotalAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:TaxInvoice_CrossIndustryInvoice>
`
}
