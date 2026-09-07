/** The task shape `/api/orva_tasking/tasks` returns, shared by every view. */
export type BoardTask = {
  id: string
  projectId: string
  title: string
  description: string | null
  done: boolean
  doneAt: string | null
  dueOn: string | null
  startDate: string | null
  endDate: string | null
  percentDone: number
  identifier: string
  bucketId: string | null
  assigneeUserId: string | null
  repeatEveryDays: number | null
  repeatMode: 'from_due' | 'from_completion' | null
  labels: { id: string; title: string; hexColor: string }[]
  commentCount: number
  relationCount: number
  daysOverdue: number
  priority: number
  updatedAt: string
}

export type TaskProjectSummary = {
  id: string
  name: string
  description: string | null
  quoteId: string | null
  quoteNumber: string | null
  isArchived: boolean
  customerVisible: boolean
  customerLabel: string | null
  total: number
  done: number
  donePct: number
  overdue: number
  updatedAt: string
}
