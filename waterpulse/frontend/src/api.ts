const BASE = import.meta.env.VITE_API_BASE || "/waterpulse/api";

export async function api<T>(
  path: string, method = "GET", body?: unknown, signal?: AbortSignal
): Promise<T> {
  const token = sessionStorage.getItem("waterpulse-token");
  const workspace = localStorage.getItem("waterpulse-workspace");
  const response = await fetch(`${BASE}${path}`, {
    method,
    signal,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(workspace ? { "X-WaterPulse-Workspace": workspace } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as {
      detail?: unknown
    };
    throw new Error(
      typeof payload.detail === "string"
        ? payload.detail
        : `Request failed (${response.status}); check input fields`
    );
  }
  return response.json() as Promise<T>;
}
