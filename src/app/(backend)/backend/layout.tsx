import { cookies, headers } from 'next/headers'
import { backendRouteMetadata } from '@/.mercato/generated/backend-route-metadata.generated'
import { findRouteManifestMatch } from '@open-mercato/shared/modules/registry'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
// Orva's own shell: a fork of the installed AppShell, whose navigation is a
// standing band of brand down the left edge rather than a paler column of the
// page — see the sidebar tokens in globals.css.
import { AppShell } from '@/components/shell/OrvaAppShell'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { profilePathPrefixes } from '@open-mercato/core/modules/auth/lib/profile-sections'
import { APP_VERSION } from '@open-mercato/shared/lib/version'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { PageInjectionBoundary } from '@open-mercato/ui/backend/injection/PageInjectionBoundary'
import { DemoFeedbackWidget } from '@/components/DemoFeedbackWidget'
import { BackendHeaderChrome } from '@/components/BackendHeaderChrome'
import { OrvaHeaderSearch } from '@/components/orva/HeaderSearch'
import { OrvaPageMetaProvider } from '@/components/orva/Page'

function collectStaticSettingsPathPrefixes(): string[] {
  const prefixes = new Set<string>()
  for (const route of backendRouteMetadata) {
    if (route.pageContext !== 'settings') continue
    const href = route.pattern ?? route.path ?? ''
    if (!href || href.includes('[')) continue
    const parts = href.split('/')
    const lastSegment = parts[parts.length - 1]
    if (parts.length > 3 && lastSegment !== 'settings') {
      prefixes.add(parts.slice(0, -1).join('/'))
    }
    prefixes.add(href)
  }
  return Array.from(prefixes)
}

export default async function BackendLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug?: string[] }>
}) {
  const auth = await getAuthFromCookies()
  const cookieStore = await cookies()
  const headerStore = await headers()

  let path = headerStore.get('x-next-url') ?? ''
  if (path.includes('?')) path = path.split('?')[0]
  let resolvedParams: { slug?: string[] } = {}
  try {
    resolvedParams = await params
  } catch {
    resolvedParams = {}
  }
  if (!path) {
    const slug = resolvedParams.slug ?? []
    path = '/backend' + (Array.isArray(slug) && slug.length > 0 ? `/${slug.join('/')}` : '')
  }

  const { translate, locale, dict } = await resolveTranslations()
  const embeddingConfigured = Boolean(
    process.env.OPENAI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.MISTRAL_API_KEY ||
    process.env.COHERE_API_KEY ||
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.OLLAMA_BASE_URL,
  )
  const missingConfigMessage = translate(
    'search.messages.missingConfig',
    'Search requires configuring an embedding provider for semantic search.',
  )

  const match = findRouteManifestMatch(backendRouteMetadata, path)
  const currentTitle = match?.route.titleKey
    ? translate(match.route.titleKey, match.route.title)
    : (match?.route.title ?? '')
  // Which department this screen belongs to, resolved here so no screen has to
  // pass it and none can forget to. Every page header reads it from context.
  // `resolvePageRouteMetadata` renames the page-meta keys on its way into the
  // manifest: pageGroupKey becomes `groupKey` and pageGroup becomes `group`.
  // Reading the page-meta spelling here silently returned undefined, so every
  // screen rendered without its department and the ones that did show it were
  // only the handful passing a kicker by hand.
  const groupKey = (match?.route as { groupKey?: string } | undefined)?.groupKey
  const groupFallback = (match?.route as { group?: string } | undefined)?.group
  const groupLabel = groupKey ? translate(groupKey, groupFallback ?? groupKey) : groupFallback

  const rawBreadcrumb = match?.route.breadcrumb
  const breadcrumb = rawBreadcrumb?.map((item) => ({
    ...item,
    label: item.labelKey ? translate(item.labelKey, item.label || item.labelKey) : item.label,
  }))

  const collapsedCookie = cookieStore.get('om_sidebar_collapsed')?.value
  const initialCollapsed = collapsedCookie === '1'
  const demoModeEnabled = parseBooleanWithDefault(process.env.DEMO_MODE, true)
  const hideBackendFooter = parseBooleanWithDefault(process.env.OM_HIDE_BACKEND_FOOTER, false)
  const deployEnv = process.env.DEPLOY_ENV
  const grantedFeatures = Array.isArray(auth?.features)
    ? auth.features.filter((feature): feature is string => typeof feature === 'string')
    : []
  const canManageUpgradeActions = authorizeFeatures(['configs.manage'], {
    grantedFeatures,
    unrestricted: auth?.isSuperAdmin === true,
  })
  const baseProductName = translate('appShell.productName', 'Orva')
  const productName = deployEnv && deployEnv !== 'local'
    ? `${baseProductName} (${deployEnv.charAt(0).toUpperCase() + deployEnv.slice(1)})`
    : baseProductName

  const injectionContext = {
    path,
    userId: auth?.sub ?? null,
    tenantId: auth?.tenantId ?? null,
    organizationId: auth?.orgId ?? null,
  }

  return (
    <I18nProvider locale={locale} dict={dict}>
      <AppShell
        productName={productName}
        email={auth?.email}
        canManageUpgradeActions={canManageUpgradeActions}
        groups={[]}
        currentTitle={currentTitle}
        breadcrumb={breadcrumb}
        sidebarCollapsedDefault={initialCollapsed}
        headerSearchSlot={(
          <OrvaHeaderSearch
            embeddingConfigured={embeddingConfigured}
            missingConfigMessage={missingConfigMessage}
          />
        )}
        rightHeaderSlot={(
          <BackendHeaderChrome
            email={auth?.email}
            userId={auth?.sub ?? null}
            tenantId={auth?.tenantId ?? null}
            organizationId={auth?.orgId ?? null}
          />
        )}
        adminNavApi="/api/auth/admin/nav"
        version={APP_VERSION}
        hideFooter={hideBackendFooter}
        settingsPathPrefixes={collectStaticSettingsPathPrefixes()}
        settingsSections={[]}
        settingsSectionTitle={translate('backend.nav.settings', 'Settings')}
        profileSections={[]}
        profileSectionTitle={translate('profile.page.title', 'Profile')}
        profilePathPrefixes={profilePathPrefixes}
      >
        <OrvaPageMetaProvider value={{ groupLabel, title: currentTitle }}>
          <PageInjectionBoundary path={path} context={injectionContext}>
            {children}
          </PageInjectionBoundary>
        </OrvaPageMetaProvider>
        {demoModeEnabled ? <DemoFeedbackWidget demoModeEnabled={demoModeEnabled} /> : null}
      </AppShell>
    </I18nProvider>
  )
}

export const dynamic = 'force-dynamic'
