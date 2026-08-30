import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { AccountEditForm } from '../../../../../components/AccountForm'

export default async function EditGlAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <AccountEditForm id={id} />
      </PageBody>
    </Page>
  )
}
