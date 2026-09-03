import {
  AFRelationship,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFString,
} from 'pdf-lib'

/**
 * Upgrades a Chromium-rendered PDF to the PDF/A-3 shape the ETDA e-Tax
 * programs expect: the ขมธอ.3-2560 XML embedded as ETDA-invoice.xml
 * (AFRelationship /Data, catalog /AF array), an sRGB OutputIntent, and an
 * XMP packet declaring pdfaid part 3 / conformance U plus ETDA's
 * DocumentFileName / DocumentType / Version fields — the required XMP list
 * from ETDA's PDF/A-3 workshop.
 *
 * Chromium already embeds fonts as subsets with ToUnicode maps, which is
 * what conformance U cares about. Full ISO 19005-3 conformance should still
 * be validated once against veraPDF / the RD validator before production
 * filing — a converter can add structures but cannot prove the renderer's
 * output clean.
 */

export const ETAX_XML_FILENAME = 'ETDA-invoice.xml'

/** CC0 compact sRGB v2 profile (saucecontrol/Compact-ICC-Profiles). */
const SRGB_ICC_BASE64 =
  'AAAC4GxjbXMCEAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5kk7I0qQ6wIoqY/Zqvo2eJmwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJZGVzYwAAAPAAAABfY3BydAAAAQwAAAAMd3RwdAAAARgAAAAUclhZWgAAASwAAAAUZ1hZWgAAAUAAAAAUYlhZWgAAAVQAAAAUclRSQwAAAWgAAAF4Z1RSQwAAAWgAAAF4YlRSQwAAAWgAAAF4ZGVzYwAAAAAAAAAFc1JHQgAAAAAAAAAAAAAAAHRleHQAAAAAQ0MwAFhZWiAAAAAAAADzVAABAAAAARbJWFlaIAAAAAAAAG+gAAA48gAAA49YWVogAAAAAAAAYpYAALeJAAAY2lhZWiAAAAAAAAAkoAAAD4UAALbEY3VydgAAAAAAAAC2AAAAHAA4AFQAcACMAKgAxADhAQABIgFGAW0BlQHBAfACIAJVAosCxAMBAz8DggPGBA4EWQSnBPkFTAWkBf4GXAa+ByEHigf0CGMI1QlJCcMKPwq/C0ILyQxUDOENdA4JDqIPQA/gEIURLRHaEooTPhP2FLIVcRY2Fv0XyhiZGW4aRhsiHAMc5x3QHr0friCkIZ4inCOfJKUlsSbAJ9Uo7SoKKyssUS18Lqov3jEWMlIzlDTZNiQ3czjGOiA7fDzfPkU/sEEhQpZEEEWPRxJIm0ooS7tNUU7uUI9SNVPgVZBXRVkAWr5chF5MYBth72PHZaZniWlxa19tUW9KcUZzSnVRd155cXuIfaZ/yIHwhB6GUIiJisWNCY9RkZ+T85ZLmKubDp14n+eiW6TWp1ap26xnrvexj7Qqtsy5dLwhvtXBjcRMxxDJ2syrz3/SXNU92CTbEt4E4P7j/OcB6gztHPA080D2c/mb/Mr//w=='

const xmlEscape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function buildXmp(args: { title: string; documentType: string; createDate: string }): string {
  const { title, documentType, createDate } = args
  // ETDA's required XMP fields ride in an ETDA extension schema alongside the
  // standard pdfaid identification block.
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
      <xmp:CreatorTool>Orva ERP</xmp:CreatorTool>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:etda="https://www.etda.or.th/pdfa3/etax/">
      <etda:DocumentFileName>${ETAX_XML_FILENAME}</etda:DocumentFileName>
      <etda:DocumentType>${xmlEscape(documentType)}</etda:DocumentType>
      <etda:Version>2.0</etda:Version>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
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

  // 1) the machine-readable invoice, embedded per the program's naming
  await doc.attach(new TextEncoder().encode(args.xml), ETAX_XML_FILENAME, {
    mimeType: 'text/xml',
    description: 'e-Tax Invoice XML (ขมธอ. 3-2560 v2.0)',
    creationDate: new Date(),
    modificationDate: new Date(),
    afRelationship: AFRelationship.Data,
  })

  const context = doc.context
  const catalog = doc.catalog

  // 2) catalog /AF — pdf-lib registers the attachment in the name tree but
  //    PDF/A-3 additionally wants the associated-files array on the catalog
  const names = catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
  const embedded = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict)
  const embeddedNames = embedded?.lookupMaybe(PDFName.of('Names'), PDFArray)
  if (embeddedNames) {
    const af = PDFArray.withContext(context)
    // the Names array alternates [name, filespecRef, ...]
    for (let i = 1; i < embeddedNames.size(); i += 2) af.push(embeddedNames.get(i))
    catalog.set(PDFName.of('AF'), af)
  }

  // 3) sRGB OutputIntent — device-independent colour, a PDF/A requirement
  const iccBytes = Uint8Array.from(Buffer.from(SRGB_ICC_BASE64, 'base64'))
  const iccStream = context.flateStream(iccBytes, { N: 3 })
  const iccRef = context.register(iccStream)
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

  // 4) XMP metadata with the pdfaid identification + ETDA fields
  const xmp = buildXmp({
    title: args.title,
    documentType: args.documentType,
    createDate: new Date().toISOString(),
  })
  const metadataStream = context.stream(new TextEncoder().encode(xmp), {
    Type: 'Metadata',
    Subtype: 'XML',
  })
  catalog.set(PDFName.of('Metadata'), context.register(metadataStream))

  doc.setTitle(args.title)
  doc.setProducer('Orva ERP')
  doc.setCreator('Orva ERP')

  return doc.save({ useObjectStreams: false })
}
