import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatFooter, formatProviderSegment, formatWidget } from "../src/format.js";
import type { ProviderQuota, QuotaSnapshot } from "../src/types.js";

const theme = {
  fg: (color: string, text: string) => `[${color}:${text}]`,
};

function liveQuota(provider: ProviderQuota["provider"], five: number, weekly: number): ProviderQuota {
  return {
    provider,
    state: "live",
    fetchedAt: 1752306000000,
    plan: provider === "codex" ? "plus" : "Allegro",
    windows: [
      { kind: "five-hour", usedPercent: five, resetsAt: 1752313800000 },
      { kind: "weekly", usedPercent: weekly, resetsAt: 1752774000000 },
    ],
  };
}

describe("formatProviderSegment", () => {
  it("formats a live provider", () => {
    const segment = formatProviderSegment(liveQuota("codex", 24, 61));
    assert.equal(segment, "CX 5h 24% · 7d 61%");
  });

  it("marks stale data", () => {
    const q = liveQuota("kimi", 18, 43);
    q.state = "stale";
    assert.equal(formatProviderSegment(q), "KM~ 5h 18% · 7d 43%");
  });

  it("shows missing and error states", () => {
    assert.equal(formatProviderSegment({ provider: "codex", state: "missing", windows: [] }), "CX —");
    assert.equal(formatProviderSegment({ provider: "kimi", state: "error", windows: [] }), "KM !");
  });
});

describe("formatFooter", () => {
  it("combines both providers", () => {
    const snapshot: QuotaSnapshot = {
      codex: liveQuota("codex", 24, 61),
      kimi: liveQuota("kimi", 18, 43),
    };
    const footer = formatFooter(snapshot, theme);
    assert.ok(footer.includes("CX 5h 24% · 7d 61%"));
    assert.ok(footer.includes("KM 5h 18% · 7d 43%"));
  });

  it("uses warning color for 70-89%", () => {
    const snapshot: QuotaSnapshot = {
      codex: liveQuota("codex", 75, 50),
      kimi: liveQuota("kimi", 10, 20),
    };
    const footer = formatFooter(snapshot, theme);
    assert.ok(footer.includes("[warning:"));
  });

  it("uses error color for 90%+", () => {
    const snapshot: QuotaSnapshot = {
      codex: liveQuota("codex", 95, 50),
      kimi: liveQuota("kimi", 10, 20),
    };
    const footer = formatFooter(snapshot, theme);
    assert.ok(footer.includes("[error:"));
  });
});

describe("formatWidget", () => {
  it("renders provider headers and windows", () => {
    const snapshot: QuotaSnapshot = {
      codex: liveQuota("codex", 24, 61),
      kimi: liveQuota("kimi", 18, 43),
    };
    const lines = formatWidget(snapshot, theme, 1752306000000);
    const text = lines.join("\n");
    assert.ok(text.includes("Quota usage"));
    assert.ok(text.includes("Codex"));
    assert.ok(text.includes("Kimi"));
    assert.ok(text.includes("24% used"));
    assert.ok(text.includes("61% used"));
    assert.ok(text.includes("Run /quotas again to hide."));
  });

  it("renders missing credentials", () => {
    const snapshot: QuotaSnapshot = {
      codex: {
        provider: "codex",
        state: "missing",
        windows: [],
        error: "Codex credentials missing. Run /login openai-codex.",
      },
      kimi: liveQuota("kimi", 18, 43),
    };
    const lines = formatWidget(snapshot, theme, 1752306000000);
    assert.equal(lines.filter((l) => /credentials missing/i.test(l)).length, 1);
  });
});
