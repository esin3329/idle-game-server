export function rewriteAdminApiRequest(request: Request): Request {
  const url = new URL(request.url);
  if (url.pathname === '/api/admin' || url.pathname.startsWith('/api/admin/')
    || url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
    url.pathname = url.pathname.slice('/api'.length);
    return new Request(url, request);
  }
  return request;
}
