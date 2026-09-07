import { describe, expect, it } from '@jest/globals'
import type { ApiInterceptor, InterceptorContext, InterceptorRequest } from '@open-mercato/shared/lib/crud/api-interceptor'
import { interceptors } from '../interceptors'

/**
 * The `code` lock, tested at the interceptor rather than through HTTP.
 *
 * Authentication runs before interceptors, so a request without a session
 * never reaches this code — which makes an unauthenticated curl useless as
 * proof. Calling `before` with a stubbed context tests the decision itself:
 * which requests it lets through, which it refuses, and what it says when it
 * refuses.
 */

const TENANT = '26c5f11c-e19d-4f79-8696-cbb33a92d82f'
const TIME_PROJECT = 'a8838b06-437b-4036-bd6c-06e40b949f50'

const lock = interceptors.find((entry) => entry.id === 'orva_time.time-project.lock-code') as ApiInterceptor

/** A context whose `em.execute` answers with the rows the lock asks for. */
function contextWith(rows: { code: string; tasking_name: string }[]): InterceptorContext {
  return {
    userId: 'u1',
    organizationId: 'o1',
    tenantId: TENANT,
    em: { execute: async () => rows } as unknown as InterceptorContext['em'],
    container: {} as InterceptorContext['container'],
  }
}

const request = (body: Record<string, unknown>, url = '/api/staff/timesheets/time-projects'): InterceptorRequest => ({
  method: 'PUT',
  url,
  body,
  headers: {},
})

describe('the code lock', () => {
  it('is registered for the writes that can change a code', () => {
    expect(lock).toBeDefined()
    expect(lock.targetRoute).toBe('staff/timesheets/time-projects')
    expect(lock.methods).toEqual(['PUT', 'PATCH'])
  })

  it('refuses a code change on a linked row, naming the project that owns it', async () => {
    const result = await lock.before!(
      request({ id: TIME_PROJECT, code: 'HIJACKED' }),
      contextWith([{ code: 'WORK-444D7C34', tasking_name: 'Price Checker' }]),
    )
    expect(result.ok).toBe(false)
    expect(result.statusCode).toBe(409)
    expect(result.message).toContain('Price Checker')
    expect(result.message).toContain('WORK-444D7C34')
  })

  it('lets a write through when the code is unchanged', async () => {
    const result = await lock.before!(
      request({ id: TIME_PROJECT, code: 'WORK-444D7C34', name: 'a new name' }),
      contextWith([{ code: 'WORK-444D7C34', tasking_name: 'Price Checker' }]),
    )
    expect(result.ok).toBe(true)
  })

  it('lets a write through when the row is not linked — a standalone โครงการ owns its own code', async () => {
    const result = await lock.before!(
      request({ id: TIME_PROJECT, code: 'ADMIN-1' }),
      contextWith([]),
    )
    expect(result.ok).toBe(true)
  })

  it('ignores a write that does not touch the code at all', async () => {
    const result = await lock.before!(
      request({ id: TIME_PROJECT, name: 'renamed on the โครงการ screen' }),
      contextWith([{ code: 'WORK-444D7C34', tasking_name: 'Price Checker' }]),
    )
    expect(result.ok).toBe(true)
  })

  it('finds the row id in the path as well as the body', async () => {
    const result = await lock.before!(
      request({ code: 'HIJACKED' }, `/api/staff/timesheets/time-projects/${TIME_PROJECT}`),
      contextWith([{ code: 'WORK-444D7C34', tasking_name: 'Price Checker' }]),
    )
    expect(result.ok).toBe(false)
  })

  it('finds the row id in the query string', async () => {
    const result = await lock.before!(
      request({ code: 'HIJACKED' }, `/api/staff/timesheets/time-projects?id=${TIME_PROJECT}`),
      contextWith([{ code: 'WORK-444D7C34', tasking_name: 'Price Checker' }]),
    )
    expect(result.ok).toBe(false)
  })

  it('lets a write through when no id can be found, rather than guessing', async () => {
    const result = await lock.before!(
      request({ code: 'ANYTHING' }, '/api/staff/timesheets/time-projects'),
      contextWith([{ code: 'WORK-444D7C34', tasking_name: 'Price Checker' }]),
    )
    expect(result.ok).toBe(true)
  })
})

describe('the propagation interceptor', () => {
  const propagate = interceptors.find((entry) => entry.id === 'orva_time.time-project.propagate') as ApiInterceptor

  it('is registered for creates as well as updates', () => {
    expect(propagate.methods).toEqual(['PUT', 'PATCH', 'POST'])
  })

  it('does nothing after a failed write', async () => {
    let executed = false
    const context = {
      ...contextWith([]),
      em: { execute: async () => { executed = true; return [] } } as unknown as InterceptorContext['em'],
    }
    const result = await propagate.after!(
      request({}),
      { statusCode: 422, body: {}, headers: {} },
      context,
    )
    expect(result).toEqual({})
    expect(executed).toBe(false)
  })

  /**
   * A mirror that cannot follow must not fail the owner's save. The reconcile
   * command is the safety net, and this is the test that says so.
   */
  it('swallows its own failure so the save still succeeds', async () => {
    const context = {
      ...contextWith([]),
      em: { execute: async () => { throw new Error('database gone') } } as unknown as InterceptorContext['em'],
    }
    await expect(
      propagate.after!(request({}), { statusCode: 200, body: {}, headers: {} }, context),
    ).resolves.toEqual({})
  })
})
