import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTokenTank, providerForModel } from "../src/index.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CredentialSourceLike } from "../src/auth.js";
import type { QuotaProvider } from "../src/types.js";
import codexUsage from "./fixtures/codex-usage.json" with { type: "json" };
import copilotUsage from "./fixtures/copilot-usage.json" with { type: "json" };
import kimiUsage from "./fixtures/kimi-usage.json" with { type: "json" };

function fakeCredentials(): CredentialSourceLike {
  return {
    getApiKey: async () => "token",
    readCredential: () => undefined,
    refreshOAuthToken: async () => null,
  };
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

describe("createTokenTank", () => {
  it("routes supported model families and rejects unsupported providers", () => {
    assert.equal(providerForModel({ provider: "openai", id: "gpt" } as ExtensionContext["model"]), "codex");
    assert.equal(providerForModel({ provider: "openai-codex", id: "gpt" } as ExtensionContext["model"]), "codex");
    assert.equal(providerForModel({ provider: "kimi-coding", id: "kimi" } as ExtensionContext["model"]), "kimi");
    assert.equal(providerForModel({ provider: "github-copilot", id: "gpt" } as ExtensionContext["model"]), "copilot");
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
    createTokenTank(f.api, fakeCredentials(), undefined, [future]);
    await f.fire("session_start", {});
    assert.ok(f.status["pi-token-tank"]?.includes("42%"));
  });

  it("registers without eagerly creating credential storage", () => {
    fakeAPI();
    const registered: string[] = [];
    const pi = {
      on: () => {},
      registerCommand: (name: string) => {
        registered.push(name);
      },
    } as unknown as ExtensionAPI;
    createTokenTank(pi);
    assert.ok(registered.includes("token-tank"));
    assert.ok(!registered.includes("usage"));
  });

  it(
    "sets footer on session_start",
    withMockFetch(async () => {
      const f = fakeAPI();
      createTokenTank(f.api, fakeCredentials());
      await f.fire("session_start", { type: "session_start", reason: "startup" });
      assert.ok(f.status["pi-token-tank"], "status should be set");
      f.ctx.model = { provider: "anthropic", id: "claude" } as ExtensionContext["model"];
      await f.fire("model_select", { type: "model_select", model: f.ctx.model, source: "set" });
      assert.equal(f.status["pi-token-tank"], undefined);
    }),
  );

  it("toggles the /token-tank widget", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (url) => {
      const value = String(url);
      const body = value.includes("chatgpt.com")
        ? codexUsage
        : value.includes("api.github.com")
          ? copilotUsage
          : kimiUsage;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    try {
      const f = fakeAPI();
      const credentials = {
        ...fakeCredentials(),
        readCredential: (provider: string) => provider === "openai-codex"
          ? { type: "oauth", access: "token", accountId: "acc-1" }
          : provider === "github-copilot"
            ? { type: "oauth", access: "copilot-session-token", refresh: "github-oauth-token" }
            : { type: "api_key", key: "token" },
      } as CredentialSourceLike;
      createTokenTank(f.api, credentials);
      await f.commands["token-tank"]!.handler("", f.ctx);
      const widget = f.widgets["pi-token-tank"]?.join("\n") ?? "";
      assert.ok(widget.includes("GitHub Copilot"));
      assert.ok(widget.includes("Monthly"));
      assert.ok(widget.includes("25% used"));
      assert.ok(f.widgets["pi-token-tank"]?.includes("Run /token-tank again to hide."));
      await f.commands["token-tank"]!.handler("", f.ctx);
      assert.equal(f.widgets["pi-token-tank"], undefined);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("switches provider footer immediately", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (url) => new Response(JSON.stringify(String(url).includes("chatgpt.com") ? codexUsage : kimiUsage))) as typeof fetch;
    try {
      const f = fakeAPI("openai-codex");
      const credentials = {
        ...fakeCredentials(),
        readCredential: (provider: string) => provider === "openai-codex"
          ? { type: "oauth", access: "token", accountId: "acc-1" }
          : { type: "api_key", key: "token" },
      } as CredentialSourceLike;
      createTokenTank(f.api, credentials);
      await f.fire("session_start", {});
      const codexFooter = f.status["pi-token-tank"];
      f.ctx.model = { provider: "kimi-coding", id: "kimi" } as ExtensionContext["model"];
      await f.fire("model_select", { model: f.ctx.model });
      assert.notEqual(f.status["pi-token-tank"], codexFooter);
      assert.ok(f.status["pi-token-tank"]?.includes("18"));
    } finally { globalThis.fetch = original; }
  });

  it("changes and atomically persists footer mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quota-mode-"));
    const path = join(dir, "preference.json");
    try {
      const f = fakeAPI();
      createTokenTank(f.api, fakeCredentials(), path);
      await f.commands["token-tank"]!.handler("full", f.ctx);
      assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { footerMode: "full" });
      assert.ok(f.status["pi-token-tank"]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it(
    "cleans up on session_shutdown",
    withMockFetch(async () => {
      const f = fakeAPI();
      createTokenTank(f.api, fakeCredentials());
      await f.fire("session_start", { type: "session_start", reason: "startup" });
      await f.fire("session_shutdown", { type: "session_shutdown", reason: "quit" });
      assert.equal(f.status["pi-token-tank"], undefined);
      assert.equal(f.widgets["pi-token-tank"], undefined);
    }),
  );
});
