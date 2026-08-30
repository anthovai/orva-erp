import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { PeriodCreateForm } from '../../../../components/PeriodForm'

export default function CreateFiscalPeriodPage() {
  return (
    <Page>
      <PageBody>
        <PeriodCreateForm />
      </PageBody>
    </Page>
  )
}
