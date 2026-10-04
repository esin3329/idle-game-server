/** Build a same-method request to the existing Node API while preserving its path, query, and body. */
export function createApiUpstreamRequest(request: Request, apiOrigin: string): Request {
  const origin = new URL(apiOrigin);
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && isLoopback)) {
    throw new Error('API_ORIGIN must use HTTPS outside local development');
  }
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) {
    throw new Error('API_ORIGIN must contain only the server origin');
  }

  const upstreamUrl = new URL(request.url);
  upstreamUrl.protocol = origin.protocol;
  upstreamUrl.host = origin.host;

  // The public server routes application traffic through /api/*; map the
  // Worker health aliases to the corresponding Node API endpoints as well.
  if (upstreamUrl.pathname === '/health' || upstreamUrl.pathname.startsWith('/health/')
    || upstreamUrl.pathname === '/ready' || upstreamUrl.pathname === '/metrics') {
    upstreamUrl.pathname = `/api${upstreamUrl.pathname}`;
  }

  return new Request(upstreamUrl, request);
}
