import { describe, expect, it } from '@jest/globals'
import { codeFor, planSync, statusFor, summarize, type Link, type TaskingProject, type TimeProject } from '../sync'

const ORG = '00000000-0000-0000-0000-0000000000aa'

const tasking = (over: Partial<TaskingProject> = {}): TaskingProject => ({
  id: '11111111-2222-3333-4444-555555555555',
  organizationId: ORG,
  name: 'AQG Scoring',
  isArchived: false,
  ...over,
})

const time = (over: Partial<TimeProject> = {}): TimeProject => ({
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  organizationId: ORG,
  name: 'AQG Scoring',
  code: codeFor(tasking().id),
  status: 'active',
  ...over,
})

const link = (over: Partial<Link> = {}): Link => ({
  id: 'link-1',
  taskingProjectId: tasking().id,
  timeProjectId: time().id,
  code: codeFor(tasking().id),
  syncedName: 'AQG Scoring',
  syncedStatus: 'active',
  ...over,
})

describe('codeFor', () => {
  it('is stable for the same project and survives a rename', () => {
    expect(codeFor('11111111-2222-3333-4444-555555555555')).toBe('WORK-11111111')
    expect(codeFor('11111111-2222-3333-4444-555555555555')).toBe(codeFor(tasking({ name: 'renamed' }).id))
  })

  it('differs between projects', () => {
    expect(codeFor('99999999-0000-0000-0000-000000000000')).not.toBe(codeFor(tasking().id))
  })
})

describe('statusFor', () => {
  it('completes an archived project and leaves a live one active (Q3)', () => {
    expect(statusFor({ isArchived: true })).toBe('completed')
    expect(statusFor({ isArchived: false })).toBe('active')
  })
})

describe('planSync', () => {
  it('creates a time project for every unlinked tasking project (Q4)', () => {
    const internal = tasking({ id: '77777777-0000-0000-0000-000000000000', name: 'งานภายใน' })
    const actions = planSync([tasking(), internal], [], [])
    expect(actions).toEqual([
      { kind: 'create', taskingProjectId: tasking().id, organizationId: ORG, name: 'AQG Scoring', code: 'WORK-11111111', status: 'active' },
      { kind: 'create', taskingProjectId: internal.id, organizationId: ORG, name: 'งานภายใน', code: 'WORK-77777777', status: 'active' },
    ])
  })

  it('does nothing when both sides already agree — this is what makes it re-runnable', () => {
    expect(planSync([tasking()], [time()], [link()])).toEqual([])
  })

  it('leaves a standalone time project completely alone (Q2: admin, leave)', () => {
    const standalone = time({ id: 'ffffffff-0000-0000-0000-000000000000', name: 'ลาพักร้อน', code: 'ADMIN-1' })
    expect(planSync([], [standalone], [])).toEqual([])
  })

  it('pushes a rename from the tasking side', () => {
    const actions = planSync([tasking({ name: 'AQG Scoring v2' })], [time()], [link()])
    expect(actions).toEqual([
      { kind: 'push', linkId: 'link-1', timeProjectId: time().id, name: 'AQG Scoring v2', status: 'active' },
    ])
  })

  it('pushes an archive as completed, not as a delete', () => {
    const actions = planSync([tasking({ isArchived: true })], [time()], [link()])
    expect(actions).toEqual([
      { kind: 'push', linkId: 'link-1', timeProjectId: time().id, name: 'AQG Scoring', status: 'completed' },
    ])
  })

  it('pulls a rename made on the โครงการ screen back to the work (Q2)', () => {
    const actions = planSync([tasking()], [time({ name: 'AQG (ชื่อใหม่)' })], [link()])
    expect(actions).toEqual([
      { kind: 'pull', linkId: 'link-1', taskingProjectId: tasking().id, name: 'AQG (ชื่อใหม่)', isArchived: false },
    ])
  })

  it('pulls a completion back as an archive', () => {
    const actions = planSync([tasking()], [time({ status: 'completed' })], [link()])
    expect(actions).toEqual([
      { kind: 'pull', linkId: 'link-1', taskingProjectId: tasking().id, name: 'AQG Scoring', isArchived: true },
    ])
  })

  it('reports drift instead of picking a winner when both sides moved', () => {
    const actions = planSync(
      [tasking({ name: 'จากฝั่งงาน' })],
      [time({ name: 'จากฝั่งโครงการ' })],
      [link()],
    )
    expect(actions).toEqual([
      { kind: 'drift', linkId: 'link-1', taskingName: 'จากฝั่งงาน', timeName: 'จากฝั่งโครงการ', syncedName: 'AQG Scoring' },
    ])
  })

  it('does not call it drift when both sides moved to the same value', () => {
    const actions = planSync([tasking({ name: 'ตรงกัน' })], [time({ name: 'ตรงกัน' })], [link()])
    expect(actions).toEqual([])
  })

  /**
   * The loop-breaker, stated as a test: applying a push writes the new value
   * into `syncedName`, and re-planning from there is a no-op. A → B → A cannot
   * continue, on value equality alone.
   */
  it('stops the propagation loop after one hop', () => {
    const renamed = tasking({ name: 'hop 1' })
    const first = planSync([renamed], [time()], [link()])
    expect(first).toHaveLength(1)

    // apply: the time project takes the name, the link records it
    const after = planSync(
      [renamed],
      [time({ name: 'hop 1' })],
      [link({ syncedName: 'hop 1' })],
    )
    expect(after).toEqual([])
  })

  it('reports an orphan when the time project is gone', () => {
    expect(planSync([tasking()], [], [link()])).toEqual([
      { kind: 'orphan', linkId: 'link-1', missing: 'time' },
    ])
  })

  it('reports an orphan when the tasking project is gone', () => {
    expect(planSync([], [time()], [link()])).toEqual([
      { kind: 'orphan', linkId: 'link-1', missing: 'tasking' },
    ])
  })

  it('refuses to write over a code another time project already holds', () => {
    const squatter = time({ id: 'dddddddd-0000-0000-0000-000000000000', code: 'WORK-11111111', name: 'อย่างอื่น' })
    expect(planSync([tasking()], [squatter], [])).toEqual([
      { kind: 'code-collision', taskingProjectId: tasking().id, code: 'WORK-11111111', heldBy: squatter.id },
    ])
  })
})

describe('summarize', () => {
  it('counts every kind, so a dry run cannot report zeros as findings', () => {
    // The importer shipped exactly this bug (afcf17e): a dry run that reported
    // zeros as if they were results. An empty plan must tally to all zeros and
    // the caller must be able to tell that apart from work to do.
    expect(summarize([])).toEqual({ create: 0, push: 0, pull: 0, drift: 0, orphan: 0, 'code-collision': 0 })

    const tally = summarize(planSync([tasking(), tasking({ id: '77777777-0000-0000-0000-000000000000' })], [], []))
    expect(tally.create).toBe(2)
    expect(Object.values(tally).reduce((sum, n) => sum + n, 0)).toBe(2)
  })
})
