import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listOperators, createOperator, updateOperatorRole, ApiError } from '../api';
import { useAuth } from '../context/AuthContext';
import type { Operator } from '../types';

type OperatorRole = 'operator' | 'admin';

const MIN_PASSWORD_LENGTH = 8;

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 403: return `권한이 없습니다. (${err.message})`;
      case 409: return `요청이 충돌했습니다. (${err.message})`;
      case 400: return `입력값이 올바르지 않습니다. (${err.message})`;
      default: return `${err.message} (HTTP ${err.status})`;
    }
  }
  return err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
}

function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div role="alert" className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
      {errorMessage(error)}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const admin = role === 'admin' || role === 'administrator';
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${admin ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
      {role}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {status}
    </span>
  );
}

function RoleChangeForm({ operator }: { operator: Operator }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<OperatorRole>(operator.role === 'operator' ? 'admin' : 'operator');
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () => updateOperatorRole(operator.id, role, reason.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operators'] });
      setOpen(false);
      setReason('');
    },
  });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-indigo-600 hover:text-indigo-800">
        역할 변경
      </button>
    );
  }

  return (
    <div className="space-y-2 min-w-[240px]">
      <ErrorBanner error={mutation.error} />
      <div className="flex gap-2">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as OperatorRole)}
          aria-label="변경할 역할"
          className="px-2 py-1 border border-gray-300 rounded-lg text-xs outline-none"
        >
          <option value="operator">operator</option>
          <option value="admin">admin</option>
        </select>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="변경 사유 (필수)"
          className="flex-1 px-2 py-1 border border-gray-300 rounded-lg text-xs outline-none"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => mutation.mutate()}
          disabled={reason.trim().length < 1 || mutation.isPending}
          className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs transition-colors disabled:opacity-50"
        >
          {mutation.isPending ? '처리 중...' : '적용'}
        </button>
        <button
          onClick={() => { setOpen(false); mutation.reset(); }}
          className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700"
        >
          취소
        </button>
      </div>
    </div>
  );
}

function CreateOperatorForm() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<OperatorRole>('operator');

  const mutation = useMutation({
    mutationFn: () => createOperator({ email: email.trim(), nickname: nickname.trim(), password, role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operators'] });
      setEmail('');
      setNickname('');
      setPassword('');
      setRole('operator');
    },
  });

  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const valid = email.trim() !== '' && nickname.trim() !== '' && password.length >= MIN_PASSWORD_LENGTH;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid && !mutation.isPending) mutation.mutate();
  };

  return (
    <form onSubmit={submit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
      <h3 className="text-sm font-semibold mb-3">운영자 추가</h3>
      <ErrorBanner error={mutation.error} />
      {mutation.isSuccess && (
        <div role="status" className="mb-4 px-4 py-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
          운영자가 추가되었습니다.
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">이메일</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">닉네임</label>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">비밀번호 ({MIN_PASSWORD_LENGTH}자 이상)</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none"
          />
          {passwordTooShort && (
            <p className="text-xs text-red-600 mt-1">비밀번호는 {MIN_PASSWORD_LENGTH}자 이상이어야 합니다.</p>
          )}
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">역할</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as OperatorRole)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none"
          >
            <option value="operator">operator</option>
            <option value="admin">admin</option>
          </select>
        </div>
      </div>
      <button
        type="submit"
        disabled={!valid || mutation.isPending}
        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
      >
        {mutation.isPending ? '처리 중...' : '운영자 추가'}
      </button>
    </form>
  );
}

export default function Operators() {
  const { isAdmin } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ['operators'],
    queryFn: listOperators,
  });

  const operators = data?.operators ?? [];

  return (
    <div>
      <h2 className="text-xl font-bold mb-6">🛡️ 운영자 관리</h2>

      {!isAdmin && (
        <div className="mb-4 px-4 py-3 bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg text-sm">
          읽기 전용입니다. 운영자 추가 및 역할 변경은 admin 권한이 필요합니다.
        </div>
      )}

      <div className="mb-4 px-4 py-3 bg-blue-50 border border-blue-200 text-blue-800 rounded-lg text-sm">
        운영자 비밀번호 변경은 이 화면에서 지원하지 않습니다. 서버에서 <code className="font-mono">npm run db:seed-operator</code> CLI를 사용하세요.
      </div>

      {isAdmin && <CreateOperatorForm />}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <h3 className="text-sm font-semibold mb-3">운영자 목록</h3>
        <ErrorBanner error={error} />
        {isLoading ? (
          <p className="text-sm text-gray-400 py-4 text-center">불러오는 중...</p>
        ) : operators.length === 0 && !error ? (
          <p className="text-sm text-gray-400 py-4 text-center">운영자가 없습니다</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-gray-500">이메일</th>
                  <th className="text-left py-2 px-3 text-gray-500">닉네임</th>
                  <th className="text-left py-2 px-3 text-gray-500">역할</th>
                  <th className="text-left py-2 px-3 text-gray-500">상태</th>
                  <th className="text-left py-2 px-3 text-gray-500">생성일</th>
                  {isAdmin && <th className="text-left py-2 px-3 text-gray-500">역할 변경</th>}
                </tr>
              </thead>
              <tbody>
                {operators.map((op, i) => (
                  <tr key={op.id} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                    <td className="py-2 px-3">{op.email}</td>
                    <td className="py-2 px-3">{op.nickname}</td>
                    <td className="py-2 px-3"><RoleBadge role={op.role} /></td>
                    <td className="py-2 px-3"><StatusBadge status={op.status} /></td>
                    <td className="py-2 px-3 text-xs text-gray-500">{new Date(op.createdAt).toLocaleString()}</td>
                    {isAdmin && (
                      <td className="py-2 px-3"><RoleChangeForm operator={op} /></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
