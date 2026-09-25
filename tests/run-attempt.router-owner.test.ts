// Copy into extensions/codex/src/app-server. Actual native submission path;
// RPC transport is synthetic, Router handlers and host hook gate are real.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createDeferred } from "openclaw/plugin-sdk/extension-shared";
import { initializeGlobalHookRunner } from "openclaw/plugin-sdk/hook-runtime";
import { createMockPluginRegistry } from "openclaw/plugin-sdk/plugin-test-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createParams,
  createStartedThreadHarness,
  runCodexAppServerAttempt,
  setupRunAttemptTestHooks,
  tempDir,
  threadStartResult,
} from "./run-attempt-test-harness.js";

setupRunAttemptTestHooks();
const highPrompt = "Change the production database schema and migrate it with a recovery plan.";
type Hook = Parameters<typeof createMockPluginRegistry>[0][number];

async function router(params: ReturnType<typeof createParams>) {
  const routerDir = process.env.OPENCLAW_ROUTER_TEST_DIR;
  if (!routerDir) throw new Error("OPENCLAW_ROUTER_TEST_DIR is required");
  const dir = await fs.mkdtemp(path.join(tempDir, "router-native-"));
  let source = await fs.readFile(path.join(routerDir, "index.js"), "utf8");
  source = source.replace(
    'import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";',
    "const definePluginEntry = (entry) => entry;",
  );
  for (const name of ["router.js", "pilot.js", "owner.js"]) {
    source = source.replaceAll(
      `"./${name}"`,
      JSON.stringify(pathToFileURL(path.join(routerDir, name)).href),
    );
  }
  const entry = path.join(dir, "plugin.mjs");
  await fs.writeFile(entry, source);
  const { default: plugin } = await import(/* @vite-ignore */ pathToFileURL(entry).href);
  const hooks: Hook[] = [];
  plugin.register({
    pluginConfig: {
      mode: "live",
      agentIds: ["main"],
      logPath: path.join(dir, "audit.jsonl"),
      metricsPath: path.join(dir, "metrics.json"),
      statePath: path.join(dir, "stop.json"),
      ownerStorePath: path.join(dir, "owners.json"),
    },
    on(hookName: Hook["hookName"], handler: Hook["handler"]) {
      hooks.push({ hookName, handler } as Hook);
    },
  });
  initializeGlobalHookRunner(createMockPluginRegistry(hooks));
  const context = {
    agentId: "main",
    runId: params.runId,
    sessionKey: params.sessionKey,
    senderIsOwner: params.senderIsOwner,
    senderId: "fixture-sender",
    accountId: "fixture-account",
    messageProvider: "telegram",
  };
  return {
    async select() {
      const hook = hooks.find((item) => item.hookName === "before_model_resolve");
      if (!hook) throw new Error("selection hook missing");
      // The prior selection is tested separately in the canonical orchestrator bridge.
      const handler = hook.handler as (event: { prompt: string }, ctx: typeof context) => unknown;
      return await handler({ prompt: params.prompt }, context);
    },
    async audit() {
      const text = await fs.readFile(path.join(dir, "audit.jsonl"), "utf8");
      return JSON.parse(text.trim().split("\n").at(-1)!);
    },
  };
}

function paramsForCase() {
  const params = createParams(path.join(tempDir, "router.jsonl"), path.join(tempDir, "workspace"), {
    provider: "openai",
    prompt: highPrompt,
  });
  params.trigger = "user";
  params.senderIsOwner = true;
  params.senderId = "fixture-sender";
  params.agentAccountId = "fixture-account";
  params.messageProvider = "telegram";
  params.modelId = "gpt-6-astra";
  params.model = { ...params.model, id: "gpt-6-astra", provider: "openai" };
  return params;
}

describe("Router real native submission gate", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  });

  it.each([
    {
      prompt: highPrompt,
      model: "gpt-6-astra",
      override: { providerOverride: "openai", modelOverride: "gpt-6-astra" },
    },
    { prompt: "Hello", model: "gpt-5.6-sol", override: undefined },
  ])(
    "selected $model is actually submitted without fallback",
    async ({ prompt, model, override }) => {
      const params = paramsForCase();
      params.prompt = prompt;
      params.modelId = model;
      params.model = { ...params.model, id: model };
      const plugin = await router(params);
      expect(await plugin.select()).toEqual(override);
      const started = createDeferred<void>();
      const harness = createStartedThreadHarness(async (method, request) => {
        if (method === "thread/start") {
          expect(request).toMatchObject({ model });
          return { ...threadStartResult(), model, modelProvider: "openai" };
        }
        if (method === "turn/start") started.resolve();
      });
      const run = runCodexAppServerAttempt(params);
      await Promise.race([
        started.promise,
        run.then((result) => {
          throw new Error(
            `native attempt settled before submission: ${JSON.stringify(result.terminal)}`,
          );
        }),
      ]);
      await harness.completeTurn({ threadId: "thread-1", turnId: "turn-1" });
      expect((await run).terminal).toEqual({ kind: "ok" });
      const submission = harness.requests.find((request) => request.method === "turn/start");
      expect(submission?.params).toMatchObject({ model });
      const submittedParams = submission?.params as {
        collaborationMode?: { settings: { model: string } };
      };
      if (submittedParams.collaborationMode) {
        expect(submittedParams.collaborationMode.settings.model).toBe(model);
      }
      expect(await plugin.audit()).toMatchObject({
        selected_model: `openai/${model}`,
        effective_model: `openai/${model}`,
        fallback: false,
        result: "PASS",
      });
    },
  );

  it.each(["selection-missing", "effective-mismatch", "non-owner", "unknown-owner"] as const)(
    "blocks %s before any native turn/start",
    async (scenario) => {
      const params = paramsForCase();
      const plugin = await router(params);
      if (scenario !== "selection-missing") await plugin.select();
      if (scenario === "effective-mismatch") {
        params.modelId = "gpt-5.6-sol";
        params.model = { ...params.model, id: "gpt-5.6-sol" };
      }
      if (scenario === "non-owner") params.senderIsOwner = false;
      if (scenario === "unknown-owner") params.senderIsOwner = undefined;
      const harness = createStartedThreadHarness(async (method) => {
        if (method === "thread/start")
          return { ...threadStartResult(), model: params.modelId, modelProvider: "openai" };
      });
      const result = await runCodexAppServerAttempt(params);
      expect(result.terminal).toMatchObject({ kind: "failed", source: "hook:before_agent_run" });
      expect(harness.requests.some((request) => request.method === "turn/start")).toBe(false);
    },
  );

  it("blocks native startup model drift even when requested params still name selected Astra", async () => {
    const params = paramsForCase();
    const plugin = await router(params);
    await plugin.select();
    const harness = createStartedThreadHarness(async (method) => {
      if (method === "thread/start")
        return { ...threadStartResult(), model: "gpt-5.6-sol", modelProvider: "openai" };
    });
    const result = await runCodexAppServerAttempt(params);
    expect(params.modelId).toBe("gpt-6-astra");
    expect(result.terminal).toMatchObject({ kind: "failed", source: "hook:before_agent_run" });
    expect(harness.requests.some((request) => request.method === "turn/start")).toBe(false);
  });
});
