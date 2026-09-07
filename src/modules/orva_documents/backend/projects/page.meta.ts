export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_documents.view'],
  pageTitle: 'Projects',
  pageTitleKey: 'orva_documents.projects.page.title',
  /**
   * Sales, not Projects.
   *
   * This screen answers a money question — what has been quoted, what has been
   * billed in งวด, what is still to collect — and it happened to be called
   * "โปรเจกต์" because a project here IS a quotation. Sitting beside the work
   * list under the same group made two unrelated screens look like two halves
   * of one thing. The work percentage it now shows is a reference to the work,
   * not a reason to file it as work.
   */
  pageGroup: 'Sales',
  pageGroupKey: 'orva.nav.sales',
  // 65, not 60: invoices already hold 60 in src/modules.ts, and two pages on
  // the same order leave their relative position to chance.
  pageOrder: 65,
  icon: 'briefcase',
  breadcrumb: [{ label: 'Projects', labelKey: 'orva_documents.projects.page.title' }],
} as const
