import PayrollRunDetail from '../../../../components/PayrollRunDetail'

export default async function PayrollRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PayrollRunDetail id={id} />
}
