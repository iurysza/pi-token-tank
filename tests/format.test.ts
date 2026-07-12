import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatFooter, formatGauge, formatResetTime, formatWidget } from "../src/format.js";
import type { ProviderQuota, QuotaSnapshot } from "../src/types.js";

const theme = { fg: (color: string, text: string) => `[${color}:${text}]` };
const plainTheme = { fg: (_color: string, text: string) => text };

function liveQuota(provider: ProviderQuota["provider"], five: number, weekly: number): ProviderQuota {
  return {
    provider, state: "live", fetchedAt: 1752306000000,
    plan: provider === "codex" ? "plus" : "Allegro",
    windows: [
      { kind: "five-hour", usedPercent: five, resetsAt: new Date(2025, 6, 12, 3, 25).getTime() },
      { kind: "weekly", usedPercent: weekly, resetsAt: new Date(2025, 6, 13, 9, 0).getTime() },
    ],
  };
}

describe("footer gauges", () => {
  it("buckets pressure into four truthful cells", () => {
    assert.deepEqual([0, 1, 24, 25, 26, 50, 51, 72, 75, 76, 100].map(formatGauge), [
      "▱▱▱▱", "▰▱▱▱", "▰▱▱▱", "▰▱▱▱", "▰▰▱▱", "▰▰▱▱",
      "▰▰▰▱", "▰▰▰▱", "▰▰▰▱", "▰▰▰▰", "▰▰▰▰",
    ]);
  });

  it("renders exact minimal and full shapes", () => {
    const quota = liveQuota("codex", 24, 15);
    assert.equal(formatFooter(quota, "minimal", plainTheme), "▰▱▱▱  24%  ↻  3:25");
    assert.equal(formatFooter(quota, "full", plainTheme), "5h  ▰▱▱▱  24%  ↻ 3:25   ·   7d  ▰▱▱▱  15%  ↻ Sun 9:00");
  });

  it("marks cached quota percentages as stale", () => {
    const quota = liveQuota("kimi", 48, 35);
    quota.state = "stale";
    assert.equal(formatFooter(quota, "minimal", plainTheme), "▰▰▱▱  48%~  ↻  3:25");
  });

  it("colors only exact percentages at thresholds", () => {
    const warning = formatFooter(liveQuota("codex", 70, 89), "full", theme);
    assert.ok(warning.includes("[warning:70%]"));
    assert.ok(warning.includes("[warning:89%]"));
    assert.ok(warning.includes("[dim:5h  ▰▰▰▱  ]"));
    assert.ok(!warning.includes("[warning:5h"));
    assert.ok(formatFooter(liveQuota("codex", 69, 90), "full", theme).includes("[error:90%]"));
  });

  it("formats reset timestamps in local wall-clock time", () => {
    assert.equal(formatResetTime(new Date(2025, 6, 12, 3, 5).getTime(), false), "3:05");
    assert.equal(formatResetTime(new Date(2025, 6, 13, 9, 0).getTime(), true), "Sun 9:00");
  });
});

describe("formatWidget", () => {
  it("retains both provider details", () => {
    const snapshot: QuotaSnapshot = { codex: liveQuota("codex", 24, 61), kimi: liveQuota("kimi", 18, 43) };
    const text = formatWidget(snapshot, theme, 1752306000000).join("\n");
    assert.ok(text.includes("Codex"));
    assert.ok(text.includes("Kimi"));
    assert.ok(text.includes("24% used"));
    assert.ok(text.includes("Run /quotas again to hide."));
  });
});
