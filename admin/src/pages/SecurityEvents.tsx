import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listSecurityEvents, reviewSecurityEvent } from '../api';
import type { SecurityEvent } from '../types';

export default function SecurityEvents() {
  const queryClient = useQueryClient();
  const [severity, setSeverity] = useState('');
  const [eventType, setEventType] = useState('');
  const [page, setPage] = useState(0);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-security-events', severity, eventType, page],
    queryFn: () => listSecurityEvents({
      limit: 20,
      offset: page * 20,
      severity: severity || undefined,
      eventType: eventType || undefined,
    }),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ eventId, resolution, note }: { eventId: string; resolution: string; note?: string }) =>
      reviewSecurityEvent(eventId, resolution, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-security-events'] });
      setReviewingId(null);
      setReviewNote('');
    },
  });

  return (
    <div>
      <h2 className="text-xl font-bold mb-6">🔒 보안 이벤트</h2>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <select value={eventType} onChange={(e) => { setEventType(e.target.value); setPage(0); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none">
          <option value="">전체 유형</option>
          <option value="battle_rejected">전투 거부</option>
          <option value="invalid_upgrade">잘못된 강화</option>
          <option value="suspicious_claim">의심스러운 수집</option>
          <option value="account_suspended">계정 정지</option>
        </select>
        <select value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(0); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none">
          <option value="">전체 심각도</option>
          <option value="info">정보</option>
          <option value="warn">경고</option>
          <option value="error">오류</option>
          <option value="critical">심각</option>
        </select>
      </div>

      {isLoading ? (
        <p className="text-gray-400">로딩 중...</p>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left py-3 px-4 text-gray-500">시간</th>
                <th className="text-left py-3 px-4 text-gray-500">유형</th>
                <th className="text-left py-3 px-4 text-gray-500">심각도</th>
                <th className="text-left py-3 px-4 text-gray-500">사용자</th>
                <th className="text-left py-3 px-4 text-gray-500">소스</th>
                <th className="text-left py-3 px-4 text-gray-500">상태</th>
                <th className="text-left py-3 px-4 text-gray-500"></th>
              </tr>
            </thead>
            <tbody>
              {(data?.events ?? []).length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-gray-400">보안 이벤트가 없습니다</td></tr>
              ) : (
                data!.events.map((ev: SecurityEvent, i: number) => (
                  <tr key={ev.id} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                    <td className="py-3 px-4 text-xs text-gray-500">{new Date(ev.occurredAt).toLocaleString()}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{ev.eventType}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        ev.severity === 'critical' ? 'bg-red-100 text-red-700' :
                        ev.severity === 'error' ? 'bg-orange-100 text-orange-700' :
                        ev.severity === 'warn' ? 'bg-amber-100 text-amber-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>{ev.severity}</span>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs">{ev.userId?.slice(0, 8)}...</td>
                    <td className="py-3 px-4 text-gray-500">{ev.source}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        ev.resolution ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>{ev.resolution || '미검토'}</span>
                    </td>
                    <td className="py-3 px-4">
                      {!ev.resolution && (
                        <button
                          onClick={() => setReviewingId(reviewingId === ev.id ? null : ev.id)}
                          className="text-xs text-indigo-600 hover:text-indigo-800"
                        >
                          {reviewingId === ev.id ? '취소' : '검토'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* Review inline form */}
          {reviewingId && (
            <div className="p-4 bg-gray-50 border-t border-gray-200">
              <div className="flex gap-2">
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      reviewMutation.mutate({ eventId: reviewingId, resolution: e.target.value, note: reviewNote || undefined });
                    }
                  }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none"
                >
                  <option value="">결정 선택...</option>
                  <option value="dismissed">기각</option>
                  <option value="confirmed">확인됨</option>
                  <option value="escalated">에스컬레이션</option>
                </select>
                <input
                  type="text"
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="검토 노트 (선택)..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {data && data.total > 20 && (
        <div className="flex justify-center gap-2 mt-4">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-50">← 이전</button>
          <span className="px-3 py-1.5 text-sm text-gray-500">{page + 1} / {Math.ceil(data.total / 20)}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * 20 >= data.total} className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-50">다음 →</button>
        </div>
      )}
    </div>
  );
}
