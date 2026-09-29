export function rewriteAdminApiRequest(request: Request): Request {
  const url = new URL(request.url);
  if (url.pathname === '/api/admin' || url.pathname.startsWith('/api/admin/')
    || url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
    url.pathname = url.pathname.slice('/api'.length);
    return new Request(url, request);
  }
  return request;
}

/** Build a same-method request to the existing Node API while preserving its query and body. */
export function createApiUpstreamRequest(request: Request, apiOrigin: string): Request {
  const origin = new URL(apiOrigin);
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && isLoopback)) {
    throw new Error('API_ORIGIN must use HTTPS outside local development');
  }
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) {
    throw new Error('API_ORIGIN must contain only the server origin');
  }

  const rewritten = rewriteAdminApiRequest(request);
  const upstreamUrl = new URL(rewritten.url);
  upstreamUrl.protocol = origin.protocol;
  upstreamUrl.host = origin.host;
  return new Request(upstreamUrl, rewritten);
}
