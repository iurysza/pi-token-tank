export type ProviderName = "codex" | "kimi";
export type QuotaState = "live" | "stale" | "missing" | "error";

export interface QuotaWindow {
  kind: "five-hour" | "weekly";
  usedPercent: number;
  used?: number;
  limit?: number;
  resetsAt?: number; // Unix milliseconds
}

export interface ProviderQuota {
  provider: ProviderName;
  state: QuotaState;
  fetchedAt?: number;
  plan?: string;
  windows: QuotaWindow[];
  error?: string; // sanitized, user-facing only
}

export interface QuotaSnapshot {
  codex: ProviderQuota;
  kimi: ProviderQuota;
}
