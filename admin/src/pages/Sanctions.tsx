import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listUsers, createSanction, revokeSanction, getUserSanctions } from '../api';
import type { Sanction } from '../types';

export default function Sanctions() {
  const queryClient = useQueryClient();
  const [targetId, setTargetId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showUserSearch, setShowUserSearch] = useState(false);
  const [sanctionType, setSanctionType] = useState('suspension');
  const [reasonText, setReasonText] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const { data: userResults } = useQuery({
    queryKey: ['admin-users-search', searchTerm],
    queryFn: () => listUsers({ search: searchTerm, limit: 10 }),
    enabled: searchTerm.length >= 2,
  });

  const { data: sanctions } = useQuery({
    queryKey: ['admin-sanctions-user', targetId],
    queryFn: () => getUserSanctions(targetId),
    enabled: !!targetId,
  });

  const sanctionMutation = useMutation({
    mutationFn: () => createSanction(targetId, sanctionType, reasonText, expiresAt || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-sanctions-user', targetId] });
      setReasonText('');
      setExpiresAt('');
    },
  });

  const revokeMutation = useMutation({
    mutationFn: ({ sId, reason }: { sId: string; reason: string }) => revokeSanction(targetId, sId, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-sanctions-user', targetId] }),
  });

  const selectUser = (userId: string) => {
    setTargetId(userId);
    setShowUserSearch(false);
    setSearchTerm('');
  };

  return (
    <div>
      <h2 className="text-xl font-bold mb-6">🚫 계정 제재</h2>

      {/* Target user selection */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
        <h3 className="text-sm font-semibold mb-3">대상 사용자</h3>
        {!targetId ? (
          <div>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setShowUserSearch(true); }}
                placeholder="사용자 이메일/닉네임 검색..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none"
              />
            </div>
            {showUserSearch && searchTerm.length >= 2 && userResults && (
              <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
                {userResults.users.length === 0 ? (
                  <p className="p-3 text-sm text-gray-400">검색 결과가 없습니다</p>
                ) : (
                  userResults.users.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => selectUser(u.id)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm border-b border-gray-100 last:border-0"
                    >
                      <span className="font-medium">{u.nickname}</span>
                      <span className="text-gray-400 ml-2">{u.email}</span>
                      <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${
                        u.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>{u.status}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm">
              대상: <span className="font-mono font-medium">{targetId}</span>
            </p>
            <button onClick={() => setTargetId('')} className="text-xs text-gray-500 hover:text-gray-700">변경</button>
          </div>
        )}
      </div>

      {targetId && (
        <>
          {/* New sanction form */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
            <h3 className="text-sm font-semibold mb-3">새 제재</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">제재 유형</label>
                <select value={sanctionType} onChange={(e) => setSanctionType(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none">
                  <option value="suspension">계정 정지</option>
                  <option value="battle_restriction">전투 제한</option>
                  <option value="reward_restriction">보상 제한</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">만료일 (선택)</label>
                <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none" />
              </div>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder="제재 사유 (5자 이상)..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none"
              />
              <button
                onClick={() => sanctionMutation.mutate()}
                disabled={!reasonText || reasonText.length < 5 || sanctionMutation.isPending}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                {sanctionMutation.isPending ? '처리 중...' : '제재 추가'}
              </button>
            </div>
          </div>

          {/* Sanctions history */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <h3 className="text-sm font-semibold mb-3">제재 내역</h3>
            {(sanctions?.sanctions ?? []).length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">제재 내역이 없습니다</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-3 text-gray-500">시간</th>
                      <th className="text-left py-2 px-3 text-gray-500">유형</th>
                      <th className="text-left py-2 px-3 text-gray-500">사유</th>
                      <th className="text-left py-2 px-3 text-gray-500">상태</th>
                      <th className="text-left py-2 px-3 text-gray-500">만료</th>
                      <th className="text-left py-2 px-3 text-gray-500"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sanctions!.sanctions).map((s: Sanction, i: number) => (
                      <tr key={s.id} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                        <td className="py-2 px-3 text-xs text-gray-500">{new Date(s.createdAt).toLocaleString()}</td>
                        <td className="py-2 px-3">
                          <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{s.type}</span>
                        </td>
                        <td className="py-2 px-3 max-w-[200px] truncate">{s.reasonText}</td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            s.status === 'active' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                          }`}>{s.status}</span>
                        </td>
                        <td className="py-2 px-3 text-xs text-gray-500">
                          {s.expiresAt ? new Date(s.expiresAt).toLocaleDateString() : '-'}
                        </td>
                        <td className="py-2 px-3">
                          {s.status === 'active' && (
                            <button
                              onClick={() => revokeMutation.mutate({ sId: s.id, reason: '관리자 철회' })}
                              className="text-xs text-indigo-600 hover:text-indigo-800"
                            >
                              철회
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
