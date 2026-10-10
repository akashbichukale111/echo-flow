import type { Intervention, Scenario } from "./types";

const base = import.meta.env.VITE_API_BASE ?? "/echo-flow";

export async function request<T>(path: string, body?: unknown, token = ""): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 180000);
  try {
    const response = await fetch(`${base}/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      const detail = typeof data === "object" && data !== null && "detail" in data
        ? String((data as { detail: unknown }).detail) : "Request failed";
      throw new Error(`${response.status}: ${detail}`);
    }
    return data as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. Reload scenario before retrying; server completion is unknown.");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function runDecision(scenarioId: string, token: string, intervention?: Intervention): Promise<Scenario> {
  const result = await request<Scenario | { execution_arn: string; scenario_id: string }>(
    `/scenarios/${scenarioId}/decision`, { intervention: intervention ?? null }, token);
  if (!("execution_arn" in result)) return result;

  for (let i = 0; i < 180; i++) {
    await new Promise(resolve => window.setTimeout(resolve, 1500));
    const state = await request<{ status: string; error?: string }>(
      `/executions?arn=${encodeURIComponent(result.execution_arn)}`, undefined, token);
    if (state.status === "SUCCEEDED") return request<Scenario>(`/scenarios/${scenarioId}`, undefined, token);
    if (state.status !== "RUNNING") {
      throw new Error(`AWS workflow ${state.status}: ${state.error ?? "Inspect AWS execution logs"}`);
    }
  }
  throw new Error("Workflow is still running or status is unavailable. Reload before retrying.");
}
