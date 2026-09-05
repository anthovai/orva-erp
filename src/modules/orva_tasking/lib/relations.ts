/**
 * How tasks link to each other.
 *
 * A row reads left to right: `(taskId, otherTaskId, kind)` means
 * **taskId `kind` otherTaskId** — so `(A, B, 'subtask')` is "A has the subtask
 * B", and `(A, B, 'blocks')` is "A blocks B".
 *
 * Both directions are stored. Reading one task's relations is then a single
 * indexed lookup on `task_id` instead of a union across two columns, and the
 * pair can never fall out of step because they are written in one transaction.
 */

/** What a person picks in the UI. */
export type RelationKind = 'subtask' | 'blocks' | 'related'

/** What is stored — the three above plus the two inverses. */
export type StoredRelationKind = RelationKind | 'parent' | 'blocked_by'

const INVERSE: Record<StoredRelationKind, StoredRelationKind> = {
  subtask: 'parent',
  parent: 'subtask',
  blocks: 'blocked_by',
  blocked_by: 'blocks',
  // `related` is its own inverse: "A relates to B" says nothing about direction.
  related: 'related',
}

export function inverseKind(kind: StoredRelationKind): StoredRelationKind {
  return INVERSE[kind]
}

export type Edge = { from: string; to: string }

/**
 * Would making `parentId` the parent of `childId` close a loop?
 *
 * Returns the offending path when it would, so the message can name the tasks
 * involved rather than saying "cycle detected" and leaving the user to find it.
 * `edges` are the existing parent → child pairs.
 *
 * A cycle here is not a curiosity: a task that is its own ancestor makes
 * progress rollup and every tree render non-terminating.
 */
export function findSubtaskCycle(edges: Edge[], parentId: string, childId: string): string[] | null {
  if (parentId === childId) return [parentId, childId]

  const children = new Map<string, string[]>()
  for (const edge of edges) {
    const list = children.get(edge.from)
    if (list) list.push(edge.to)
    else children.set(edge.from, [edge.to])
  }

  // Walk down from the proposed child. Reaching the proposed parent means the
  // parent is already a descendant, so the new edge would close the loop.
  const stack: string[][] = [[childId]]
  const seen = new Set<string>()
  while (stack.length) {
    const path = stack.pop()!
    const node = path[path.length - 1]
    if (node === parentId) return [parentId, ...path]
    if (seen.has(node)) continue
    seen.add(node)
    for (const next of children.get(node) ?? []) stack.push([...path, next])
  }
  return null
}
