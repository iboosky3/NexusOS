export class StudioApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function studioApi<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/studio${path}`, { method, cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) {
    const detail = value.detail;
    throw new StudioApiError(typeof detail === "string" ? detail : detail?.message || `请求失败 (${response.status})`, response.status);
  }
  return value;
}
