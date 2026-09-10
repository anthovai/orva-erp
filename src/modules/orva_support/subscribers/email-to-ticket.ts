import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { withTenantRls } from '@/lib/rls'
import { SupportTicket } from '../data/entities'
import { guessKind, matchCustomer, inferProject, type Contact, type ProjectRef } from '../lib/emailTriage'
import { ticketNoFromSubject, ticketNumber } from '../lib/tickets'

/**
 * A client email becomes a support ticket, already attached to the customer
 * and — when the evidence is unambiguous — to the project it concerns.
 *
 * This answers the owner's original ask: know about a problem before the
 * client has to chase. An email that arrives while they are at their day job
 * lands on the queue with its customer resolved, instead of sitting in Gmail
 * until somebody reads it.
 *
 * The attachment is deliberately conservative (see lib/emailTriage.ts): an
 * unattached ticket asks a question, whereas one filed against the wrong
 * client is read as fact by everything downstream.
 */
const logger = createLogger('orva_support').child({ component: 'email-to-ticket' })

export const metadata = {
  event: 'inbox_ops.email.processed',
  persistent: true,
  id: 'orva_support:email-to-ticket',
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
  container?: { resolve<T = unknown>(name: string): T }
  tenantId?: string | null
  organizationId?: string | null
}

const str = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

type EmailRow = {
  id: string
  sender: string | null
  subject: string | null
  body: string | null
  message_id: string | null
  in_reply_to: string | null
}

export default async function handle(payload: unknown, ctx: ResolverContext): Promise<void> {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const emailId = str(record, 'emailId') ?? str(record, 'id')
  // The emitter puts scope in the payload (see inbox_ops extractionWorker);
  // the context may or may not carry it depending on the transport, so the
  // payload wins and the context is the fallback. Reading only the context
  // would make this handler do nothing at all, silently.
  const tenantId = str(record, 'tenantId') ?? ctx.tenantId ?? null
  const organizationId = str(record, 'organizationId') ?? ctx.organizationId ?? null
  if (!emailId || !tenantId || !organizationId) {
    logger.warn('Ignoring an email event with no usable scope', { emailId })
    return
  }

  const em = (ctx.container?.resolve('em') ?? ctx.resolve('em')) as EntityManager

  try {
    await withTenantRls(em, tenantId, async (tem) => {
      const [email] = (await tem.execute(
        `select id::text, forwarded_by_address as sender, subject,
                coalesce(cleaned_text, raw_text) as body,
                message_id, in_reply_to
         from inbox_emails
         where id = ?::uuid and tenant_id = ?::uuid`,
        [emailId, tenantId],
      )) as EmailRow[]
      if (!email) return

      // A reply on a thread we already track belongs on that ticket, as the
      // customer's own words — not as a second ticket about the same problem.
      // Two ways to recognise the thread: the ticket number our own emailed
      // reply put in the subject (the answer to a Resend-sent mail carries an
      // In-Reply-To we never saw), then the mail headers.
      const threadId = email.in_reply_to ?? email.message_id ?? null
      const referencedNo = ticketNoFromSubject(email.subject)
      const existing =
        (referencedNo ? await tem.findOne(SupportTicket, { tenantId, organizationId, ticketNo: referencedNo, deletedAt: null }) : null)
        ?? (threadId ? await tem.findOne(SupportTicket, { tenantId, organizationId, threadId, deletedAt: null }) : null)
      if (existing) {
        await tem.execute(
          `insert into orva_support_replies
             (tenant_id, organization_id, ticket_id, author, body, minutes_spent, created_at, updated_at)
           values (?::uuid, ?::uuid, ?::uuid, 'customer', ?, 0, now(), now())`,
          [tenantId, organizationId, existing.id, email.body ?? '(ไม่มีเนื้อหา)'],
        )
        // The customer has answered, so it is our move again.
        if (existing.status === 'waiting_customer') {
          existing.status = 'open'
          existing.updatedAt = new Date()
          await tem.flush()
        }
        logger.info('Appended an email reply to an existing ticket', { ticketNo: existing.ticketNo, emailId, matchedBy: referencedNo ? 'subject' : 'headers' })
        return
      }

      // Contacts and projects, both read through the decrypting finder —
      // customer_entities.display_name and email are encrypted at rest and
      // must never be compared in raw SQL.
      const entities = await findWithDecryption(
        tem, CustomerEntity, { tenantId, organizationId, deletedAt: null }, { limit: 500 }, { tenantId },
      )
      const contacts: Contact[] = entities
        .map((entity) => {
          const row = entity as { id: string; displayName?: string | null; primaryEmail?: string | null }
          return row.primaryEmail
            ? { customerEntityId: String(row.id), customerName: row.displayName ?? null, email: row.primaryEmail }
            : null
        })
        .filter((contact): contact is Contact => contact !== null)

      const match = matchCustomer(email.sender ?? '', contacts)

      const projectRows = (await tem.execute(
        `select q.id::text as quote_id, q.quote_number, q.customer_entity_id::text
         from sales_quotes q
         where q.deleted_at is null and q.tenant_id = ?::uuid and q.organization_id = ?::uuid
         order by q.created_at desc
         limit 200`,
        [tenantId, organizationId],
      )) as Array<{ quote_id: string; quote_number: string; customer_entity_id: string | null }>
      const projects: ProjectRef[] = projectRows.map((row) => ({
        quoteId: row.quote_id,
        quoteNumber: row.quote_number,
        customerEntityId: row.customer_entity_id,
      }))

      const subject = email.subject ?? '(ไม่มีหัวเรื่อง)'
      const quoteId = inferProject(`${subject}\n${email.body ?? ''}`, projects, match?.customerEntityId ?? null)

      const [seq] = (await tem.execute(
        `insert into orva_gl_sequences as s (tenant_id, organization_id, kind, next_value)
         values (?, ?, 'support_ticket', 2)
         on conflict (tenant_id, organization_id, kind)
         do update set next_value = s.next_value + 1
         returning next_value - 1 as seq`,
        [tenantId, organizationId],
      )) as Array<{ seq: string | number }>

      const now = new Date()
      const ticket = tem.create(SupportTicket, {
        tenantId, organizationId,
        ticketNo: ticketNumber(Number(seq?.seq ?? 1)),
        subject: subject.slice(0, 300),
        description: email.body ?? null,
        kind: guessKind(subject, email.body ?? ''),
        priority: 'normal',
        status: 'open',
        customerEntityId: match?.customerEntityId ?? null,
        customerName: match?.customerName ?? null,
        contactEmail: email.sender ?? null,
        quoteId,
        source: 'email',
        threadId,
        sourceEmailId: email.id,
        minutesSpent: 0,
        createdAt: now, updatedAt: now,
      })
      tem.persist(ticket)
      await tem.flush()
      logger.info('Opened a ticket from an email', {
        ticketNo: ticket.ticketNo, emailId,
        matchedBy: match?.basis ?? 'none',
        project: quoteId ? 'linked' : 'none',
      })
    })
  } catch (err) {
    // The email is already stored; failing to file it must not lose it, and
    // inbox_ops keeps its own dead-letter trail.
    logger.error('Could not turn an email into a ticket', {
      emailId,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}
