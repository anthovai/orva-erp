import { Page, PageBody } from '@/components/orva/Page'
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
