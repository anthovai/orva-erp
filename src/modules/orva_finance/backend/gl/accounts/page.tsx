import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import AccountsTable from '../../../components/AccountsTable'

export default function GlAccountsPage() {
  return (
    <Page>
      <PageBody>
        <AccountsTable />
      </PageBody>
    </Page>
  )
}
