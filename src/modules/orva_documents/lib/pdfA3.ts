import {
  AFRelationship,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib'
import { createHash } from 'node:crypto'

/**
 * Upgrades a Chromium-rendered PDF to PDF/A-3u as the ETDA e-Tax programs
 * expect: the ขมธอ.3-2560 XML embedded as ETDA-invoice.xml (AFRelationship
 * /Data, catalog /AF), an sRGB OutputIntent, trailer file identifiers, and an
 * XMP packet with pdfaid part 3 / conformance U plus ETDA's DocumentFileName /
 * DocumentType / Version fields declared through a PDF/A extension schema.
 *
 * Verified against veraPDF (PDF/A-3u profile). Chromium's Thai font subsets
 * map a few glyphs to U+FEFF in their ToUnicode CMaps, which conformance U
 * forbids (ISO 19005-3 6.2.11.7.2) — those entries are rewritten to U+FFFD
 * (replacement character) before saving; text extraction is unaffected for
 * every real character.
 */

export const ETAX_XML_FILENAME = 'ETDA-invoice.xml'
const ETDA_NS = 'https://www.etda.or.th/pdfa3/etax/'

/** CC0 compact sRGB v2 profile (saucecontrol/Compact-ICC-Profiles). */
const SRGB_ICC_BASE64 =
  'AAAC4GxjbXMCEAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5kk7I0qQ6wIoqY/Zqvo2eJmwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJZGVzYwAAAPAAAABfY3BydAAAAQwAAAAMd3RwdAAAARgAAAAUclhZWgAAASwAAAAUZ1hZWgAAAUAAAAAUYlhZWgAAAVQAAAAUclRSQwAAAWgAAAF4Z1RSQwAAAWgAAAF4YlRSQwAAAWgAAAF4ZGVzYwAAAAAAAAAFc1JHQgAAAAAAAAAAAAAAAHRleHQAAAAAQ0MwAFhZWiAAAAAAAADzVAABAAAAARbJWFlaIAAAAAAAAG+gAAA48gAAA49YWVogAAAAAAAAYpYAALeJAAAY2lhZWiAAAAAAAAAkoAAAD4UAALbEY3VydgAAAAAAAAC2AAAAHAA4AFQAcACMAKgAxADhAQABIgFGAW0BlQHBAfACIAJVAosCxAMBAz8DggPGBA4EWQSnBPkFTAWkBf4GXAa+ByEHigf0CGMI1QlJCcMKPwq/C0ILyQxUDOENdA4JDqIPQA/gEIURLRHaEooTPhP2FLIVcRY2Fv0XyhiZGW4aRhsiHAMc5x3QHr0friCkIZ4inCOfJKUlsSbAJ9Uo7SoKKyssUS18Lqov3jEWMlIzlDTZNiQ3czjGOiA7fDzfPkU/sEEhQpZEEEWPRxJIm0ooS7tNUU7uUI9SNVPgVZBXRVkAWr5chF5MYBth72PHZaZniWlxa19tUW9KcUZzSnVRd155cXuIfaZ/yIHwhB6GUIiJisWNCY9RkZ+T85ZLmKubDp14n+eiW6TWp1ap26xnrvexj7Qqtsy5dLwhvtXBjcRMxxDJ2syrz3/SXNU92CTbEt4E4P7j/OcB6gztHPA080D2c/mb/Mr//w=='

const xmlEscape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function buildXmp(args: { title: string; documentType: string; createDate: string }): string {
  const { title, documentType, createDate } = args
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>U</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(title)}</rdf:li></rdf:Alt></dc:title>
      <dc:format>application/pdf</dc:format>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreateDate>${createDate}</xmp:CreateDate>
      <xmp:ModifyDate>${createDate}</xmp:ModifyDate>
      <xmp:CreatorTool>Orva ERP</xmp:CreatorTool>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
      <pdf:Producer>Orva ERP</pdf:Producer>
    </rdf:Description>
    <rdf:Description rdf:about=""
      xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
      xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
      xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>ETDA e-Tax Invoice PDF/A-3 schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>${ETDA_NS}</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>etda</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>DocumentFileName</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>Name of the embedded e-Tax XML file</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>DocumentType</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>Tax Invoice, Receipt, Credit Note or Debit Note</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>Version</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>Schema version of the embedded XML</pdfaProperty:description>
                </rdf:li>
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:etda="${ETDA_NS}">
      <etda:DocumentFileName>${ETAX_XML_FILENAME}</etda:DocumentFileName>
      <etda:DocumentType>${xmlEscape(documentType)}</etda:DocumentType>
      <etda:Version>2.0</etda:Version>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
}

/**
 * ISO 19005-3 6.2.11.7.2: every ToUnicode destination must be > 0 and not
 * U+FEFF / U+FFFE. Chromium's subsetter emits U+FEFF for shaping-only glyphs
 * in Thai fonts; rewrite those destinations to U+FFFD.
 */
function sanitizeToUnicodeMaps(doc: PDFDocument): number {
  const context = doc.context
  const seen = new Set<string>()
  let rewritten = 0
  for (const [, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue
    if (object.lookupMaybe(PDFName.of('Type'), PDFName)?.decodeText() !== 'Font') continue
    const ref = object.get(PDFName.of('ToUnicode'))
    if (!(ref instanceof PDFRef) || seen.has(ref.toString())) continue
    seen.add(ref.toString())
    const stream = context.lookup(ref)
    if (!(stream instanceof PDFRawStream)) continue
    const cmap = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')
    // the destination is the LAST hex token on bfchar / bfrange lines
    const fixed = cmap.replace(
      /^(\s*<[0-9A-Fa-f]+>(?:\s*<[0-9A-Fa-f]+>)?\s*)<(FEFF|FFFE|0000)>\s*$/gim,
      '$1<FFFD>',
    )
    if (fixed === cmap) continue
    rewritten++
    context.assign(ref, context.flateStream(Buffer.from(fixed, 'latin1')))
  }
  return rewritten
}

export async function toPdfA3(args: {
  pdf: Uint8Array
  xml: string
  /** dc:title in XMP, e.g. "ใบกำกับภาษี/ใบเสร็จรับเงิน KK-INV-2026012". */
  title: string
  /** ETDA XMP DocumentType: "Tax Invoice" | "Receipt". */
  documentType: string
}): Promise<Uint8Array> {
  const doc = await PDFDocument.load(args.pdf, { updateMetadata: false })
  const context = doc.context
  const catalog = doc.catalog

  // 1) the machine-readable invoice, embedded per the program's naming
  await doc.attach(new TextEncoder().encode(args.xml), ETAX_XML_FILENAME, {
    mimeType: 'text/xml',
    description: 'e-Tax Invoice XML (ขมธอ. 3-2560 v2.0)',
    creationDate: new Date(),
    modificationDate: new Date(),
    afRelationship: AFRelationship.Data,
  })

  // 2) catalog /AF — PDF/A-3 wants the associated-files array on the catalog
  const names = catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
  const embedded = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict)
  const embeddedNames = embedded?.lookupMaybe(PDFName.of('Names'), PDFArray)
  if (embeddedNames) {
    const af = PDFArray.withContext(context)
    for (let i = 1; i < embeddedNames.size(); i += 2) af.push(embeddedNames.get(i))
    catalog.set(PDFName.of('AF'), af)
  }

  // 3) sRGB OutputIntent — device-independent colour
  const iccBytes = Uint8Array.from(Buffer.from(SRGB_ICC_BASE64, 'base64'))
  const iccRef = context.register(context.flateStream(iccBytes, { N: 3 }))
  const outputIntent = context.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    DestOutputProfile: iccRef,
  })
  const intents = PDFArray.withContext(context)
  intents.push(context.register(outputIntent))
  catalog.set(PDFName.of('OutputIntents'), intents)

  // 4) XMP metadata with the pdfaid identification + declared ETDA fields
  const now = new Date()
  const xmp = buildXmp({ title: args.title, documentType: args.documentType, createDate: now.toISOString() })
  const metadataStream = context.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' })
  catalog.set(PDFName.of('Metadata'), context.register(metadataStream))
  doc.setTitle(args.title)
  doc.setProducer('Orva ERP')
  doc.setCreator('Orva ERP')
  doc.setCreationDate(now)
  doc.setModificationDate(now)

  // 5) ToUnicode hygiene for conformance U
  sanitizeToUnicodeMaps(doc)

  // 6) trailer file identifiers (ISO 19005 6.1.3)
  const id = createHash('md5').update(args.xml).update(args.title).update(String(now.getTime())).digest('hex')
  const ids = PDFArray.withContext(context)
  ids.push(PDFHexString.of(id))
  ids.push(PDFHexString.of(id))
  context.trailerInfo.ID = ids

  return doc.save({ useObjectStreams: false })
}
