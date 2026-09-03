export const features = [
  { id: 'orva_support.view', title: 'View support tickets', module: 'orva_support' },
  {
    id: 'orva_support.manage',
    title: 'Create, reply to and close support tickets',
    module: 'orva_support',
    dependsOn: ['orva_support.view'],
  },
]

export default features
