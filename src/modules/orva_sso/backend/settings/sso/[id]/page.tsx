"use client"
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ConnectionEditForm } from '../../../../components/ConnectionForm'

export default function SsoConnectionEditPage({ params }: { params: { id: string } }) {
  return (
    <Page>
      <PageBody>
        <ConnectionEditForm id={params.id} />
      </PageBody>
    </Page>
  )
}
