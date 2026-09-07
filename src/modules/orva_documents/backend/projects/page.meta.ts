export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_documents.view'],
  pageTitle: 'Project billing',
  pageTitleKey: 'orva_documents.projects.page.title',
  /**
   * Back under โปรเจกต์และงาน, renamed so it no longer collides.
   *
   * A project here IS a quotation, so this screen answers a money question:
   * what has been quoted, what has been billed in งวด, what is still to
   * collect. Filing it under Sales was defensible but it is the screen the
   * owner opens to ask "is this project behind?", which is the same question
   * the work list answers from the other side — so the two belong together.
   * What made them confusing was the shared name, not the shared group: this
   * one is now การเรียกเก็บตามโปรเจกต์ and orva_tasking owns โปรเจกต์.
   */
  pageGroup: 'Projects',
  pageGroupKey: 'orva.nav.project',
  // 20: after orva_tasking's four Vikunja-shaped pages (1–4), before the
  // calendar and the time screens.
  pageOrder: 20,
  icon: 'briefcase',
  breadcrumb: [{ label: 'Project billing', labelKey: 'orva_documents.projects.page.title' }],
} as const
