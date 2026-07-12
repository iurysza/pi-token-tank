import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCoordinator } from "../src/index.js";
import type { AuthStorageLike } from "../src/auth.js";
import type { ProviderName, ProviderQuota } from "../src/types.js";

function mockStorage(): AuthStorageLike {
  return {
    getApiKey: async () => "token",
    get: () => undefined,
    reload: () => {},
    getOAuthProviders: () => [],
    set: () => {},
  } as unknown as AuthStorageLike;
}

function live(provider: ProviderName, percent: number): ProviderQuota {
  return {
    provider,
    state: "live",
    fetchedAt: Date.now(),
    windows: [
      { kind: "five-hour", usedPercent: percent },
      { kind: "weekly", usedPercent: percent },
    ],
  };
}

describe("createCoordinator", () => {
  it("fetches both providers on refreshAll", async () => {
    const c = createCoordinator(mockStorage(), {
      codex: async () => live("codex", 10),
      kimi: async () => live("kimi", 20),
    });
    const snapshot = await c.refreshAll(true);
    assert.equal(snapshot.codex.state, "live");
    assert.equal(snapshot.kimi.state, "live");
    assert.equal(snapshot.codex.windows[0]?.usedPercent, 10);
  });

  it("deduplicates concurrent refreshes", async () => {
    let calls = 0;
    const c = createCoordinator(mockStorage(), {
      codex: async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 20));
        return live("codex", 10);
      },
      kimi: async () => live("kimi", 20),
    });
    const [a, b] = await Promise.all([c.refresh("codex", true), c.refresh("codex", true)]);
    assert.equal(calls, 1);
    assert.equal(a.state, "live");
    assert.equal(b.state, "live");
  });

  it("uses cache when fresh and not forced", async () => {
    let calls = 0;
    const c = createCoordinator(mockStorage(), {
      codex: async () => {
        calls++;
        return live("codex", 10);
      },
      kimi: async () => live("kimi", 20),
    });
    await c.refreshAll(true);
    const snapshot = await c.refreshAll(false);
    assert.equal(calls, 1);
    assert.equal(snapshot.codex.windows[0]?.usedPercent, 10);
  });

  it("keeps last-good data as stale when a client returns an error state", async () => {
    let succeed = true;
    const c = createCoordinator(mockStorage(), {
      codex: async () => {
        if (succeed) return live("codex", 10);
        return { provider: "codex", state: "error", windows: [], error: "network down" };
      },
      kimi: async () => live("kimi", 20),
    });
    await c.refreshAll(true);
    succeed = false;
    const snapshot = await c.refreshAll(true);
    assert.equal(snapshot.codex.state, "stale");
    assert.equal(snapshot.codex.windows[0]?.usedPercent, 10);
    assert.equal(snapshot.codex.error, "network down");
    assert.equal(snapshot.kimi.state, "live");
  });

  it("one provider failure does not discard the other", async () => {
    const c = createCoordinator(mockStorage(), {
      codex: async () => {
        throw new Error("secret-bearing unexpected failure");
      },
      kimi: async () => live("kimi", 20),
    });
    const snapshot = await c.refreshAll(true);
    assert.equal(snapshot.codex.state, "error");
    assert.equal(snapshot.codex.error, "Unexpected quota refresh failure.");
    assert.equal(snapshot.kimi.state, "live");
  });

  it("clears caches on clear", async () => {
    const c = createCoordinator(mockStorage(), {
      codex: async () => live("codex", 10),
      kimi: async () => live("kimi", 20),
    });
    await c.refreshAll(true);
    c.clear();
    const snapshot = c.getSnapshot();
    assert.equal(snapshot.codex.state, "missing");
    assert.equal(snapshot.kimi.state, "missing");
  });
});
