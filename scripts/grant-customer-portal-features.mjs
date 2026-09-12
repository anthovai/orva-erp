// Orva: give the customer roles the portal features this app's modules declare.
//
// A customer sees a portal page only if one of their customer roles carries
// the feature that page gates on. Those grants live in `customer_role_acls`,
// and they are written once — when `customer_accounts.seedDefaults` runs and
// merges every enabled module's `defaultCustomerRoleFeatures`. A module added
// after that never gets its grants, because nothing re-runs the merge.
//
// That is not a hypothetical. Found 2026-09-12 on the live tenant, by an
// integration spec that could not open the page it was written to test:
//
//     buyer          7 features   orva_*: none
//     portal_admin   1 feature    orva_*: none
//     viewer         4 features   orva_*: none
//
// So `orva_tasking.portal.view` was granted to nobody, and every customer met
// 403 on the work portal. It looked like one broken page rather than a
// missing grant, because the billing portal gates on the customer link alone
// and kept working — the customer could read their invoices and not their
// project. Worse, the upstream call site wraps the merge in a bare
// `try {} catch {}`, so had it ever thrown, nothing would have said so.
//
// This repairs history. It is additive and idempotent: a feature already on a
// role is left alone, and no feature is ever removed — the roles carry
// upstream's own grants too, and this script has no business editing those.
//
// Usage:
//   node scripts/grant-customer-portal-features.mjs --dry     show what is missing
//   node scripts/grant-customer-portal-features.mjs           grant it
//
// Verify afterwards with the same --dry run: a repaired tenant reports nothing
// missing. Exits non-zero when a grant it tried to write is still absent, so
// this one cannot fail quietly the way the merge it repairs can.
import 'dotenv/config'
import pg from 'pg'

/**
 * What each customer role should carry, per module.
 *
 * This mirrors the `defaultCustomerRoleFeatures` block in each module's
 * `setup.ts` — that file stays the source of truth for a NEW tenant, and this
 * list repairs the ones that already exist. They are kept in step by
 * `src/lib/__tests__/customerPortalGrantsMatchSetup.test.ts`, which fails if a
 * module declares a portal grant this script would not repair.
 */
const PORTAL_FEATURES = {
  portal_admin: ['orva_tasking.portal.view', 'orva_tasking.portal.comment'],
  buyer: ['orva_tasking.portal.view', 'orva_tasking.portal.comment'],
  viewer: ['orva_tasking.portal.view'],
}

const DRY = process.argv.includes('--dry')

const connectionString = process.env.ORVA_ADMIN_DATABASE_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const client = new pg.Client({ connectionString })
await client.connect()

let granted = 0
let stillMissing = 0

try {
  const { rows: roles } = await client.query(
    `select r.id, r.slug, r.tenant_id, a.id as acl_id, a.features_json
       from customer_roles r
       left join customer_role_acls a on a.role_id = r.id and a.tenant_id = r.tenant_id
      where r.deleted_at is null
      order by r.tenant_id, r.slug`,
  )

  if (!roles.length) {
    console.log('No customer roles found — nothing to repair.')
    process.exit(0)
  }

  for (const role of roles) {
    const wanted = PORTAL_FEATURES[role.slug]
    if (!wanted) {
      console.log(`skip  ${role.slug} — no portal features declared for this role`)
      continue
    }

    const current = Array.isArray(role.features_json) ? role.features_json : JSON.parse(role.features_json ?? '[]')
    // A wildcard already covers everything under its module.
    const covered = (feature) =>
      current.includes(feature) || current.includes(`${feature.split('.')[0]}.*`) || current.includes('*')
    const missing = wanted.filter((feature) => !covered(feature))

    if (!missing.length) {
      console.log(`ok    ${role.slug} — already carries ${wanted.length} portal feature(s)`)
      continue
    }

    if (DRY) {
      console.log(`MISS  ${role.slug} — would add ${missing.join(', ')}`)
      stillMissing += missing.length
      continue
    }

    const next = [...current, ...missing]
    if (role.acl_id) {
      await client.query(
        'update customer_role_acls set features_json = $1, updated_at = now() where id = $2',
        [JSON.stringify(next), role.acl_id],
      )
    } else {
      // A role can exist with no ACL row at all; that is still "no features".
      await client.query(
        `insert into customer_role_acls (role_id, tenant_id, features_json, created_at, updated_at)
         values ($1, $2, $3, now(), now())`,
        [role.id, role.tenant_id, JSON.stringify(next)],
      )
    }
    granted += missing.length
    console.log(`GRANT ${role.slug} — added ${missing.join(', ')}`)
  }

  if (DRY) {
    console.log(`\n${stillMissing} grant(s) missing. Re-run without --dry to write them.`)
    process.exit(0)
  }

  // Read back rather than trust the writes: this script exists because a
  // silent merge failure went unnoticed for days.
  const { rows: after } = await client.query(
    `select r.slug, a.features_json
       from customer_roles r
       left join customer_role_acls a on a.role_id = r.id and a.tenant_id = r.tenant_id
      where r.deleted_at is null`,
  )
  for (const role of after) {
    const wanted = PORTAL_FEATURES[role.slug]
    if (!wanted) continue
    const current = Array.isArray(role.features_json) ? role.features_json : JSON.parse(role.features_json ?? '[]')
    for (const feature of wanted) {
      if (!current.includes(feature)) {
        console.error(`FAIL  ${role.slug} still does not carry ${feature}`)
        stillMissing++
      }
    }
  }

  console.log(`\n${granted} grant(s) written.`)
  if (stillMissing) {
    console.error(`${stillMissing} grant(s) did not stick — the portal is still closed for those roles.`)
    process.exit(1)
  }
  console.log('Every declared portal feature is now granted.')
  console.log('Signed-in customers pick it up on their next session; RBAC caches are per-session.')
} finally {
  await client.end()
}
