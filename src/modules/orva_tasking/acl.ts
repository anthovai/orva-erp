export const features = [
  { id: 'orva_tasking.view', title: 'View tasks', module: 'orva_tasking' },
  {
    id: 'orva_tasking.manage',
    title: 'Create and complete tasks',
    module: 'orva_tasking',
    dependsOn: ['orva_tasking.view'],
  },
]

export default features
