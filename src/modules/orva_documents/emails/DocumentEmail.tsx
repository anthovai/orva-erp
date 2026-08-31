import * as React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Section, Text } from '@react-email/components'

export type DocumentEmailCopy = {
  preview: string
  heading: string
  intro: string
  total: string
  attachmentNote: string
  footer: string
}

/**
 * Cover note for a document sent as a PDF attachment. Deliberately plain:
 * the document is the message, the email only says what is attached and what
 * it totals so the recipient can triage without opening the file.
 */
export function DocumentEmail({ copy }: { copy: DocumentEmailCopy }) {
  return (
    <Html>
      <Head />
      <Preview>{copy.preview}</Preview>
      <Body style={{ backgroundColor: '#F8FAF9', fontFamily: 'Segoe UI, Tahoma, sans-serif', margin: 0, padding: '24px' }}>
        <Container style={{ backgroundColor: '#FFFFFF', borderRadius: '12px', padding: '32px', maxWidth: '560px' }}>
          <Heading style={{ color: '#0A4A3E', fontSize: '20px', margin: '0 0 12px' }}>{copy.heading}</Heading>
          <Text style={{ color: '#26332F', fontSize: '14px', lineHeight: '22px', margin: '0 0 16px' }}>{copy.intro}</Text>
          <Section style={{ backgroundColor: '#F1F5F3', borderRadius: '8px', padding: '16px', margin: '0 0 16px' }}>
            <Text style={{ color: '#111816', fontSize: '16px', fontWeight: 600, margin: 0 }}>{copy.total}</Text>
          </Section>
          <Text style={{ color: '#52615D', fontSize: '13px', lineHeight: '20px', margin: '0 0 24px' }}>{copy.attachmentNote}</Text>
          <Text style={{ color: '#9AA9A4', fontSize: '12px', margin: 0 }}>{copy.footer}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export default DocumentEmail
