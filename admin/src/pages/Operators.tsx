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

function RoleChangeForm({
  operator,
  activeAdminCount,
  isSelf,
}: {
  operator: Operator;
  activeAdminCount: number;
  isSelf: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // 현재 역할이 operator/admin이면 그대로 선택해 두고, 그 외 특수 역할은 명시적으로 고르게 한다.
  const currentRole: OperatorRole | '' = operator.role === 'operator' || operator.role === 'admin' ? operator.role : '';
  const [role, setRole] = useState<OperatorRole | ''>(currentRole);
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: (newRole: OperatorRole) => updateOperatorRole(operator.id, newRole, reason.trim()),
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

  const targetIsActiveAdmin = operator.status === 'active' && (operator.role === 'admin' || operator.role === 'administrator');
  const lastAdminDemotion = targetIsActiveAdmin && role === 'operator' && activeAdminCount <= 1;
  const changed = role !== '' && role !== operator.role;
  const canSubmit = changed && reason.trim().length >= 1 && !lastAdminDemotion && !mutation.isPending;

  return (
    <div className="space-y-2 min-w-[240px]">
      <ErrorBanner error={mutation.error} />
      {lastAdminDemotion && (
        <p role="alert" className="text-xs text-red-600">마지막 활성 관리자는 강등할 수 없습니다.</p>
      )}
      {isSelf && (
        <p role="alert" className="text-xs text-yellow-700">
          본인 계정입니다. 역할을 변경하면 본인 권한이 즉시 달라질 수 있습니다.
        </p>
      )}
      <div className="flex gap-2">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as OperatorRole | '')}
          aria-label="변경할 역할"
          className="px-2 py-1 border border-gray-300 rounded-lg text-xs outline-none"
        >
          {currentRole === '' && <option value="">선택</option>}
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
          onClick={() => { if (role !== '') mutation.mutate(role); }}
          disabled={!canSubmit}
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

function CreateOperatorForm({ disabled }: { disabled: boolean }) {
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
    if (!disabled && valid && !mutation.isPending) mutation.mutate();
  };

  return (
    <form onSubmit={submit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
      <h3 className="text-sm font-semibold mb-3">운영자 추가</h3>
      <ErrorBanner error={mutation.error} />
      {disabled && (
        <div role="alert" className="mb-4 px-4 py-3 bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg text-sm">
          AUTH_PROVIDER=supabase 모드에서는 관리자 UI의 새 운영자 계정 생성이 지원되지 않습니다.
        </div>
      )}
      {mutation.isSuccess && (
        <div role="status" className="mb-4 px-4 py-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
          운영자가 추가되었습니다.
        </div>
      )}
      <fieldset disabled={disabled} className="contents">
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
      </fieldset>
    </form>
  );
}

export default function Operators() {
  const { isAuthenticated, isAdmin, userId, authProvider, sessionKey } = useAuth();
  // 세션/계정 전환 시 이전 계정의 캐시가 보이지 않도록 키를 격리한다.
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['operators', sessionKey, userId],
    queryFn: listOperators,
    enabled: isAuthenticated && isAdmin,
  });

  if (!isAdmin) {
    return (
      <div>
        <h2 className="text-xl font-bold mb-6">🛡️ 운영자 관리</h2>
        <div role="alert" className="px-4 py-3 bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg text-sm">
          접근 권한 없음: 운영자 목록 조회 및 관리는 admin/administrator 권한 전용입니다.
        </div>
      </div>
    );
  }

  // 오류 시 이전 데이터를 렌더링하지 않는다.
  const operators = isError ? [] : (data?.operators ?? []);
  const activeAdminCount = operators.filter(
    (op) => op.status === 'active' && (op.role === 'admin' || op.role === 'administrator'),
  ).length;

  return (
    <div>
      <h2 className="text-xl font-bold mb-6">🛡️ 운영자 관리</h2>

      <div className="mb-4 px-4 py-3 bg-blue-50 border border-blue-200 text-blue-800 rounded-lg text-sm">
        비밀번호 변경은 관리자 웹 UI에서 지원하지 않습니다. 서버 운영 담당자가 계정 역할·상태를 유지하는 전용 비밀번호 재설정 절차(npm run db:reset-operator-password)로 처리해야 합니다.
      </div>

      <CreateOperatorForm disabled={authProvider === 'supabase'} />

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <h3 className="text-sm font-semibold mb-3">운영자 목록</h3>
        <ErrorBanner error={isError ? error : null} />
        {isLoading ? (
          <p className="text-sm text-gray-400 py-4 text-center">불러오는 중...</p>
        ) : operators.length === 0 && !isError ? (
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
                  <th className="text-left py-2 px-3 text-gray-500">역할 변경</th>
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
                    <td className="py-2 px-3">
                      <RoleChangeForm
                        key={`${op.id}:${op.role}`}
                        operator={op}
                        activeAdminCount={activeAdminCount}
                        isSelf={userId !== null && op.id === userId}
                      />
                    </td>
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
