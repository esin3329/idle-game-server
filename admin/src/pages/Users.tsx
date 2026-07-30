import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listUsers } from '../api';

export default function Users() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const limit = 20;

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-users', search, statusFilter, page],
    queryFn: () => listUsers({ limit, offset: page * limit, search: search || undefined, status: statusFilter || undefined }),
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
  };

  return (
    <div>
      <h2 className="text-xl font-bold mb-6">🔍 사용자 검색</h2>

      {/* Search + filter */}
      <form onSubmit={handleSearch} className="flex gap-3 mb-6">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="이메일 또는 닉네임 검색..."
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          className="px-3 py-2 border border-gray-300 rounded-lg outline-none"
        >
          <option value="">전체 상태</option>
          <option value="active">활성</option>
          <option value="suspended">정지</option>
          <option value="disabled">비활성</option>
        </select>
        <button
          type="submit"
          className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
        >
          검색
        </button>
      </form>

      {/* Results */}
      {isLoading && <p className="text-gray-400">로딩 중...</p>}
      {error && <p className="text-red-500">{(error as any).message}</p>}

      {data && (
        <>
          <p className="text-sm text-gray-500 mb-3">총 {data.total}명</p>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left py-3 px-4 font-medium text-gray-500">닉네임</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-500">이메일</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-500">역할</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-500">상태</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-500">가입일</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-500"></th>
                </tr>
              </thead>
              <tbody>
                {data.users.length === 0 ? (
                  <tr><td colSpan={6} className="py-8 text-center text-gray-400">검색 결과가 없습니다</td></tr>
                ) : (
                  data.users.map((user, i) => (
                    <tr key={user.id} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                      <td className="py-3 px-4 font-medium">{user.nickname}</td>
                      <td className="py-3 px-4 text-gray-600">{user.email}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          user.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                          user.role === 'operator' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          user.status === 'active' ? 'bg-green-100 text-green-700' :
                          user.status === 'suspended' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {user.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-500 text-xs">{new Date(user.createdAt).toLocaleDateString()}</td>
                      <td className="py-3 px-4">
                        <Link
                          to={`/users/${user.id}`}
                          className="text-indigo-600 hover:text-indigo-800 text-xs font-medium"
                        >
                          상세 →
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data.total > limit && (
            <div className="flex justify-center gap-2 mt-4">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-50"
              >
                ← 이전
              </button>
              <span className="px-3 py-1.5 text-sm text-gray-500">
                {page + 1} / {Math.ceil(data.total / limit)}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * limit >= data.total}
                className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-50"
              >
                다음 →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
