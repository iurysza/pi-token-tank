import type { FooterMode } from "./preferences.js";
import type { ProviderName, ProviderQuota, QuotaSnapshot, QuotaWindow } from "./types.js";

interface ThemeLike {
  fg(color: "success" | "warning" | "error" | "dim" | "text" | "accent", text: string): string;
}

const PROVIDER_LABEL: Record<ProviderName, string> = {
  codex: "Codex",
  kimi: "Kimi",
};

function thresholdColor(percent: number): "success" | "warning" | "error" {
  if (percent >= 90) return "error";
  if (percent >= 70) return "warning";
  return "success";
}

function shortWindowLabel(kind: QuotaWindow["kind"]): string {
  return kind === "five-hour" ? "5h" : "7d";
}

function longWindowLabel(kind: QuotaWindow["kind"]): string {
  return kind === "five-hour" ? "5h" : "Weekly";
}

function formatResetDuration(deltaMs: number): string {
  if (deltaMs <= 0) return "soon";
  const minutes = Math.floor(deltaMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const remMinutes = minutes % 60;
  const remHours = hours % 24;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (remHours > 0 || (days > 0 && remMinutes > 0)) parts.push(`${remHours}h`);
  if (days === 0 && remMinutes > 0) parts.push(`${remMinutes}m`);
  if (parts.length === 0) return "soon";
  return parts.join(" ");
}

function formatUpdatedTime(fetchedAt?: number): string {
  if (!fetchedAt) return "—";
  const date = new Date(fetchedAt);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function formatGauge(percent: number): string {
  const filled = percent <= 0 ? 0 : Math.min(4, Math.ceil(percent / 25));
  return "▰".repeat(filled) + "▱".repeat(4 - filled);
}

export function formatResetTime(resetsAt: number, weekly: boolean): string {
  const date = new Date(resetsAt);
  const time = `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
  return weekly ? `${date.toLocaleDateString("en-US", { weekday: "short" })} ${time}` : time;
}

function formatFooterWindow(window: QuotaWindow, label: boolean, stale: boolean, theme: ThemeLike): string {
  const percent = `${window.usedPercent}%${stale ? "~" : ""}`;
  const reset = window.resetsAt
    ? `  ↻${label ? " " : "  "}${formatResetTime(window.resetsAt, window.kind === "weekly")}`
    : "";
  const prefix = label ? `${shortWindowLabel(window.kind)}  ` : "";
  return `${theme.fg("dim", `${prefix}${formatGauge(window.usedPercent)}  `)}${theme.fg(thresholdColor(window.usedPercent), percent)}${theme.fg("dim", reset)}`;
}

export function formatFooter(quota: ProviderQuota, mode: FooterMode, theme: ThemeLike): string {
  if (quota.state === "missing") return theme.fg("dim", "—");
  if (quota.state === "error") return theme.fg("dim", "!");
  const fiveHour = quota.windows.find((window) => window.kind === "five-hour");
  if (!fiveHour) return theme.fg("dim", "—");
  const stale = quota.state === "stale";
  const fiveHourText = formatFooterWindow(fiveHour, mode === "full", stale, theme);
  if (mode === "minimal") return fiveHourText;
  const weekly = quota.windows.find((window) => window.kind === "weekly");
  if (!weekly) return fiveHourText;
  return `${fiveHourText}${theme.fg("dim", "   ·   ")}${formatFooterWindow(weekly, true, stale, theme)}`;
}

export function formatWidget(snapshot: QuotaSnapshot, theme: ThemeLike, nowMs: number): string[] {
  const lines: string[] = [];
  lines.push(theme.fg("accent", "Quota usage"));
  lines.push("");

  const providers: ProviderQuota[] = [snapshot.codex, snapshot.kimi];
  for (const q of providers) {
    const label = PROVIDER_LABEL[q.provider];
    const plan = q.plan ?? "—";
    const state = q.state;
    lines.push(
      `${theme.fg("accent", label)}${theme.fg("dim", ` · ${plan} · ${state}`)}`,
    );

    if (q.state === "missing") {
      lines.push(theme.fg("dim", `  Credentials missing. Run /login ${q.provider === "codex" ? "openai-codex" : "kimi-coding"}.`));
    } else if (q.state === "error" && q.error) {
      lines.push(theme.fg("error", `  ${q.error}`));
    } else {
      for (const w of q.windows) {
        const labelText = longWindowLabel(w.kind).padEnd(7);
        const percentText = `${Math.round(w.usedPercent)}% used`;
        const resetText = w.resetsAt ? `resets ${formatResetDuration(w.resetsAt - nowMs)}` : "";
        const color = thresholdColor(w.usedPercent);
        const parts = [`  ${labelText}`, theme.fg(color, percentText)];
        if (resetText) parts.push(theme.fg("dim", resetText));
        lines.push(parts.join("   "));
      }
    }

    if (q.error && q.state === "stale") {
      lines.push(theme.fg("warning", `  ${q.error}`));
    }

    lines.push("");
  }

  const updated = formatUpdatedTime(snapshot.codex.fetchedAt ?? snapshot.kimi.fetchedAt);
  lines.push(theme.fg("dim", `Updated ${updated}`));
  lines.push(theme.fg("dim", "Run /quotas again to hide."));

  return lines;
}

export { formatResetDuration };
