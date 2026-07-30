import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listAuditLogs } from '../api';
import type { AuditLog } from '../types';

export default function AuditLogs() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-audit-logs', action, page],
    queryFn: () => listAuditLogs({
      limit: 50,
      offset: page * 50,
      action: action || undefined,
    }),
  });

  return (
    <div>
      <h2 className="text-xl font-bold mb-6">📋 감사 로그</h2>

      {/* Filter */}
      <div className="flex gap-3 mb-6">
        <select value={action} onChange={(e) => { setAction(e.target.value); setPage(0); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none">
          <option value="">전체 액션</option>
          <option value="user_suspended">계정 정지</option>
          <option value="user_unsuspended">정지 해제</option>
          <option value="operator_grant">재화 지급</option>
          <option value="operator_login">운영자 로그인</option>
          <option value="operator_created">운영자 생성</option>
          <option value="role_changed">역할 변경</option>
          <option value="security_event_reviewed">보안 검토</option>
          <option value="account.sanctioned">제재 생성</option>
          <option value="account.unsanctioned">제재 철회</option>
        </select>
        <span className="text-sm text-gray-500 self-center">
          {data ? `총 ${data.total}건` : ''}
        </span>
      </div>

      {isLoading ? (
        <p className="text-gray-400">로딩 중...</p>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left py-3 px-4 text-gray-500">시간</th>
                <th className="text-left py-3 px-4 text-gray-500">작업자</th>
                <th className="text-left py-3 px-4 text-gray-500">액션</th>
                <th className="text-left py-3 px-4 text-gray-500">대상 유형</th>
                <th className="text-left py-3 px-4 text-gray-500">대상 ID</th>
                <th className="text-left py-3 px-4 text-gray-500">사유</th>
                <th className="text-left py-3 px-4 text-gray-500">결과</th>
              </tr>
            </thead>
            <tbody>
              {(data?.logs ?? []).length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-gray-400">감사 로그가 없습니다</td></tr>
              ) : (
                data!.logs.map((log: AuditLog, i: number) => (
                  <tr key={log.id} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                    <td className="py-3 px-4 text-xs text-gray-500">{new Date(log.createdAt).toLocaleString()}</td>
                    <td className="py-3 px-4 font-mono text-xs">{log.operatorId?.slice(0, 8)}...</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 bg-gray-100 rounded text-xs font-medium">{log.action}</span>
                    </td>
                    <td className="py-3 px-4 text-xs text-gray-500">{log.targetType || '-'}</td>
                    <td className="py-3 px-4 font-mono text-xs">{log.targetId?.slice(0, 12)}...</td>
                    <td className="py-3 px-4 max-w-[200px] truncate text-gray-500">{log.reasonText || '-'}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        log.result === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>{log.result}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {data && data.total > 50 && (
        <div className="flex justify-center gap-2 mt-4">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-50">← 이전</button>
          <span className="px-3 py-1.5 text-sm text-gray-500">{page + 1} / {Math.ceil(data.total / 50)}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * 50 >= data.total} className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-50">다음 →</button>
        </div>
      )}
    </div>
  );
}
