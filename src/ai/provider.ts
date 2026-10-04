import { AppError } from '../shared/errors.js';

export type ProviderId = 'gemini' | 'huggingface';

export type ToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content?: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type AssistantMessage = { content?: string | null; tool_calls?: ToolCall[] };

type ChatCompletion = {
  choices?: Array<{ message?: AssistantMessage }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  enabled: boolean;
  model: string;
}

export function listProviders(): ProviderInfo[] {
  return [
    {
      id: 'gemini',
      name: 'Gemini API',
      enabled: Boolean(process.env.GEMINI_API_KEY),
      model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    },
    {
      id: 'huggingface',
      name: 'Open-weight · Hugging Face',
      enabled: Boolean(process.env.HF_TOKEN && process.env.HF_MODEL),
      model: process.env.HF_MODEL || '',
    },
  ];
}

function resolveProvider(id: ProviderId) {
  if (id === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new AppError('GEMINI_API_KEY가 설정되지 않았습니다.', 503, 'AI_PROVIDER_NOT_CONFIGURED');
    return {
      apiKey,
      model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    };
  }

  const apiKey = process.env.HF_TOKEN;
  const model = process.env.HF_MODEL;
  if (!apiKey || !model) {
    throw new AppError('HF_TOKEN과 HF_MODEL을 설정해야 합니다.', 503, 'AI_PROVIDER_NOT_CONFIGURED');
  }
  return { apiKey, model, endpoint: 'https://router.huggingface.co/v1/chat/completions' };
}

export async function createCompletion(
  id: ProviderId,
  messages: ChatMessage[],
  tools: ToolDefinition[],
): Promise<{ message: AssistantMessage; usage?: ChatCompletion['usage'] }> {
  const config = resolveProvider(id);
  let response: Response;
  try {
    response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
        temperature: 0.1,
        max_tokens: 1500,
      }),
      signal: AbortSignal.timeout(18_000),
    });
  } catch (error) {
    const code = error instanceof DOMException && error.name === 'TimeoutError' ? 'AI_PROVIDER_TIMEOUT' : 'AI_PROVIDER_UNAVAILABLE';
    throw new AppError('AI 제공자에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', 502, code);
  }

  if (!response.ok) {
    const status = response.status === 429 ? 429 : 502;
    const code = response.status === 429 ? 'AI_PROVIDER_RATE_LIMITED' : 'AI_PROVIDER_ERROR';
    throw new AppError('AI 제공자 요청이 실패했습니다. 제공자와 모델 설정을 확인해 주세요.', status, code);
  }

  let completion: ChatCompletion;
  try {
    completion = await response.json() as ChatCompletion;
  } catch {
    throw new AppError('AI 제공자의 응답을 읽지 못했습니다.', 502, 'AI_INVALID_RESPONSE');
  }
  const message = completion.choices?.[0]?.message;
  if (!message) throw new AppError('AI 제공자가 빈 응답을 반환했습니다.', 502, 'AI_INVALID_RESPONSE');
  return { message, usage: completion.usage };
}
