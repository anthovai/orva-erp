import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { AccountCreateForm } from '../../../../components/AccountForm'

export default function CreateGlAccountPage() {
  return (
    <Page>
      <PageBody>
        <AccountCreateForm />
      </PageBody>
    </Page>
  )
}
