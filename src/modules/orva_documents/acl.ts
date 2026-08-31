export const features = [
  { id: 'orva_documents.view', title: 'View and preview documents', module: 'orva_documents' },
  {
    id: 'orva_documents.manage',
    title: 'Manage document settings and templates',
    module: 'orva_documents',
    dependsOn: ['orva_documents.view'],
  },
]

export default features
