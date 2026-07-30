import { useQuery } from '@tanstack/react-query';
import { listUsers, listGrants, listSecurityEvents, listAuditLogs } from '../api';

function StatCard({ title, value, subtitle, color }: {
  title: string; value: string | number; subtitle?: string; color: string;
}) {
  return (
    <div className={`p-5 rounded-xl shadow-sm border ${color}`}>
      <p className="text-sm text-gray-500 font-medium">{title}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
    </div>
  );
}

function RecentTable({ items, columns, renderRow }: {
  items: any[];
  columns: string[];
  renderRow: (item: any, i: number) => React.ReactNode;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-400 py-4 text-center">데이터가 없습니다</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            {columns.map((col) => (
              <th key={col} className="text-left py-2 px-3 text-gray-500 font-medium">{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => renderRow(item, i))}
        </tbody>
      </table>
    </div>
  );
}

export default function Dashboard() {
  const { data: userData, isLoading: loadingUsers } = useQuery({
    queryKey: ['admin-users-count'],
    queryFn: () => listUsers({ limit: 5 }),
  });

  const { data: grantData, isLoading: loadingGrants } = useQuery({
    queryKey: ['admin-grants-recent'],
    queryFn: () => listGrants({ limit: 10 }),
  });

  const { data: securityData, isLoading: loadingSecurity } = useQuery({
    queryKey: ['admin-security-recent'],
    queryFn: () => listSecurityEvents({ limit: 5, severity: 'warn' }),
  });

  const { data: auditData, isLoading: loadingAudit } = useQuery({
    queryKey: ['admin-audit-recent'],
    queryFn: () => listAuditLogs({ limit: 10 }),
  });

  return (
    <div>
      <h2 className="text-xl font-bold mb-6">📊 대시보드</h2>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="총 사용자"
          value={userData?.total ?? '...'}
          color="border-indigo-200 bg-indigo-50"
        />
        <StatCard
          title="최근 감사 로그"
          value={auditData?.logs?.length ?? '...'}
          subtitle="최근 10건"
          color="border-gray-200 bg-gray-50"
        />
        <StatCard
          title="보안 이벤트 (경고)"
          value={securityData?.events?.length ?? '...'}
          subtitle="미해결 경고"
          color="border-amber-200 bg-amber-50"
        />
        <StatCard
          title="최근 지급"
          value={grantData?.grants?.length ?? '...'}
          subtitle="최근 10건"
          color="border-green-200 bg-green-50"
        />
      </div>

      {/* Recent grants */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
        <h3 className="text-base font-semibold mb-3">💰 최근 재화 지급 내역</h3>
        {loadingGrants ? (
          <p className="text-sm text-gray-400">로딩 중...</p>
        ) : (
          <RecentTable
            items={grantData?.grants ?? []}
            columns={['시간', '대상', '유형', '수량', '사유']}
            renderRow={(g: any, i) => (
              <tr key={g.id} className={i % 2 === 0 ? 'bg-gray-50' : ''}>
                <td className="py-2 px-3 text-xs text-gray-500">{new Date(g.createdAt).toLocaleString()}</td>
                <td className="py-2 px-3">{g.targetUserId?.slice(0, 8)}...</td>
                <td className="py-2 px-3">{g.resourceCode}</td>
                <td className="py-2 px-3 font-medium">{g.amount.toLocaleString()}</td>
                <td className="py-2 px-3 text-gray-500 max-w-[200px] truncate">{g.reasonText}</td>
              </tr>
            )}
          />
        )}
      </div>

      {/* Recent audit logs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <h3 className="text-base font-semibold mb-3">📋 최근 감사 로그</h3>
        {loadingAudit ? (
          <p className="text-sm text-gray-400">로딩 중...</p>
        ) : (
          <RecentTable
            items={auditData?.logs ?? []}
            columns={['시간', '작업자', '액션', '대상', '결과']}
            renderRow={(l: any, i) => (
              <tr key={l.id} className={i % 2 === 0 ? 'bg-gray-50' : ''}>
                <td className="py-2 px-3 text-xs text-gray-500">{new Date(l.createdAt).toLocaleString()}</td>
                <td className="py-2 px-3 font-mono text-xs">{l.operatorId?.slice(0, 8)}</td>
                <td className="py-2 px-3">
                  <span className="px-2 py-0.5 bg-gray-100 rounded text-xs font-medium">{l.action}</span>
                </td>
                <td className="py-2 px-3 font-mono text-xs">{l.targetId?.slice(0, 8)}...</td>
                <td className="py-2 px-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    l.result === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {l.result}
                  </span>
                </td>
              </tr>
            )}
          />
        )}
      </div>
    </div>
  );
}
