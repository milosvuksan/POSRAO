import type { MutationResult, PublicState, ResourceId } from './types';

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.code ?? 'REQUEST_FAILED', data.message ?? 'Pokušajte ponovo.');
  return data as T;
}

export const api = {
  state: () => request<PublicState>('/api/state'),
  create: (resourceId: ResourceId, body: { name: string; pin: string; durationMinutes: number }) =>
    request<MutationResult>(`/api/resources/${resourceId}/entries`, { method: 'POST', body: JSON.stringify(body) }),
  recover: (body: { name: string; pin: string }) =>
    request<MutationResult>('/api/access', { method: 'POST', body: JSON.stringify(body) }),
  extend: (entryId: string, token: string) =>
    request<MutationResult>(`/api/entries/${entryId}/extend`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }),
  finish: (entryId: string, token: string) =>
    request<MutationResult>(`/api/entries/${entryId}/finish`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }),
  cancel: (entryId: string, token: string) =>
    request<MutationResult>(`/api/entries/${entryId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }),
};
