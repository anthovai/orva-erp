import * as React from 'react'
import TicketsPage from '../../../components/TicketsPage'

export default function Page() {
  return (
    <React.Suspense>
      <TicketsPage />
    </React.Suspense>
  )
}
