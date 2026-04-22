import { Skeleton } from '@/components/skeleton'

export default function GainLossLoading() {
  return (
    <div>
      <div className="page-header">
        <div className="page-title">Gain / Loss</div>
        <div className="page-sub">Realized gains and losses — FIFO cost basis</div>
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
        <div className="table-wrap" style={{ maxHeight: '600px', overflow: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th colSpan={9}><Skeleton height={12} /></th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3, 4].map((i) => (
                <tr key={i}>
                  <td style={{ padding: '6px 10px' }}><Skeleton width={80} height={12} /></td>
                  <td style={{ padding: '6px 10px' }}><Skeleton width={140} height={12} /></td>
                  <td style={{ padding: '6px 10px' }}><Skeleton width={40} height={12} /></td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={70} height={12} /></td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={70} height={12} /></td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={70} height={12} /></td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={90} height={12} /></td>
                  <td style={{ padding: '6px 10px' }}><Skeleton width={30} height={12} /></td>
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
