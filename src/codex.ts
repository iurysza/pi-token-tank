import type { AuthStorageLike, CodexAuthResult } from "./auth.js";
import { getCodexAuth } from "./auth.js";
import type { ProviderQuota, QuotaWindow } from "./types.js";

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const FETCH_TIMEOUT_MS = 10_000;

interface CodexWindow {
  used_percent?: unknown;
  reset_at?: unknown;
  [key: string]: unknown;
}

interface CodexUsageBody {
  plan_type?: unknown;
  rate_limit?: {
    primary_window?: CodexWindow;
    secondary_window?: CodexWindow;
  };
  [key: string]: unknown;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function parseWindow(value: unknown, kind: QuotaWindow["kind"]): QuotaWindow | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const usedPercent = toNumber(record.used_percent);
  if (usedPercent === undefined) return undefined;
  const resetRaw = toNumber(record.reset_at);
  const resetsAt =
    resetRaw === undefined
      ? undefined
      : resetRaw < 1_000_000_000_000
        ? resetRaw * 1000
        : resetRaw;
  return {
    kind,
    usedPercent: clampPercent(usedPercent),
    resetsAt,
  };
}

function parseCodexBody(body: unknown): Omit<ProviderQuota, "provider" | "state" | "fetchedAt" | "error"> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid Codex usage response: expected object");
  }
  const record = body as CodexUsageBody;
  const primary = parseWindow(record.rate_limit?.primary_window, "five-hour");
  const secondary = parseWindow(record.rate_limit?.secondary_window, "weekly");
  if (!primary || !secondary) {
    throw new Error("Invalid Codex usage response: missing rate-limit windows");
  }
  return {
    plan: typeof record.plan_type === "string" ? record.plan_type : undefined,
    windows: [primary, secondary],
  };
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Never echo response bodies, tokens, or account ids.
  return message.replace(/(["'])[^"']*\1/g, '"..."').split("\n")[0] ?? "Codex request failed";
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function performCodexFetch(
  auth: { token: string; accountId: string },
): Promise<ProviderQuota> {
  const response = await fetchWithTimeout(
    CODEX_USAGE_URL,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "ChatGPT-Account-Id": auth.accountId,
        Accept: "application/json",
      },
    },
    FETCH_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`Codex quota request failed (${response.status})`);
  }

  const body = await response.json();
  const parsed = parseCodexBody(body);
  return {
    provider: "codex",
    state: "live",
    fetchedAt: Date.now(),
    ...parsed,
  };
}

export async function fetchCodexQuota(storage: AuthStorageLike): Promise<ProviderQuota> {
  let auth: CodexAuthResult = await getCodexAuth(storage);
  if ("error" in auth) {
    return { provider: "codex", state: "missing", windows: [], error: auth.error };
  }

  try {
    return await performCodexFetch(auth);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const authError = message.includes("401") || message.includes("403");
    if (authError) {
      storage.reload();
      const retry = await getCodexAuth(storage);
      if ("error" in retry) {
        return {
          provider: "codex",
          state: "error",
          windows: [],
          error: retry.error,
        };
      }
      if (retry.token !== auth.token) {
        try {
          return await performCodexFetch(retry);
        } catch (retryError) {
          return {
            provider: "codex",
            state: "error",
            windows: [],
            error: sanitizeError(retryError),
          };
        }
      }
    }
    return {
      provider: "codex",
      state: "error",
      windows: [],
      error: sanitizeError(error),
    };
  }
}
