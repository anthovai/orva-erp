import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { PartyCreateForm } from '../../../components/PartyForm'

export default function CreatePartyPage() {
  return (
    <Page>
      <PageBody>
        <PartyCreateForm />
      </PageBody>
    </Page>
  )
}
