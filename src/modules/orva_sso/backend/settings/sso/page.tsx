"use client"
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useQuery } from '@tanstack/react-query'
import { OrvaEmptyState } from '@/components/orva/NodeMark'

type ConnectionRow = {
  id: string
  name: string
  issuer_url: string
  client_id: string
  email_domains: string
  enabled: boolean
  updated_at?: string | null
}

export default function SsoConnectionsPage() {
  const t = useT()
  const router = useRouter()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['orva_sso.connections'],
    queryFn: async () => fetchCrudList<ConnectionRow>('orva_sso/connections', { page: 1, pageSize: 100 }),
  })

  const columns = React.useMemo(() => [
    { accessorKey: 'name', header: t('orva_sso.column.name', 'Name'), meta: { priority: 1 } },
    { accessorKey: 'email_domains', header: t('orva_sso.column.domains', 'Email domains'), meta: { priority: 2 } },
    { accessorKey: 'issuer_url', header: t('orva_sso.column.issuer', 'Issuer'), meta: { priority: 3, truncate: true, maxWidth: 320 } },
    {
      accessorKey: 'enabled',
      header: t('orva_sso.column.enabled', 'Enabled'),
      meta: { priority: 2 },
      cell: ({ getValue }: { getValue: () => unknown }) => (
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${getValue() ? 'bg-accent/50' : 'bg-muted text-muted-foreground'}`}>
          {getValue()
            ? t('orva_sso.enabled.yes', 'Enabled')
            : t('orva_sso.enabled.no', 'Disabled')}
        </span>
      ),
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable<ConnectionRow>
          title={t('orva_sso.page.title', 'SSO connections')}
          actions={(
            <Button asChild>
              <Link href="/backend/settings/sso/create">{t('orva_sso.actions.create', 'Add connection')}</Link>
            </Button>
          )}
          columns={columns as never}
          data={data?.items ?? []}
          isLoading={isLoading}
          error={error ? String(error) : undefined}
          emptyState={(
            <OrvaEmptyState
              title={t('orva_sso.empty.title', 'No SSO connections yet')}
              description={t('orva_sso.empty.description', 'Add a connection to let people from your identity provider sign in without a password.')}
            />
          )}
          onRowClick={(row) => { router.push(`/backend/settings/sso/${row.id}`) }}
          toolbar={<Button variant="outline" type="button" onClick={() => refetch()}>{t('orva_sso.actions.refresh', 'Refresh')}</Button>}
        />
      </PageBody>
    </Page>
  )
}
