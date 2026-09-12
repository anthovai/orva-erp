import { Page, PageBody } from '@/components/orva/Page'
import { PartyEditForm } from '../../../../components/PartyForm'

export default async function EditPartyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <PartyEditForm id={id} />
      </PageBody>
    </Page>
  )
}
