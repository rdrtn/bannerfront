export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined && !isForm ? { 'content-type': 'application/json' } : undefined,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // resposta que não é JSON
  }

  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/login')) onUnauthorized?.();
    throw new ApiError(res.status, json?.message ?? `Erro ${res.status}`, json?.error, json);
  }
  return json as T;
}

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : 'Algo deu errado.');
