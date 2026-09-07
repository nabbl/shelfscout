export class UpstreamAuthError extends Error {}

export class UpstreamHttpError extends Error {
  constructor(service: string, path: string, status: number) {
    const guidance = status === 401
      ? service === 'BookOrbit'
        ? 'BookOrbit authentication was rejected. Check BOOKORBIT_USERNAME and BOOKORBIT_PASSWORD, or renew BOOKORBIT_TOKEN if using manual token mode.'
        : 'Authentication is required. Set SHELFMARK_COOKIE to a valid session, or leave it blank if Shelfmark authentication is disabled.'
      : status === 403
        ? 'The configured account does not have permission to access this endpoint.'
        : status === 404
          ? `Check ${service === 'BookOrbit' ? 'BOOKORBIT_URL' : 'SHELFMARK_URL'} and the installed server version. Use the application base URL, without the API endpoint suffix.`
          : 'Check the upstream service and its reverse proxy.';
    super(`${service} HTTP ${status} at ${path.split('?')[0]}. ${guidance}`);
  }
}

/** Never forward upstream bodies, URLs, cookies or raw fetch errors to the UI. */
export function upstreamConnectionError(service: string, error: unknown) {
  if (error instanceof UpstreamHttpError || error instanceof UpstreamAuthError) return error;
  const code = error instanceof Error ? (error.cause as { code?: string } | undefined)?.code : undefined;
  const detail = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
    ? 'The configured hostname could not be resolved from ShelfScout. Check the service hostname and container network.'
    : code === 'ECONNREFUSED'
      ? 'The connection was refused. Check that the service is running and the configured port is correct.'
      : error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)
        ? 'The request timed out. Check that the service is reachable from ShelfScout.'
        : 'Check the configured URL, TLS certificate and reverse proxy. The service may be unreachable, redirecting to login or returning an invalid response.';
  return new Error(`${service} connection failed. ${detail}`);
}
