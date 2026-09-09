import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { withTenantRls } from '@/lib/rls'
import { Party, PartyRole } from './data/entities'
import { partyCreateSchema } from './data/validators'

/**
 * `mercato orva_party add-party --tenant <id> --org <id> --name "…" [--kind company|person]
 *   [--roles vendor,customer] [--tax-id 0105…] [--legal-name "…"] [--email …] [--phone …] [--notes "…"]`
 *
 * The operator-side twin of `POST /api/orva_party/parties`: the same schema,
 * the same entities, the same `withTenantRls` boundary, without a running
 * server or a browser session. It exists because the first real vendor had to
 * be created on a tenant whose only reachable surface was this terminal, and
 * because a purchasing module with no party holding the vendor role cannot be
 * used at all — the create form's picker is empty, correctly.
 *
 * `list-parties --tenant <id> --org <id> [--role vendor]` reads back what is
 * there, roles included, so the result of `add-party` can be checked without
 * opening psql.
 */
function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      index += 1
    }
  }
  return args
}

const text = (value: string | boolean | undefined): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function scopeFrom(args: Record<string, string | boolean>): { tenantId: string; organizationId: string } | null {
  const tenantId = text(args.tenant) ?? text(args.tenantId)
  const organizationId = text(args.org) ?? text(args.organizationId)
  if (!tenantId || !organizationId || !UUID.test(tenantId) || !UUID.test(organizationId)) {
    console.error('Both --tenant <uuid> and --org <uuid> are required (see `mercato auth list-orgs`).')
    return null
  }
  return { tenantId, organizationId }
}

const addParty: ModuleCli = {
  command: 'add-party',
  async run(rest) {
    const args = parseArgs(rest)
    const scope = scopeFrom(args)
    if (!scope) return

    const roles = (text(args.roles) ?? '')
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean)
    const parsed = partyCreateSchema.safeParse({
      kind: text(args.kind) ?? 'company',
      displayName: text(args.name),
      legalName: text(args['legal-name']) ?? null,
      taxId: text(args['tax-id']) ?? null,
      email: text(args.email) ?? null,
      phone: text(args.phone) ?? null,
      notes: text(args.notes) ?? null,
      roles,
    })
    if (!parsed.success) {
      console.error('Invalid party:')
      for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      console.error('Usage: mercato orva_party add-party --tenant <id> --org <id> --name "…" [--kind company|person] [--roles vendor,customer] [--tax-id …]')
      return
    }
    const input = parsed.data

    const { resolve } = await createRequestContainer()
    const em = resolve<EntityManager>('em')
    const created = await withTenantRls(em, scope.tenantId, async (tem) => {
      const now = new Date()
      const party = tem.create(Party, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        kind: input.kind,
        displayName: input.displayName,
        legalName: input.legalName ?? null,
        taxId: input.taxId ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        notes: input.notes ?? null,
        createdBy: null,
        createdAt: now,
        updatedAt: now,
      })
      tem.persist(party)
      await tem.flush()
      for (const role of Array.from(new Set(input.roles ?? []))) {
        tem.persist(
          tem.create(PartyRole, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            partyId: String(party.id),
            role,
            createdBy: null,
            createdAt: now,
            updatedAt: now,
          }),
        )
      }
      await tem.flush()
      return party
    })
    console.log(`orva_party add-party: created ${created.kind} "${created.displayName}" id=${created.id}` +
      (roles.length ? ` roles=${roles.join(',')}` : ' (no roles)'))
  },
}

const listParties: ModuleCli = {
  command: 'list-parties',
  async run(rest) {
    const args = parseArgs(rest)
    const scope = scopeFrom(args)
    if (!scope) return
    const roleFilter = text(args.role)

    const { resolve } = await createRequestContainer()
    const em = resolve<EntityManager>('em')
    const rows = await withTenantRls(em, scope.tenantId, async (tem) =>
      (await tem.execute(
        `select p.id, p.kind, p.display_name, p.tax_id,
                coalesce(string_agg(r.role, ',' order by r.role) filter (where r.deleted_at is null), '') as roles
         from orva_parties p
         left join orva_party_roles r on r.party_id = p.id
         where p.tenant_id = ?::uuid and p.organization_id = ?::uuid and p.deleted_at is null
         group by p.id, p.kind, p.display_name, p.tax_id
         order by p.display_name`,
        [scope.tenantId, scope.organizationId],
      )) as Array<{ id: string; kind: string; display_name: string; tax_id: string | null; roles: string }>,
    )
    const shown = roleFilter ? rows.filter((row) => row.roles.split(',').includes(roleFilter)) : rows
    if (shown.length === 0) {
      console.log(roleFilter ? `orva_party list-parties: no party holds the "${roleFilter}" role.` : 'orva_party list-parties: no parties.')
      return
    }
    for (const row of shown) {
      console.log(`${row.id}  ${row.kind.padEnd(7)}  ${row.display_name}${row.tax_id ? `  tax ${row.tax_id}` : ''}  [${row.roles || '—'}]`)
    }
  },
}

export const cli: ModuleCli[] = [addParty, listParties]

export default cli
