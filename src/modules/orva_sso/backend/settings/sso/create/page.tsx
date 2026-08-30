"use client"
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
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
