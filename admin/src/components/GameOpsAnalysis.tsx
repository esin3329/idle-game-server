import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { analyzeGameOpsIssue, getGameOpsRun, listAiProviders, type AiProviderInfo, type GameOpsRun, type GameOpsEvidence } from '../api';

type CaseType = GameOpsRun['caseType'];
type AnalysisResult = NonNullable<GameOpsRun['result']>;

const caseOptions: Array<{ value: CaseType; label: string }> = [
  { value: 'missing_reward', label: '보상 누락' },
  { value: 'duplicate_suspected', label: '중복 지급 의심' },
  { value: 'battle_rejected', label: '전투 결과 거절' },
];

const verdictLabels: Record<AnalysisResult['verdict'], string> = {
  confirmed: '기록으로 확인됨',
  suspected: '추가 확인이 필요한 의심 사례',
  insufficient_evidence: '근거 부족',
};

const runErrorMessages: Record<string, string> = {
  AI_PROVIDER_NOT_CONFIGURED: '선택한 AI 제공자의 서버 설정을 확인해 주세요.',
  AI_PROVIDER_TIMEOUT: 'AI 제공자 응답 시간이 초과되었습니다.',
  AI_PROVIDER_UNAVAILABLE: 'AI 제공자에 연결하지 못했습니다.',
  AI_PROVIDER_RATE_LIMITED: 'AI 제공자 요청 한도에 도달했습니다.',
  AI_RUN_TIMEOUT: '분석 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.',
  AI_INVALID_RESPONSE: 'AI 응답 형식이 올바르지 않아 결과를 저장하지 않았습니다.',
  AI_TOOL_LIMIT: '분석에 필요한 조회 단계를 완료하지 못했습니다.',
  FORBIDDEN: '운영자 권한이 변경되어 분석을 중단했습니다.',
};

export default function GameOpsAnalysis({ userId }: { userId: string }) {
  const [caseType, setCaseType] = useState<CaseType>('missing_reward');
  const [providerId, setProviderId] = useState<AiProviderInfo['id']>('gemini');
  const [question, setQuestion] = useState('');
  const [copied, setCopied] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const providersQuery = useQuery({ queryKey: ['ai-providers'], queryFn: listAiProviders });
  const enabledProviders = providersQuery.data?.providers.filter((provider) => provider.enabled) ?? [];
  const selectedProvider = enabledProviders.find((provider) => provider.id === providerId) ?? enabledProviders[0];
  const runId = searchParams.get('aiRun');
  const runQuery = useQuery({
    queryKey: ['ai-run', runId, userId],
    queryFn: () => getGameOpsRun(runId!, userId),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'queued' || status === 'running' ? 1500 : false;
    },
  });
  const queueAnalysis = useMutation({
    mutationFn: analyzeGameOpsIssue,
    onSuccess: ({ id }) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set('aiRun', id);
        return next;
      });
    },
  });

  const run = runQuery.data;
  const isRunning = queueAnalysis.isPending || (Boolean(runId) && runQuery.isLoading) || run?.status === 'queued' || run?.status === 'running';
  const result = run?.status === 'succeeded' ? run.result : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProvider || question.trim().length < 5 || isRunning) return;
    setCopied(false);
    queueAnalysis.mutate({ targetUserId: userId, caseType, provider: selectedProvider.id, question: question.trim() });
  };

  const copyReply = async () => {
    const reply = result?.replyDraft;
    if (!reply) return;
    try {
      await navigator.clipboard.writeText(reply);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-base font-semibold">GameOps AI 분석</h3>
          <p className="text-sm text-gray-500 mt-1">서버 기록과 운영 문서를 읽어 분석 초안을 만듭니다. 재화나 계정은 변경하지 않습니다.</p>
        </div>
        {run && <span className="text-xs text-gray-500">{run.model} · {run.status === 'queued' ? '대기 중' : run.status === 'running' ? '분석 중' : `${((run.elapsedMs || 0) / 1000).toFixed(1)}초`}</span>}
      </div>

      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-sm text-gray-600">
          문의 유형
          <select value={caseType} onChange={(event) => setCaseType(event.target.value as CaseType)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900">
            {caseOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="text-sm text-gray-600">
          분석 모델
          <select
            value={selectedProvider?.id ?? ''}
            onChange={(event) => setProviderId(event.target.value as AiProviderInfo['id'])}
            disabled={enabledProviders.length === 0 || isRunning}
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 disabled:bg-gray-100"
          >
            {enabledProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>)}
          </select>
        </label>
        <label className="text-sm text-gray-600 md:col-span-2">
          문의 내용
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="예: 어제 전투 보상이 지급되지 않았어요."
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 resize-y"
          />
          <span className="block text-xs text-gray-400">문의 내용은 선택한 AI 제공자에게 전송됩니다. 비밀번호·인증 정보는 입력하지 마세요.</span>
          <span className="block text-right text-xs text-gray-400">{question.length}/1000</span>
        </label>
        <div className="md:col-span-2 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!selectedProvider || question.trim().length < 5 || isRunning} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm disabled:opacity-50">
            {queueAnalysis.isPending ? '작업 저장 중…' : isRunning ? '분석 대기/진행 중…' : '분석 실행'}
          </button>
          {providersQuery.isLoading && <span className="text-sm text-gray-400">모델 설정 확인 중…</span>}
          {!providersQuery.isLoading && providersQuery.data && enabledProviders.length === 0 && <span className="text-sm text-amber-700">서버에 GEMINI_API_KEY 또는 HF_TOKEN과 HF_MODEL을 설정해 주세요.</span>}
          {providersQuery.isError && <span className="text-sm text-red-600">AI 설정을 불러오지 못했습니다.</span>}
        </div>
      </form>

      {queueAnalysis.isError && <p role="alert" className="mt-4 text-sm text-red-600">{queueAnalysis.error.message}</p>}
      {runQuery.isError && <p role="alert" className="mt-4 text-sm text-red-600">{runQuery.error.message}</p>}
      {(run?.status === 'queued' || run?.status === 'running') && (
        <p role="status" className="mt-4 text-sm text-indigo-700">{run.status === 'queued' ? '분석 작업이 저장되어 순서를 기다리고 있습니다.' : '분석 중입니다. 이 화면을 새로고침해도 상태 조회가 이어집니다.'}</p>
      )}
      {(run?.status === 'failed' || run?.status === 'timed_out') && (
        <p role="alert" className="mt-4 text-sm text-red-600">{runErrorMessages[run.errorCode || ''] || '분석에 실패했습니다. 운영자 로그를 확인한 뒤 다시 시도해 주세요.'}</p>
      )}

      {result && (
        <div className="mt-6 border-t border-gray-100 pt-5 space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">판정</span>
            <span className="rounded-full bg-indigo-50 text-indigo-700 px-3 py-1 text-xs">{verdictLabels[result.verdict]}</span>
            <span className="text-xs text-gray-400">조회 도구: {run?.toolsUsed.join(', ') || '없음'}</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div>
              <h4 className="text-sm font-semibold mb-2">확인된 사실</h4>
              {result.facts.length === 0 ? <p className="text-sm text-gray-400">기록으로 확인한 사실이 없습니다.</p> : (
                <ul className="space-y-3">{result.facts.map((fact, index) => <li key={`${index}-${fact.text}`} className="text-sm text-gray-700">{fact.text}<EvidenceReferences ids={fact.evidenceIds} evidence={result.evidence} /></li>)}</ul>
              )}
              <h4 className="text-sm font-semibold mt-5 mb-2">가설</h4>
              {result.hypotheses.length === 0 ? <p className="text-sm text-gray-400">추가 가설이 없습니다.</p> : (
                <ul className="space-y-3">{result.hypotheses.map((item, index) => <li key={`${index}-${item.text}`} className="text-sm text-gray-700">{item.text}<span className="ml-2 text-xs text-gray-400">신뢰도 {item.confidence}</span><EvidenceReferences ids={item.evidenceIds} evidence={result.evidence} /></li>)}</ul>
              )}
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-2">다음 확인 항목</h4>
              {result.nextChecks.length === 0 ? <p className="text-sm text-gray-400">추가 확인 항목이 없습니다.</p> : <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700">{result.nextChecks.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>}
              <div className="flex items-center justify-between gap-3 mt-5 mb-2">
                <h4 className="text-sm font-semibold">답변 초안</h4>
                <button type="button" onClick={copyReply} className="text-xs text-indigo-600 hover:text-indigo-800">{copied ? '복사됨' : '복사'}</button>
              </div>
              <p className="whitespace-pre-wrap rounded-lg bg-gray-50 border border-gray-100 p-3 text-sm text-gray-700">{result.replyDraft}</p>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-2">조회 근거</h4>
            {result.evidence.length === 0 ? <p className="text-sm text-gray-400">분석에 사용할 기록이 없습니다.</p> : (
              <div className="space-y-2">{result.evidence.map((item) => <details key={item.id} className="rounded-lg border border-gray-200 px-3 py-2">
                <summary className="cursor-pointer text-sm text-gray-700">{item.title} <span className="ml-2 font-mono text-xs text-gray-400">{item.id}</span></summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-3 text-xs text-gray-600">{JSON.stringify(item.data, null, 2)}</pre>
              </details>)}</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function EvidenceReferences({ ids, evidence }: { ids: string[]; evidence: GameOpsEvidence[] }) {
  const titles = ids.map((id) => evidence.find((item) => item.id === id)?.title || id);
  return <span className="block mt-1 text-xs text-indigo-600">근거: {titles.join(' · ')}</span>;
}
