import { Page, PageBody } from '@/components/orva/Page'
import { TodoCreateForm } from '../../../components/TodoForm'

export default function CreateTodoPage() {
  return (
    <Page>
      <PageBody>
        <TodoCreateForm />
      </PageBody>
    </Page>
  )
}
