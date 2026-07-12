import type { ProviderName, ProviderQuota, QuotaSnapshot, QuotaWindow } from "./types.js";

interface ThemeLike {
  fg(color: "success" | "warning" | "error" | "dim" | "text" | "accent", text: string): string;
}

const PROVIDER_LABEL: Record<ProviderName, string> = {
  codex: "Codex",
  kimi: "Kimi",
};

const PROVIDER_CODE: Record<ProviderName, string> = {
  codex: "CX",
  kimi: "KM",
};

function thresholdColor(percent: number): "success" | "warning" | "error" {
  if (percent >= 90) return "error";
  if (percent >= 70) return "warning";
  return "success";
}

function maxUsedPercent(windows: QuotaWindow[]): number {
  return windows.reduce((max, w) => Math.max(max, w.usedPercent), 0);
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

export function formatProviderSegment(quota: ProviderQuota): string {
  const code = PROVIDER_CODE[quota.provider];
  if (quota.state === "missing") return `${code} —`;
  if (quota.state === "error") return `${code} !`;
  const staleMarker = quota.state === "stale" ? "~" : "";
  const parts = quota.windows.map((w) => `${shortWindowLabel(w.kind)} ${Math.round(w.usedPercent)}%`);
  return `${code}${staleMarker} ${parts.join(" · ")}`;
}

export function formatFooter(snapshot: QuotaSnapshot, theme: ThemeLike): string {
  const segments = [formatProviderSegment(snapshot.codex), formatProviderSegment(snapshot.kimi)];
  const codexPercent = snapshot.codex.windows.length > 0 ? maxUsedPercent(snapshot.codex.windows) : 0;
  const kimiPercent = snapshot.kimi.windows.length > 0 ? maxUsedPercent(snapshot.kimi.windows) : 0;
  const overallPercent = Math.max(codexPercent, kimiPercent);
  const colored = segments.map((segment, index) => {
    const q = index === 0 ? snapshot.codex : snapshot.kimi;
    if (q.state === "missing" || q.state === "error") return theme.fg("dim", segment);
    const providerPercent = maxUsedPercent(q.windows);
    const color = thresholdColor(providerPercent);
    return theme.fg(color, segment);
  });
  // Use the overall threshold for the separator so the footer reads as a single quota block.
  const separator = theme.fg(thresholdColor(overallPercent), " | ");
  return colored.join(separator);
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
