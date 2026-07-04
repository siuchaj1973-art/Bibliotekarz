import type {
  Item, Collection, Facet, Stats, ScanState, ListResult, Progress, EpubManifest,
} from './types';

const TOKEN_KEY = 'bibliotekarz.token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}
export function setToken(t: string): void {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** Append token to media URLs (img/audio elements can't send headers). */
export function withToken(url: string): string {
  const t = getToken();
  if (!t) return url;
  return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(t);
}

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(options.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export interface ItemQuery {
  kind?: string;
  search?: string;
  author?: string;
  series?: string;
  tag?: string;
  collection?: number;
  status?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const api = {
  stats: () => req<Stats>('/api/stats'),
  listItems: (q: ItemQuery) => req<ListResult>(`/api/items${qs(q as Record<string, unknown>)}`),
  getItem: (id: number) => req<Item>(`/api/items/${id}`),
  updateItem: (id: number, patch: Partial<Item>) =>
    req<Item>(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteItem: (id: number) => req<{ ok: true }>(`/api/items/${id}`, { method: 'DELETE' }),

  getProgress: (id: number) => req<Progress | null>(`/api/items/${id}/progress`),
  setProgress: (id: number, patch: Partial<Progress>) =>
    req<Progress>(`/api/items/${id}/progress`, { method: 'PUT', body: JSON.stringify(patch) }),

  authors: () => req<Facet[]>('/api/authors'),
  series: () => req<Facet[]>('/api/series'),
  tags: () => req<Facet[]>('/api/tags'),

  collections: () => req<Collection[]>('/api/collections'),
  createCollection: (name: string, description?: string) =>
    req<Collection>('/api/collections', { method: 'POST', body: JSON.stringify({ name, description }) }),
  deleteCollection: (id: number) => req<{ ok: true }>(`/api/collections/${id}`, { method: 'DELETE' }),
  setMembership: (collectionId: number, itemId: number, member: boolean) =>
    req<{ ok: true }>(`/api/collections/${collectionId}/items`, {
      method: 'POST', body: JSON.stringify({ itemId, member }),
    }),

  scan: () => req<{ started: boolean }>('/api/scan', { method: 'POST' }),
  scanStatus: () => req<ScanState>('/api/scan/status'),

  manifest: (id: number) => req<EpubManifest>(`/api/items/${id}/manifest`),

  coverUrl: (item: Item) => (item.coverPath ? withToken(`/api/items/${item.id}/cover`) : null),
  streamUrl: (itemId: number, fileId?: number) =>
    withToken(`/api/items/${itemId}/stream${fileId ? `?fileId=${fileId}` : ''}`),
  downloadUrl: (itemId: number, fileId?: number) =>
    withToken(`/api/items/${itemId}/download${fileId ? `?fileId=${fileId}` : ''}`),
  resourceUrl: (itemId: number, href: string) =>
    withToken(`/api/items/${itemId}/resource?href=${encodeURIComponent(href)}`),
};
