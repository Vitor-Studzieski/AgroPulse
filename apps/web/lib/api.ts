const PUBLIC_API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const INTERNAL_API = process.env.API_INTERNAL_URL ?? PUBLIC_API;

export function apiUrl(path: string): string {
  const base = typeof window === "undefined" ? INTERNAL_API : PUBLIC_API;
  return `${base}${path}`;
}

export async function apiFetch<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(apiUrl(path), { ...init, headers, cache: "no-store" });
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}
