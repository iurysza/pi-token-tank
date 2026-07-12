import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchKimiQuota } from "../src/kimi.js";
import type { AuthStorageLike } from "../src/auth.js";
import kimiUsage from "./fixtures/kimi-usage.json" with { type: "json" };
import kimiNumeric from "./fixtures/kimi-usage-numeric-strings.json" with { type: "json" };

function mockStorage(overrides?: {
  token?: string;
  type?: "oauth" | "api_key";
  noCredential?: boolean;
}): AuthStorageLike {
  return {
    getApiKey: async () => (overrides?.noCredential ? undefined : overrides?.token ?? "token"),
    get: () =>
      overrides?.noCredential
        ? undefined
        : overrides?.type === "api_key"
          ? { type: "api_key", key: overrides?.token ?? "token" }
          : {
              type: "oauth",
              access: overrides?.token ?? "token",
              refresh: "refresh-token",
              expires: Date.now() + 3600_000,
            },
    reload: () => {},
    getOAuthProviders: () => [],
    set: () => {},
  } as unknown as AuthStorageLike;
}

function mockFetch(response: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url, init) => response(url as string, init as RequestInit)) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe("fetchKimiQuota", () => {
  it("parses a valid usage response", async () => {
    const restore = mockFetch(() => new Response(JSON.stringify(kimiUsage), { status: 200 }));
    try {
      const quota = await fetchKimiQuota(mockStorage());
      assert.equal(quota.provider, "kimi");
      assert.equal(quota.state, "live");
      assert.equal(quota.plan, "Allegro");
      assert.equal(quota.windows.length, 2);
      assert.equal(quota.windows[0]?.id, "five-hour");
      assert.equal(quota.windows[0]?.usedPercent, 18);
      assert.equal(quota.windows[1]?.id, "weekly");
      assert.equal(quota.windows[1]?.usedPercent, 43);
    } finally {
      restore();
    }
  });

  it("handles numeric strings and derived usage", async () => {
    const restore = mockFetch(() => new Response(JSON.stringify(kimiNumeric), { status: 200 }));
    try {
      const quota = await fetchKimiQuota(mockStorage());
      assert.equal(quota.plan, "Vivace");
      assert.equal(quota.windows[1]?.usedPercent, 43); // (200-114)/200
      assert.equal(quota.windows[0]?.usedPercent, 22.5);
    } finally {
      restore();
    }
  });

  it("returns missing state when credentials are absent", async () => {
    const restore = mockFetch(() => new Response(JSON.stringify(kimiUsage), { status: 200 }));
    try {
      const quota = await fetchKimiQuota(mockStorage({ noCredential: true }));
      assert.equal(quota.state, "missing");
    } finally {
      restore();
    }
  });

  it("forces one OAuth refresh on 401", async () => {
    const refreshed: string[] = [];
    const provider = {
      id: "kimi-coding",
      refreshToken: async () => {
        refreshed.push("yes");
        return { access: "new-access", refresh: "new-refresh", expires: Date.now() + 3600_000 };
      },
    };
    const storage = {
      ...mockStorage({ token: "old-token", type: "oauth" }),
      getOAuthProviders: () => [provider],
    } as unknown as AuthStorageLike;

    const restore = mockFetch((_url, init) => {
      const auth = (init.headers as Record<string, string>)["Authorization"];
      if (auth === "Bearer old-token") {
        return new Response("unauthorized", { status: 401 });
      }
      return new Response(JSON.stringify(kimiUsage), { status: 200 });
    });

    try {
      const quota = await fetchKimiQuota(storage);
      assert.equal(quota.state, "live");
      assert.equal(refreshed.length, 1);
    } finally {
      restore();
    }
  });

  it("returns a sanitized error when OAuth refresh fails", async () => {
    const provider = {
      id: "kimi-coding",
      refreshToken: async () => {
        throw new Error("refresh-token secret leaked by provider");
      },
    };
    const storage = {
      ...mockStorage({ token: "old-token", type: "oauth" }),
      getOAuthProviders: () => [provider],
    } as unknown as AuthStorageLike;

    const restore = mockFetch(() => new Response("unauthorized", { status: 401 }));
    try {
      const quota = await fetchKimiQuota(storage);
      assert.equal(quota.state, "error");
      assert.ok(!quota.error?.includes("refresh-token"));
    } finally {
      restore();
    }
  });

  it("does not attempt OAuth refresh for API keys", async () => {
    const provider = {
      id: "kimi-coding",
      refreshToken: async () => ({ access: "x", refresh: "y", expires: Date.now() }),
    };
    const storage = {
      ...mockStorage({ token: "api-key", type: "api_key" }),
      getOAuthProviders: () => [provider],
    } as unknown as AuthStorageLike;

    let refreshed = false;
    provider.refreshToken = async () => {
      refreshed = true;
      return { access: "x", refresh: "y", expires: Date.now() };
    };

    const restore = mockFetch(() => new Response("unauthorized", { status: 401 }));
    try {
      const quota = await fetchKimiQuota(storage);
      assert.equal(quota.state, "error");
      assert.equal(refreshed, false);
    } finally {
      restore();
    }
  });

  it("rejects invalid schemas", async () => {
    const restore = mockFetch(() => new Response(JSON.stringify({ usage: {} }), { status: 200 }));
    try {
      const quota = await fetchKimiQuota(mockStorage());
      assert.equal(quota.state, "error");
    } finally {
      restore();
    }
  });
});
