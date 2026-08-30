export const features = [
  { id: 'orva_party.parties.view', title: 'View parties', module: 'orva_party' },
  {
    id: 'orva_party.parties.manage',
    title: 'Manage parties',
    module: 'orva_party',
    dependsOn: ['orva_party.parties.view'],
  },
]

export default features
