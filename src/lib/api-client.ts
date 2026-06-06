"use client";

// Thin client helper that unwraps the standard response envelope and retries once
// after refreshing the access token on a 401 (Section 7.1).

export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  error_code: string | null;
  data: T;
  request_id: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string | null,
    public status: number,
    public data: unknown,
  ) {
    super(message);
  }
}

async function raw<T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "include",
  });
  const json = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!res.ok || !json.success) {
    throw new ApiError(json.message ?? "Request failed", json.error_code ?? null, res.status, json.data);
  }
  return json;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return (await raw<T>(path, init)).data;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && !path.includes("/auth/")) {
      // Try one silent refresh, then retry.
      const refreshed = await fetch("/api/v1/auth/refresh", { method: "POST", credentials: "include" });
      if (refreshed.ok) return (await raw<T>(path, init)).data;
    }
    throw err;
  }
}

export const apiGet = <T>(path: string) => api<T>(path);
export const apiPost = <T>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const apiDelete = <T>(path: string) => api<T>(path, { method: "DELETE" });
