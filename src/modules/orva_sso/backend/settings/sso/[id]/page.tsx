"use client"
import { Page, PageBody } from '@/components/orva/Page'
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
