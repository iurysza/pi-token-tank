import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPiCodexKimiUsage } from "../src/index.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AuthStorageLike } from "../src/auth.js";
import codexUsage from "./fixtures/codex-usage.json" with { type: "json" };
import kimiUsage from "./fixtures/kimi-usage.json" with { type: "json" };

function fakeStorage(): AuthStorageLike {
  return {
    getApiKey: async () => "token",
    get: () => undefined,
    reload: () => {},
    getOAuthProviders: () => [],
    set: () => {},
  } as unknown as AuthStorageLike;
}

function withMockFetch(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response("unauthorized", { status: 401 });
    try {
      await fn();
    } finally {
      globalThis.fetch = original;
    }
  };
}

function fakeAPI() {
  const handlers: Record<string, ((event: unknown, ctx: unknown) => Promise<unknown>)[]> = {};
  const status: Record<string, string | undefined> = {};
  const widgets: Record<string, string[] | undefined> = {};
  const commands: Record<string, { handler: (args: string, ctx: ExtensionContext) => Promise<void> }> = {};

  const ctx: ExtensionContext = {
    mode: "tui",
    ui: {
      setStatus: (key: string, text: string | undefined) => {
        status[key] = text;
      },
      setWidget: (key: string, content: string[] | undefined) => {
        widgets[key] = content;
      },
      theme: {
        fg: (_color: string, text: string) => text,
      },
    } as unknown as ExtensionContext["ui"],
  } as unknown as ExtensionContext;

  return {
    api: {
      on: (event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        handlers[event] = handlers[event] ?? [];
        handlers[event]!.push(handler);
      },
      registerCommand: (name: string, options: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) => {
        commands[name] = options;
      },
    } as unknown as ExtensionAPI,
    handlers,
    status,
    widgets,
    commands,
    ctx,
    async fire(event: string, payload: unknown) {
      for (const h of handlers[event] ?? []) {
        await h(payload, ctx);
      }
    },

  };
}

describe("createPiCodexKimiUsage", () => {
  it("registers /quotas and not /usage", () => {
    fakeAPI();
    const registered: string[] = [];
    const pi = {
      on: () => {},
      registerCommand: (name: string) => {
        registered.push(name);
      },
    } as unknown as ExtensionAPI;
    createPiCodexKimiUsage(pi, fakeStorage());
    assert.ok(registered.includes("quotas"));
    assert.ok(!registered.includes("usage"));
  });

  it(
    "sets footer on session_start",
    withMockFetch(async () => {
      const f = fakeAPI();
      createPiCodexKimiUsage(f.api, fakeStorage());
      await f.fire("session_start", { type: "session_start", reason: "startup" });
      assert.ok(f.status["pi-codex-kimi-usage"], "status should be set");
    }),
  );

  it("toggles the /quotas widget", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (url) => {
      const body = String(url).includes("chatgpt.com") ? codexUsage : kimiUsage;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    try {
      const f = fakeAPI();
      const storage = {
        ...fakeStorage(),
        get: (provider: string) => provider === "openai-codex"
          ? { type: "oauth", access: "token", accountId: "acc-1" }
          : { type: "api_key", key: "token" },
      } as unknown as AuthStorageLike;
      createPiCodexKimiUsage(f.api, storage);
      await f.commands.quotas!.handler("", f.ctx);
      assert.ok(f.widgets["pi-codex-kimi-usage"]?.includes("Run /quotas again to hide."));
      await f.commands.quotas!.handler("", f.ctx);
      assert.equal(f.widgets["pi-codex-kimi-usage"], undefined);
    } finally {
      globalThis.fetch = original;
    }
  });

  it(
    "cleans up on session_shutdown",
    withMockFetch(async () => {
      const f = fakeAPI();
      createPiCodexKimiUsage(f.api, fakeStorage());
      await f.fire("session_start", { type: "session_start", reason: "startup" });
      await f.fire("session_shutdown", { type: "session_shutdown", reason: "quit" });
      assert.equal(f.status["pi-codex-kimi-usage"], undefined);
      assert.equal(f.widgets["pi-codex-kimi-usage"], undefined);
    }),
  );
});
