import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listUsers, createGrant, listGrants } from '../api';
import type { Grant } from '../types';

export default function Grants() {
  const queryClient = useQueryClient();
  const [targetId, setTargetId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showUserSearch, setShowUserSearch] = useState(true);
  const [resourceCode, setResourceCode] = useState('electricity');
  const [amount, setAmount] = useState(0);
  const [reasonText, setReasonText] = useState('');
  const [page, setPage] = useState(0);

  const { data: userResults } = useQuery({
    queryKey: ['admin-users-search', searchTerm],
    queryFn: () => listUsers({ search: searchTerm, limit: 10 }),
    enabled: searchTerm.length >= 2,
  });

  const { data: grantsData, isLoading } = useQuery({
    queryKey: ['admin-grants', page],
    queryFn: () => listGrants({ limit: 20, offset: page * 20 }),
  });

  const grantMutation = useMutation({
    mutationFn: () => createGrant(targetId, 'currency', resourceCode, amount, reasonText),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-grants'] });
      setAmount(0);
      setReasonText('');
    },
  });

  const selectUser = (userId: string) => {
    setTargetId(userId);
    setShowUserSearch(false);
    setSearchTerm('');
  };

  return (
    <div>
      <h2 className="text-xl font-bold mb-6">💰 재화 지급</h2>

      {/* New grant */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
        <h3 className="text-sm font-semibold mb-3">새 지급</h3>

        {/* Target user */}
        <div className="mb-3">
          <label className="block text-xs text-gray-500 mb-1">대상 사용자</label>
          {!targetId ? (
            <div>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setShowUserSearch(true); }}
                placeholder="사용자 검색..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none"
              />
              {showUserSearch && searchTerm.length >= 2 && userResults && (
                <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto mt-1">
                  {userResults.users.length === 0 ? (
                    <p className="p-2 text-sm text-gray-400">검색 결과 없음</p>
                  ) : (
                    userResults.users.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => selectUser(u.id)}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm border-b border-gray-100 last:border-0"
                      >
                        {u.nickname} <span className="text-gray-400">{u.email}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
              <p className="text-sm font-mono">{targetId}</p>
              <button onClick={() => { setTargetId(''); setShowUserSearch(true); }} className="text-xs text-gray-500">변경</button>
            </div>
          )}
        </div>

        {targetId && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">재화 유형</label>
                <select value={resourceCode} onChange={(e) => setResourceCode(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none">
                  <option value="electricity">⚡ 전기</option>
                  <option value="scrap">🔩 스크랩</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">수량</label>
                <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} placeholder="0" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">사유 (5자 이상)</label>
                <input type="text" value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder="지급 사유..." className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none" />
              </div>
            </div>
            <button
              onClick={() => grantMutation.mutate()}
              disabled={!reasonText || reasonText.length < 5 || amount <= 0 || grantMutation.isPending}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {grantMutation.isPending ? '처리 중...' : `${resourceCode === 'electricity' ? '⚡' : '🔩'} ${amount.toLocaleString()} 지급`}
            </button>
          </>
        )}
      </div>

      {/* Grant history */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <h3 className="text-sm font-semibold mb-3">지급 내역</h3>
        {isLoading ? (
          <p className="text-sm text-gray-400">로딩 중...</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 text-gray-500">시간</th>
                    <th className="text-left py-2 px-3 text-gray-500">대상</th>
                    <th className="text-left py-2 px-3 text-gray-500">작업자</th>
                    <th className="text-left py-2 px-3 text-gray-500">재화</th>
                    <th className="text-right py-2 px-3 text-gray-500">수량</th>
                    <th className="text-left py-2 px-3 text-gray-500">사유</th>
                  </tr>
                </thead>
                <tbody>
                  {(grantsData?.grants ?? []).length === 0 ? (
                    <tr><td colSpan={6} className="py-8 text-center text-gray-400">지급 내역이 없습니다</td></tr>
                  ) : (
                    grantsData!.grants.map((g: Grant, i: number) => (
                      <tr key={g.id} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                        <td className="py-2 px-3 text-xs text-gray-500">{new Date(g.createdAt).toLocaleString()}</td>
                        <td className="py-2 px-3 font-mono text-xs">{g.targetUserId?.slice(0, 8)}...</td>
                        <td className="py-2 px-3 font-mono text-xs">{g.operatorId?.slice(0, 8)}...</td>
                        <td className="py-2 px-3">{g.resourceCode}</td>
                        <td className="py-2 px-3 text-right font-medium">{g.amount.toLocaleString()}</td>
                        <td className="py-2 px-3 text-gray-500 max-w-[200px] truncate">{g.reasonText}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {grantsData && grantsData.total > 20 && (
              <div className="flex justify-center gap-2 mt-4">
                <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-50">← 이전</button>
                <span className="px-3 py-1.5 text-sm text-gray-500">{page + 1} / {Math.ceil(grantsData.total / 20)}</span>
                <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * 20 >= grantsData.total} className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-50">다음 →</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
