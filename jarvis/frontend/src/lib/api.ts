/** Typed, same-origin API client. Credentials live in an HttpOnly cookie; the CSRF token in memory only. */

export type ComponentState = "ready" | "not_configured" | "unavailable";

export interface Health {
  status: string;
  version: string;
  setup_required: boolean;
  components: Record<"llm" | "stt" | "tts" | "database", { state: ComponentState }>;
}

export interface AuthState {
  setup_required: boolean;
  authenticated: boolean;
  username?: string;
  csrf_token?: string;
}

export interface Task {
  id: number;
  title: string;
  status: "open" | "done";
  priority: "low" | "normal" | "high" | null;
  due_at: string | null;
  due_all_day: boolean;
  timezone: string;
  created_at: string;
  completed_at: string | null;
}

export interface Memory {
  id: number;
  content: string;
  category: string;
  source: string;
  consent_state: "proposed" | "approved";
  created_at: string;
  updated_at: string;
}

export interface Prefs {
  ui_language: "auto" | "en" | "he";
  timezone: string | null;
  voice_reference_en: string;
  voice_reference_he: string;
  use_hebrew_voice: boolean;
  speak_replies: boolean;
  llm_provider: "ollama" | "groq";
  stt_language: "auto" | "en" | "he";
  boot_animation: boolean;
}

export interface SettingsPayload {
  prefs: Prefs;
  effective_timezone: string;
  groq_available: boolean;
  fish_key_present: boolean;
  env_voice_reference_set: boolean;
}

export interface ApprovalRequest {
  id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  nonce: string;
  preview: string;
  status: string;
  expires_at: string;
  conversation_id: string | null;
}

export type AssistantEvent =
  | { type: "request_received"; conversation_id: string }
  | { type: "thinking"; provider: string; model: string; cloud: boolean }
  | { type: "token"; text: string }
  | { type: "executing"; tool: string; title: string; request_id?: string }
  | { type: "tool_result"; tool: string; ok: boolean; result: Record<string, unknown>; request_id?: string }
  | { type: "approval_required"; request: ApprovalRequest; title: string; side_effect: string }
  | { type: "message"; text: string; spoken: string; timing: Record<string, number | null> }
  | { type: "completed" }
  | { type: "cancelled" }
  | { type: "failed"; code: string; message: string };

export interface Transcript {
  text: string;
  language: string | null;
  language_probability: number | null;
  duration_s: number;
  processing_ms: number;
}

export interface Voice {
  id: string;
  title: string;
  description: string;
  languages: string[];
  tags: string[];
  author: string | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

let csrfToken = "";
export function setCsrf(token: string | undefined): void {
  csrfToken = token ?? "";
}

async function parseError(r: Response): Promise<ApiError> {
  let code = `http_${r.status}`;
  let message = r.statusText || "Request failed";
  try {
    const body = await r.json();
    const d = body?.detail;
    if (typeof d === "string") message = d;
    else if (d && typeof d === "object") {
      code = d.code ?? code;
      message = d.message ?? message;
    }
  } catch {
    /* non-JSON error */
  }
  return new ApiError(r.status, code, message);
}

export async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined && !(body instanceof FormData)) headers["content-type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["x-csrf-token"] = csrfToken;
  const r = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    signal,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  if (!r.ok) throw await parseError(r);
  return (await r.json()) as T;
}

/** POST that returns an SSE stream (`data: {...}\n\n`). Calls `onEvent` for every parsed event. */
export async function stream(
  path: string,
  body: unknown,
  onEvent: (e: AssistantEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken, accept: "text/event-stream" },
    credentials: "same-origin",
    cache: "no-store",
    signal,
    body: JSON.stringify(body),
  });
  if (!r.ok || !r.body) throw await parseError(r);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = drainSse(buffer, onEvent);
  }
  drainSse(buffer + "\n\n", onEvent);
}

export function drainSse(buffer: string, onEvent: (e: AssistantEvent) => void): string {
  let idx: number;
  while ((idx = buffer.indexOf("\n\n")) >= 0) {
    const block = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 2);
    if (block.startsWith("data:")) {
      try {
        onEvent(JSON.parse(block.slice(5)) as AssistantEvent);
      } catch {
        /* ignore malformed event */
      }
    }
  }
  return buffer;
}

export async function speak(text: string, opts: { raw?: boolean; language?: "en" | "he"; reference_id?: string } = {},
  signal?: AbortSignal): Promise<ArrayBuffer> {
  const r = await fetch("/api/audio/speak", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    credentials: "same-origin",
    cache: "no-store",
    signal,
    body: JSON.stringify({ text, ...opts }),
  });
  if (!r.ok) throw await parseError(r);
  return r.arrayBuffer();
}

export const api = {
  health: () => request<Health>("GET", "/api/health"),
  authState: () => request<AuthState>("GET", "/api/auth/state"),
  setup: (username: string, password: string, setup_code: string) =>
    request<AuthState>("POST", "/api/auth/setup", { username, password, setup_code }),
  login: (username: string, password: string) => request<AuthState>("POST", "/api/auth/login", { username, password }),
  logout: () => request("POST", "/api/auth/logout", {}),
  diagnostics: () => request<Record<string, unknown>>("GET", "/api/diagnostics"),
  systemStatus: () => request<Record<string, unknown>>("GET", "/api/system/status"),
  settings: () => request<SettingsPayload>("GET", "/api/settings"),
  saveSettings: (p: Partial<Prefs>) => request<SettingsPayload>("PUT", "/api/settings", p),
  tasks: () => request<{ tasks: Task[]; timezone: string }>("GET", "/api/tasks?status=all"),
  addTask: (title: string, due: string | null) => request<{ task: Task }>("POST", "/api/tasks", { title, due }),
  completeTask: (id: number) => request<{ task: Task }>("POST", `/api/tasks/${id}/complete`, {}),
  reopenTask: (id: number) => request<{ task: Task }>("POST", `/api/tasks/${id}/reopen`, {}),
  deleteTask: (id: number) => request("DELETE", `/api/tasks/${id}`),
  memories: (q = "") => request<{ memories: Memory[] }>("GET", `/api/memories?q=${encodeURIComponent(q)}`),
  addMemory: (content: string, category: string) =>
    request<{ memory: Memory }>("POST", "/api/memories", { content, category }),
  patchMemory: (id: number, patch: Partial<Pick<Memory, "content" | "category">> & { consent_state?: string }) =>
    request<{ memory: Memory | null }>("PATCH", `/api/memories/${id}`, patch),
  deleteMemory: (id: number) => request("DELETE", `/api/memories/${id}`),
  eraseMemories: () => request<{ deleted: number }>("DELETE", "/api/memories"),
  eraseConversations: () => request<{ deleted: number }>("DELETE", "/api/conversations"),
  messages: (cid: string) =>
    request<{ messages: { id: number; role: "user" | "assistant"; content: string; created_at: string }[] }>(
      "GET", `/api/conversations/${cid}/messages`),
  pendingApprovals: () => request<{ pending: ApprovalRequest[] }>("GET", "/api/approvals/pending"),
  warmupStt: () => request<{ loaded: boolean }>("POST", "/api/audio/stt/warmup", {}),
  cancel: (conversation_id: string) => request("POST", "/api/chat/cancel", { conversation_id }),
  transcribe: (blob: Blob, language: string) => {
    const fd = new FormData();
    const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
    fd.append("audio", blob, `speech.${ext}`);
    fd.append("language", language);
    return request<Transcript>("POST", "/api/audio/transcribe", fd);
  },
  searchVoices: (q: string, language: string) =>
    request<{ voices: Voice[] }>("GET", `/api/voice/search?q=${encodeURIComponent(q)}&language=${language}`),
  getVoice: (id: string) => request<{ voice: Voice }>("GET", `/api/voice/${encodeURIComponent(id)}`),
};
