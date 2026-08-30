import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import PayrollRunsTable from '../../../components/PayrollRunsTable'

export default function HrPayrollPage() {
  return (
    <Page>
      <PageBody>
        <PayrollRunsTable />
      </PageBody>
    </Page>
  )
}
