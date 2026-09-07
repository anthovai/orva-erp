export const features = [
  { id: 'orva_tasking.view', title: 'View tasks', module: 'orva_tasking' },
  {
    id: 'orva_tasking.manage',
    title: 'Create and complete tasks',
    module: 'orva_tasking',
    dependsOn: ['orva_tasking.view'],
  },
  {
    /**
     * Separate from `manage` on purpose: showing work to a customer is a
     * different act from editing it, and the people trusted to do the second
     * are not always the people who should decide the first.
     */
    id: 'orva_tasking.publish',
    title: 'Show a project to its customer',
    module: 'orva_tasking',
    dependsOn: ['orva_tasking.manage'],
  },
  {
    /** Held by portal customer roles, never by staff roles. */
    id: 'orva_tasking.portal.view',
    title: 'Portal: see published work',
    module: 'orva_tasking',
  },
  {
    id: 'orva_tasking.portal.comment',
    title: 'Portal: comment on published work',
    module: 'orva_tasking',
    dependsOn: ['orva_tasking.portal.view'],
  },
]

export default features
