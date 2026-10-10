export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const base = import.meta.env.VITE_API_BASE ?? "/rahat";
  const response = await fetch(`${base}/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const problem = await response.json();
      message = typeof problem.detail === "string"
        ? problem.detail
        : JSON.stringify(problem.detail);
    } catch {
      // Retain the HTTP error when a proxy returns a non-JSON response.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export const fmt = (value: number, digits = 1) =>
  Number.isFinite(value) ? value.toFixed(digits) : "Unavailable";

export function localDeparture(hour: number): string {
  const whole = Math.floor(hour);
  const minute = Math.round((hour - whole) * 60);
  return `2026-05-15T${String(whole).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:30`;
}
