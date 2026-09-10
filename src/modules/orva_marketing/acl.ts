export const features = [
  { id: 'orva_marketing.view', title: 'View marketing audience and broadcasts', module: 'orva_marketing' },
  {
    id: 'orva_marketing.manage',
    title: 'Edit marketing consent, write and send broadcasts',
    module: 'orva_marketing',
    dependsOn: ['orva_marketing.view'],
  },
]

export default features
