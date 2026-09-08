import PurchaseOrderDetail from '../../../../components/PurchaseOrderDetail'

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PurchaseOrderDetail orderId={id} />
}
