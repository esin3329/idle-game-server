import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getUserDetail, getUserWalletLedger, getUserItemLedger, getUserBattles,
  getUserSanctions, suspendUser, unsuspendUser, createSanction, revokeSanction,
  createGrant,
} from '../api';
import type { Sanction, WalletLedgerEntry } from '../types';

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
        active ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  );
}

export default function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'wallet' | 'sanctions' | 'items' | 'battles'>('wallet');

  // Action forms
  const [suspendReason, setSuspendReason] = useState('');
  const [sanctionType, setSanctionType] = useState('suspension');
  const [sanctionReason, setSanctionReason] = useState('');
  const [sanctionExpiry, setSanctionExpiry] = useState('');
  const [grantType, setGrantType] = useState('currency');
  const [grantCode, setGrantCode] = useState('electricity');
  const [grantAmount, setGrantAmount] = useState(0);
  const [grantReason, setGrantReason] = useState('');

  const { data: user, isLoading } = useQuery({
    queryKey: ['admin-user', id],
    queryFn: () => getUserDetail(id!),
    enabled: !!id,
  });

  const { data: walletLedger } = useQuery({
    queryKey: ['admin-user-wallet', id],
    queryFn: () => getUserWalletLedger(id!),
    enabled: !!id && tab === 'wallet',
  });

  const { data: sanctions } = useQuery({
    queryKey: ['admin-user-sanctions', id],
    queryFn: () => getUserSanctions(id!),
    enabled: !!id && tab === 'sanctions',
  });

  const { data: items } = useQuery({
    queryKey: ['admin-user-items', id],
    queryFn: () => getUserItemLedger(id!),
    enabled: !!id && tab === 'items',
  });

  const { data: battles } = useQuery({
    queryKey: ['admin-user-battles', id],
    queryFn: () => getUserBattles(id!),
    enabled: !!id && tab === 'battles',
  });

  const suspendMutation = useMutation({
    mutationFn: () => suspendUser(id!, suspendReason),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-user', id] }); setSuspendReason(''); },
  });

  const unsuspendMutation = useMutation({
    mutationFn: () => unsuspendUser(id!, '관리자 해제'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-user', id] }),
  });

  const sanctionMutation = useMutation({
    mutationFn: () => createSanction(id!, sanctionType, sanctionReason, sanctionExpiry || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-user-sanctions', id] });
      setSanctionReason('');
      setSanctionExpiry('');
    },
  });

  const revokeMutation = useMutation({
    mutationFn: ({ sId, reason }: { sId: string; reason: string }) => revokeSanction(id!, sId, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-user-sanctions', id] }),
  });

  const grantMutation = useMutation({
    mutationFn: () => createGrant(id!, grantType, grantCode, grantAmount, grantReason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-user-wallet', id] });
      setGrantAmount(0);
      setGrantReason('');
    },
  });

  if (isLoading) return <p className="text-gray-400">로딩 중...</p>;
  if (!user) return <p className="text-red-500">사용자를 찾을 수 없습니다.</p>;

  return (
    <div>
      <Link to="/users" className="text-sm text-indigo-600 hover:text-indigo-800 mb-4 inline-block">← 사용자 목록</Link>

      {/* User info header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold">{user.nickname}</h2>
            <p className="text-sm text-gray-500 mt-1">{user.email}</p>
            <div className="flex gap-2 mt-2">
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                user.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                user.role === 'operator' ? 'bg-blue-100 text-blue-700' :
                'bg-gray-100 text-gray-600'
              }`}>{user.role}</span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                user.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}>{user.status}</span>
            </div>
          </div>
          <div className="text-right text-sm text-gray-500">
            <p>ID: <span className="font-mono">{user.id}</span></p>
            {user.playerId && <p>Player: <span className="font-mono">{user.playerId}</span></p>}
          </div>
        </div>

        {/* Wallet summary */}
        {user.wallet && (
          <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-100">
            <div className="text-center">
              <p className="text-xs text-gray-500">⚡ 전기</p>
              <p className="text-lg font-bold">{user.wallet.electricity?.toLocaleString()}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">🔩 스크랩</p>
              <p className="text-lg font-bold">{user.wallet.scrap?.toLocaleString()}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">💰 잔액</p>
              <p className="text-lg font-bold">{user.wallet.balance?.toLocaleString()}</p>
            </div>
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Suspend / Unsuspend */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <h3 className="text-sm font-semibold mb-3">🚫 계정 제재</h3>
          {user.status === 'suspended' ? (
            <button
              onClick={() => unsuspendMutation.mutate()}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm transition-colors"
            >
              정지 해제
            </button>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                placeholder="정지 사유..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none"
              />
              <button
                onClick={() => suspendMutation.mutate()}
                disabled={!suspendReason || suspendMutation.isPending}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                정지
              </button>
            </div>
          )}
        </div>

        {/* Grant */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <h3 className="text-sm font-semibold mb-3">💰 재화 지급</h3>
          <div className="flex gap-2 mb-2">
            <select value={grantCode} onChange={(e) => setGrantCode(e.target.value)} className="px-2 py-2 border border-gray-300 rounded-lg text-sm outline-none">
              <option value="electricity">⚡ 전기</option>
              <option value="scrap">🔩 스크랩</option>
            </select>
            <input
              type="number"
              value={grantAmount}
              onChange={(e) => setGrantAmount(Number(e.target.value))}
              placeholder="수량"
              className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none"
            />
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={grantReason}
              onChange={(e) => setGrantReason(e.target.value)}
              placeholder="지급 사유 (5자 이상)..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none"
            />
            <button
              onClick={() => grantMutation.mutate()}
              disabled={!grantReason || grantReason.length < 5 || grantAmount <= 0 || grantMutation.isPending}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              지급
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <TabButton active={tab === 'wallet'} onClick={() => setTab('wallet')}>💰 재화 원장</TabButton>
        <TabButton active={tab === 'sanctions'} onClick={() => setTab('sanctions')}>🚫 제재 내역</TabButton>
        <TabButton active={tab === 'items'} onClick={() => setTab('items')}>📦 아이템 원장</TabButton>
        <TabButton active={tab === 'battles'} onClick={() => setTab('battles')}>⚔️ 전투 기록</TabButton>
      </div>

      {/* Tab content */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        {tab === 'wallet' && (
          <div>
            <h3 className="text-sm font-semibold mb-3">재화 변동 기록</h3>
            {(walletLedger?.ledger ?? []).length === 0 ? (
              <p className="text-sm text-gray-400">기록이 없습니다</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-3 text-gray-500">시간</th>
                      <th className="text-left py-2 px-3 text-gray-500">재화</th>
                      <th className="text-right py-2 px-3 text-gray-500">변동</th>
                      <th className="text-right py-2 px-3 text-gray-500">잔액</th>
                      <th className="text-left py-2 px-3 text-gray-500">출처</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(walletLedger!.ledger).map((entry: WalletLedgerEntry, i: number) => (
                      <tr key={entry.id} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                        <td className="py-2 px-3 text-xs text-gray-500">{new Date(entry.createdAt).toLocaleString()}</td>
                        <td className="py-2 px-3">{entry.currency}</td>
                        <td className={`py-2 px-3 text-right font-medium ${entry.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {entry.amount >= 0 ? '+' : ''}{entry.amount.toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-right">{entry.balanceAfter.toLocaleString()}</td>
                        <td className="py-2 px-3 text-gray-500">{entry.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'sanctions' && (
          <div>
            <h3 className="text-sm font-semibold mb-3">제재 내역</h3>
            {/* New sanction form */}
            <div className="flex gap-2 mb-4 p-3 bg-gray-50 rounded-lg">
              <select value={sanctionType} onChange={(e) => setSanctionType(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded text-sm">
                <option value="suspension">계정 정지</option>
                <option value="battle_restriction">전투 제한</option>
                <option value="reward_restriction">보상 제한</option>
              </select>
              <input type="text" value={sanctionReason} onChange={(e) => setSanctionReason(e.target.value)} placeholder="제재 사유 (5자 이상)..." className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm outline-none" />
              <input type="date" value={sanctionExpiry} onChange={(e) => setSanctionExpiry(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded text-sm" />
              <button onClick={() => sanctionMutation.mutate()} disabled={!sanctionReason || sanctionReason.length < 5 || sanctionMutation.isPending} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm disabled:opacity-50">
                제재 추가
              </button>
            </div>

            {(sanctions?.sanctions ?? []).length === 0 ? (
              <p className="text-sm text-gray-400">제재 내역이 없습니다</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-3 text-gray-500">시간</th>
                      <th className="text-left py-2 px-3 text-gray-500">유형</th>
                      <th className="text-left py-2 px-3 text-gray-500">사유</th>
                      <th className="text-left py-2 px-3 text-gray-500">상태</th>
                      <th className="text-left py-2 px-3 text-gray-500"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sanctions!.sanctions).map((s: Sanction, i: number) => (
                      <tr key={s.id} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                        <td className="py-2 px-3 text-xs text-gray-500">{new Date(s.createdAt).toLocaleString()}</td>
                        <td className="py-2 px-3">{s.type}</td>
                        <td className="py-2 px-3 max-w-[200px] truncate">{s.reasonText}</td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            s.status === 'active' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                          }`}>{s.status}</span>
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
        )}

        {tab === 'items' && (
          <div>
            <h3 className="text-sm font-semibold mb-3">아이템 획득 기록</h3>
            {(items?.items ?? []).length === 0 ? (
              <p className="text-sm text-gray-400">기록이 없습니다</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-3 text-gray-500">시간</th>
                      <th className="text-left py-2 px-3 text-gray-500">유형</th>
                      <th className="text-left py-2 px-3 text-gray-500">아이템</th>
                      <th className="text-right py-2 px-3 text-gray-500">수량</th>
                      <th className="text-left py-2 px-3 text-gray-500">출처</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(items!.items).map((item: any, i: number) => (
                      <tr key={item.id} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                        <td className="py-2 px-3 text-xs text-gray-500">{new Date(item.createdAt).toLocaleString()}</td>
                        <td className="py-2 px-3">{item.itemType}</td>
                        <td className="py-2 px-3 font-mono text-xs">{item.itemId}</td>
                        <td className="py-2 px-3 text-right">{item.quantity}</td>
                        <td className="py-2 px-3 text-gray-500">{item.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'battles' && (
          <div>
            <h3 className="text-sm font-semibold mb-3">전투 기록</h3>
            {(battles?.battles ?? []).length === 0 ? (
              <p className="text-sm text-gray-400">전투 기록이 없습니다</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-3 text-gray-500">시작</th>
                      <th className="text-left py-2 px-3 text-gray-500">스테이지</th>
                      <th className="text-left py-2 px-3 text-gray-500">상태</th>
                      <th className="text-right py-2 px-3 text-gray-500">처치</th>
                      <th className="text-right py-2 px-3 text-gray-500">보상</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(battles!.battles).map((b: any, i: number) => (
                      <tr key={b.id} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                        <td className="py-2 px-3 text-xs text-gray-500">{new Date(b.startTime).toLocaleString()}</td>
                        <td className="py-2 px-3 font-mono text-xs">{b.stageId?.slice(0, 12)}</td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            b.status === 'completed' ? 'bg-green-100 text-green-700' :
                            b.status === 'active' ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>{b.status}</span>
                        </td>
                        <td className="py-2 px-3 text-right">{b.totalKills}</td>
                        <td className="py-2 px-3 text-right">{b.rewardScrap?.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
