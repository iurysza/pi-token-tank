import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPiCodexKimiUsage, providerForModel } from "../src/index.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AuthStorageLike } from "../src/auth.js";
import type { QuotaProvider } from "../src/types.js";
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

function fakeAPI(provider = "openai-codex") {
  const handlers: Record<string, ((event: unknown, ctx: unknown) => Promise<unknown>)[]> = {};
  const status: Record<string, string | undefined> = {};
  const widgets: Record<string, string[] | undefined> = {};
  const commands: Record<string, { handler: (args: string, ctx: ExtensionContext) => Promise<void> }> = {};

  const ctx: ExtensionContext = {
    mode: "tui",
    model: { provider, id: "test-model" } as ExtensionContext["model"],
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
  it("routes supported model families and rejects unsupported providers", () => {
    assert.equal(providerForModel({ provider: "openai", id: "gpt" } as ExtensionContext["model"]), "codex");
    assert.equal(providerForModel({ provider: "openai-codex", id: "gpt" } as ExtensionContext["model"]), "codex");
    assert.equal(providerForModel({ provider: "kimi-coding", id: "kimi" } as ExtensionContext["model"]), "kimi");
    assert.equal(providerForModel({ provider: "anthropic", id: "claude" } as ExtensionContext["model"]), undefined);
  });

  it("routes and renders an injected provider adapter", async () => {
    const future: QuotaProvider = {
      id: "future",
      label: "Future",
      matchesModel: (model) => model?.provider === "future",
      fetch: async () => ({
        provider: "future", state: "live", fetchedAt: Date.now(),
        windows: [{
          id: "monthly", shortLabel: "30d", longLabel: "Monthly",
          resetStyle: "weekday-time", usedPercent: 42,
        }],
      }),
      credentialsHint: "Configure Future.",
      footerWindows: { minimal: ["monthly"], full: ["monthly"] },
    };
    const f = fakeAPI("future");
    createPiCodexKimiUsage(f.api, fakeStorage(), undefined, [future]);
    await f.fire("session_start", {});
    assert.ok(f.status["pi-codex-kimi-usage"]?.includes("42%"));
  });

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
      f.ctx.model = { provider: "anthropic", id: "claude" } as ExtensionContext["model"];
      await f.fire("model_select", { type: "model_select", model: f.ctx.model, source: "set" });
      assert.equal(f.status["pi-codex-kimi-usage"], undefined);
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

  it("switches provider footer immediately", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (url) => new Response(JSON.stringify(String(url).includes("chatgpt.com") ? codexUsage : kimiUsage))) as typeof fetch;
    try {
      const f = fakeAPI("openai-codex");
      const storage = { ...fakeStorage(), get: (provider: string) => provider === "openai-codex"
        ? { type: "oauth", access: "token", accountId: "acc-1" }
        : { type: "api_key", key: "token" } } as unknown as AuthStorageLike;
      createPiCodexKimiUsage(f.api, storage);
      await f.fire("session_start", {});
      const codexFooter = f.status["pi-codex-kimi-usage"];
      f.ctx.model = { provider: "kimi-coding", id: "kimi" } as ExtensionContext["model"];
      await f.fire("model_select", { model: f.ctx.model });
      assert.notEqual(f.status["pi-codex-kimi-usage"], codexFooter);
      assert.ok(f.status["pi-codex-kimi-usage"]?.includes("18"));
    } finally { globalThis.fetch = original; }
  });

  it("changes and atomically persists footer mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quota-mode-"));
    const path = join(dir, "preference.json");
    try {
      const f = fakeAPI();
      createPiCodexKimiUsage(f.api, fakeStorage(), path);
      await f.commands.quotas!.handler("full", f.ctx);
      assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { footerMode: "full" });
      assert.ok(f.status["pi-codex-kimi-usage"]);
    } finally { await rm(dir, { recursive: true, force: true }); }
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
