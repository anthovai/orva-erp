"use client"
import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { BoardTask } from './taskTypes'

export type TaskFilters = {
  assigneeUserId?: string
  labelId?: string
  dueWithinDays?: number
  showDone: boolean
}

/**
 * The list, with sorting and the four filters the team actually uses.
 *
 * One table, not the list-plus-table pair Vikunja carries. A separate
 * unsortable list would be the same rows with fewer affordances, and the quick
 * add and the checkbox belong on the surface people read every day.
 */
export function TaskTableView({
  tasks,
  isLoading,
  error,
  labels,
  assignees,
  filters,
  onFiltersChange,
  onOpenTask,
  onToggleDone,
  onQuickAdd,
  busy,
  canAdd,
}: {
  tasks: BoardTask[]
  isLoading: boolean
  error: string | null
  labels: { id: string; title: string }[]
  assignees: { id: string; name: string }[]
  filters: TaskFilters
  onFiltersChange: (next: TaskFilters) => void
  onOpenTask: (id: string) => void
  onToggleDone: (task: BoardTask) => void
  onQuickAdd: (title: string, dueOn: string) => Promise<void>
  busy: boolean
  canAdd: boolean
}) {
  const t = useT()
  const [title, setTitle] = React.useState('')
  const [dueOn, setDueOn] = React.useState('')

  const assigneeName = React.useCallback(
    (id: string | null) => (id ? assignees.find((person) => person.id === id)?.name ?? '—' : '—'),
    [assignees],
  )

  const columns = React.useMemo<ColumnDef<BoardTask, unknown>[]>(() => [
    {
      id: 'done',
      header: '',
      enableSorting: false,
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={row.original.done}
          disabled={busy}
          onClick={(event) => event.stopPropagation()}
          onChange={() => onToggleDone(row.original)}
          aria-label={t('orva_tasking.toggle', 'ทำเครื่องหมายว่าเสร็จ')}
        />
      ),
    },
    {
      id: 'title',
      accessorFn: (row) => row.title,
      header: t('orva_tasking.col.task', 'งาน'),
      cell: ({ row }) => (
        <span>
          <span className={row.original.done ? 'text-muted-foreground line-through' : ''}>{row.original.title}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {row.original.percentDone > 0 && !row.original.done ? `${row.original.percentDone}%` : null}
            {row.original.commentCount > 0 ? ` 💬${row.original.commentCount}` : null}
            {row.original.relationCount > 0 ? ` ⛓${row.original.relationCount}` : null}
          </span>
        </span>
      ),
    },
    {
      id: 'labels',
      header: t('orva_tasking.col.labels', 'ป้ายกำกับ'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex flex-wrap gap-1">
          {row.original.labels.map((label) => (
            <span key={label.id} className="rounded-full border px-2 py-0.5 text-xs">
              <span
                aria-hidden="true"
                className="mr-1 inline-block size-2 rounded-full align-middle"
                style={{ backgroundColor: label.hexColor }}
              />
              {label.title}
            </span>
          ))}
        </span>
      ),
    },
    {
      id: 'assignee',
      accessorFn: (row) => assigneeName(row.assigneeUserId),
      header: t('orva_tasking.col.assignee', 'ผู้รับผิดชอบ'),
      cell: ({ row }) => <span className="text-sm">{assigneeName(row.original.assigneeUserId)}</span>,
    },
    {
      id: 'dueOn',
      accessorFn: (row) => row.dueOn ?? '',
      header: t('orva_tasking.col.due', 'กำหนดเสร็จ'),
      cell: ({ row }) => (
        row.original.dueOn ? (
          <span className={`tabular-nums ${row.original.daysOverdue > 0 ? 'text-status-error-text' : 'text-muted-foreground'}`}>
            {row.original.dueOn}
            {row.original.daysOverdue > 0
              ? ` · ${t('orva_tasking.overdue', 'เลย {days} วัน').replace('{days}', String(row.original.daysOverdue))}`
              : ''}
          </span>
        ) : <span className="text-muted-foreground">—</span>
      ),
    },
  ], [assigneeName, busy, onToggleDone, t])

  const filterDefs = React.useMemo<FilterDef[]>(() => [
    {
      id: 'assigneeUserId',
      label: t('orva_tasking.col.assignee', 'ผู้รับผิดชอบ'),
      type: 'select',
      options: assignees.map((person) => ({ value: person.id, label: person.name })),
    },
    {
      id: 'labelId',
      label: t('orva_tasking.field.labels', 'ป้ายกำกับ'),
      type: 'select',
      options: labels.map((label) => ({ value: label.id, label: label.title })),
    },
    {
      id: 'dueWithinDays',
      label: t('orva_tasking.filter.due', 'ครบกำหนดภายใน'),
      type: 'select',
      options: [
        { value: '0', label: t('orva_tasking.filter.dueToday', 'วันนี้และที่เลยกำหนด') },
        { value: '7', label: t('orva_tasking.filter.due7', '7 วัน') },
        { value: '30', label: t('orva_tasking.filter.due30', '30 วัน') },
      ],
    },
    {
      id: 'showDone',
      label: t('orva_tasking.showDone', 'แสดงงานที่เสร็จแล้ว'),
      type: 'checkbox',
    },
  ], [assignees, labels, t])

  const filterValues: FilterValues = {
    assigneeUserId: filters.assigneeUserId ?? '',
    labelId: filters.labelId ?? '',
    dueWithinDays: filters.dueWithinDays === undefined ? '' : String(filters.dueWithinDays),
    showDone: filters.showDone,
  }

  const applyFilters = (values: FilterValues) => {
    const due = values.dueWithinDays === '' || values.dueWithinDays == null
      ? undefined
      : Number(values.dueWithinDays)
    onFiltersChange({
      assigneeUserId: values.assigneeUserId || undefined,
      labelId: values.labelId || undefined,
      dueWithinDays: Number.isFinite(due) ? (due as number) : undefined,
      showDone: Boolean(values.showDone),
    })
  }

  const hasFilters = Boolean(
    filters.assigneeUserId || filters.labelId || filters.dueWithinDays !== undefined,
  )

  return (
    <div className="space-y-3">
      {canAdd ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            if (!title.trim()) return
            await onQuickAdd(title, dueOn)
            setTitle('')
            setDueOn('')
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <Input
            className="max-w-96"
            value={title}
            maxLength={250}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('orva_tasking.newTask', 'เพิ่มงานใหม่…')}
            aria-label={t('orva_tasking.newTask', 'เพิ่มงานใหม่…')}
          />
          <Input
            type="date"
            className="w-44"
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
            aria-label={t('orva_tasking.col.due', 'กำหนดเสร็จ')}
          />
          <Button type="submit" disabled={busy || !title.trim()}>{t('orva_tasking.add', 'เพิ่ม')}</Button>
        </form>
      ) : null}

      <DataTable<BoardTask>
        columns={columns}
        data={tasks}
        isLoading={isLoading}
        error={error}
        sortable
        onRowClick={(row) => onOpenTask(row.id)}
        filters={filterDefs}
        filterValues={filterValues}
        onFiltersApply={applyFilters}
        onFiltersClear={() => onFiltersChange({ showDone: filters.showDone })}
        emptyState={
          <p className="text-sm text-muted-foreground">
            {hasFilters
              ? t('orva_tasking.noMatches', 'ไม่มีงานที่ตรงกับตัวกรอง — ล้างตัวกรองเพื่อดูทั้งหมด')
              : t('orva_tasking.empty', 'ยังไม่มีงานค้างในโปรเจกต์นี้')}
          </p>
        }
      />
    </div>
  )
}

export default TaskTableView
