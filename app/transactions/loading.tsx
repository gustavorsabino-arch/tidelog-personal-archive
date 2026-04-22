import { Skeleton } from '@/components/skeleton'

export default function TransactionsLoading() {
  return (
    <div>
      <div className="page-header">
        <div className="page-title">Transactions</div>
        <div className="page-sub">All on-chain movements — debits and credits</div>
      </div>

      <div className="cards-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card">
            <Skeleton width={90} height={10} style={{ marginBottom: 10 }} />
            <Skeleton width={140} height={22} style={{ marginBottom: 8 }} />
            <Skeleton width={120} height={10} />
          </div>
        ))}
      </div>

      <div className="section">
        <div className="table-wrap" style={{ maxHeight: '650px', overflow: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th colSpan={8}><Skeleton height={12} /></th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3, 4].map((i) => (
                <tr key={i}>
                  <td style={{ padding: '6px 10px' }}><Skeleton width={90} height={12} /></td>
                  <td style={{ padding: '6px 10px' }}><Skeleton width={140} height={12} /></td>
                  <td style={{ padding: '6px 10px' }}><Skeleton width={30} height={12} /></td>
                  <td style={{ padding: '6px 10px' }}><Skeleton width={40} height={12} /></td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={80} height={12} /></td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={60} height={12} /></td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={80} height={12} /></td>
                  <td style={{ padding: '6px 10px' }}><Skeleton width={70} height={12} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
