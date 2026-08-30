export const features = [
  { id: 'orva_sso.view', title: 'View SSO connections', module: 'orva_sso' },
  {
    id: 'orva_sso.manage',
    title: 'Manage SSO connections',
    module: 'orva_sso',
    dependsOn: ['orva_sso.view'],
  },
]

export default features
