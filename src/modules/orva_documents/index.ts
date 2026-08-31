import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'orva_documents',
  title: 'Orva Documents',
  version: '0.1.0',
  description:
    'Printable Thai business documents over the installed sales records: quotation, invoice, tax invoice and receipt, with selectable templates and an A4 preview.',
  author: 'Anthovai',
  license: 'MIT',
}

export { features } from './acl'
