"use client"
import { Page, PageBody } from '@/components/orva/Page'
import { ConnectionCreateForm } from '../../../../components/ConnectionForm'

export default function SsoConnectionCreatePage() {
  return (
    <Page>
      <PageBody>
        <ConnectionCreateForm />
      </PageBody>
    </Page>
  )
}
