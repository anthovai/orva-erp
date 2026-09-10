import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { CONSENT_AT_KEY, CONSENT_KEY, CONSENT_SOURCE_KEY, CUSTOMER_ENTITY_ID, type Scope } from './audience'

/**
 * Writes the three consent fields on the shared customer record through the
 * data engine — the same path the CRM form takes — so the value the owner
 * sees on the person or company page and the value the audience reads are
 * one and the same, and the query index is told.
 */
export async function setConsent(
  dataEngine: DataEngine,
  scope: Scope,
  customerEntityId: string,
  consent: boolean,
  source: string,
  today = new Date().toISOString().slice(0, 10),
): Promise<void> {
  await setCustomFieldsIfAny({
    dataEngine,
    entityId: CUSTOMER_ENTITY_ID,
    recordId: customerEntityId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    values: { [CONSENT_KEY]: consent, [CONSENT_AT_KEY]: today, [CONSENT_SOURCE_KEY]: source.slice(0, 120) },
    notify: true,
  })
}
