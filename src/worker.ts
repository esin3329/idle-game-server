import { createApiUpstreamRequest } from './cloudflare-routing.js';

function isBackendRequest(pathname: string): boolean {
  return pathname === '/api'
    || pathname.startsWith('/api/')
    || pathname === '/health'
    || pathname.startsWith('/health/')
    || pathname === '/ready'
    || pathname === '/metrics';
}

function unavailable(message: string, status: 502 | 503): Response {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!isBackendRequest(url.pathname)) return env.ASSETS.fetch(request);

    const apiOrigin = env.API_ORIGIN?.trim();
    if (!apiOrigin || apiOrigin.includes('replace-with-node-api')) {
      return unavailable('관리자 API 서버 주소가 설정되지 않았습니다.', 503);
    }

    try {
      const upstreamRequest = createApiUpstreamRequest(request, apiOrigin);
      const upstreamResponse = await fetch(upstreamRequest);
      const headers = new Headers(upstreamResponse.headers);
      headers.set('Cache-Control', 'no-store');
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers,
      });
    } catch {
      return unavailable('관리자 API 서버에 연결할 수 없습니다.', 502);
    }
  },
};

export default worker;
