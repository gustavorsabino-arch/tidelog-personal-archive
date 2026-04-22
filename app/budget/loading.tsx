import { Skeleton } from '@/components/skeleton'

export default function BudgetLoading() {
  return (
    <div className="budget-page">
      <div className="page-header budget-page-header">
        <div>
          <div className="page-title">Budget</div>
          <div className="page-sub"><Skeleton width={180} height={12} /></div>
        </div>
      </div>

      <div className="cards-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card">
            <Skeleton width={90} height={10} style={{ marginBottom: 10 }} />
            <Skeleton width={140} height={22} style={{ marginBottom: 8 }} />
            <Skeleton width={180} height={10} />
          </div>
        ))}
      </div>

      <div className="section">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th colSpan={6}><Skeleton height={12} /></th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3, 4].map((i) => (
                <tr key={i}>
                  <td style={{ padding: '6px 10px' }}><Skeleton width={160} height={12} /></td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={90} height={12} /></td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={90} height={12} /></td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={90} height={12} /></td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={80} height={12} /></td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={80} height={12} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
