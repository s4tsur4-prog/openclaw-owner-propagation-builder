// Copy to src/agents/embedded-agent-runner in the exact patched checkout.
// Real orchestrator + real Router handlers; external attempt/model execution is mocked.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginHookRegistration } from "../../plugins/hook-types.js";
import { createHookRunner } from "../../plugins/hooks.js";
import type { OpenClawTestState } from "../../test-utils/openclaw-test-state.js";
import { makeAttemptResult } from "./run.overflow-compaction.fixture.js";
import {
  createOverflowRunParams,
  loadRunOverflowCompactionHarness,
  mockedBuildEmbeddedRunPayloads,
  mockedGlobalHookRunner,
  mockedRunEmbeddedAttempt,
  resetSharedRunIntegrationHarnessMocks,
  useOpenAIPlatformAuthFixture,
} from "./run.overflow-compaction.harness.js";
import type { RunEmbeddedAgentInternalParams } from "./run/internal-params.js";

const { runEmbeddedAgent } = await loadRunOverflowCompactionHarness();
const highPrompt = "Change the production database schema and migrate it with a recovery plan.";
let state: OpenClawTestState;
let dir: string;
let runner: ReturnType<typeof createHookRunner>;
let sequence = 0;

describe("patched canonical core and Router V1 owner bridge", () => {
  beforeEach(async () => {
    resetSharedRunIntegrationHarnessMocks();
    const { createOpenClawTestState } = await import("../../test-utils/openclaw-test-state.js");
    state = await createOpenClawTestState({ label: "router-owner-bridge" });
    useOpenAIPlatformAuthFixture();
    mockedBuildEmbeddedRunPayloads.mockReturnValue([{ text: "OK" }]);
    mockedRunEmbeddedAttempt.mockResolvedValue(makeAttemptResult({ assistantTexts: ["OK"] }));
    const routerDir = process.env.OPENCLAW_ROUTER_TEST_DIR;
    if (!routerDir)
      throw new Error("OPENCLAW_ROUTER_TEST_DIR must identify audited isolated Router source");
    dir = await fs.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "router-core-bridge-"));
    let source = await fs.readFile(path.join(routerDir, "index.js"), "utf8");
    // Only definition packaging is shimmed; every Router handler is the staged source.
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
    const typedHooks: PluginHookRegistration[] = [];
    plugin.register({
      pluginConfig: {
        mode: "live",
        agentIds: ["main"],
        logPath: path.join(dir, "audit.jsonl"),
        metricsPath: path.join(dir, "metrics.json"),
        statePath: path.join(dir, "stop.json"),
        ownerStorePath: path.join(dir, "owners.json"),
      },
      on(
        hookName: PluginHookRegistration["hookName"],
        handler: PluginHookRegistration["handler"],
        options: { priority?: number } = {},
      ) {
        typedHooks.push({
          pluginId: "model-router-v1",
          hookName,
          handler,
          priority: options.priority,
          source: "isolated-router",
        } as PluginHookRegistration);
      },
    });
    runner = createHookRunner({ hooks: [], typedHooks, plugins: [] });
    mockedGlobalHookRunner.hasHooks.mockImplementation((name) =>
      typedHooks.some((hook) => hook.hookName === name),
    );
    mockedGlobalHookRunner.runBeforeAgentReply.mockImplementation((event, ctx) =>
      runner.runBeforeAgentReply(event, ctx),
    );
    mockedGlobalHookRunner.runBeforeModelResolve.mockImplementation((event, ctx) =>
      runner.runBeforeModelResolve(event, ctx),
    );
    mockedGlobalHookRunner.runBeforeAgentFinalize.mockImplementation((event, ctx) =>
      runner.runBeforeAgentFinalize(event, ctx),
    );
  });

  afterEach(async () => {
    await state?.cleanup();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  function run(overrides: Partial<RunEmbeddedAgentInternalParams> = {}) {
    return runEmbeddedAgent({
      ...createOverflowRunParams(state),
      runId: `router-bridge-${++sequence}`,
      provider: "openai",
      model: "gpt-5.6-sol",
      messageProvider: "telegram",
      agentAccountId: "fixture-account",
      senderId: "fixture-sender",
      trigger: "user",
      ...overrides,
    });
  }

  it.each([false, undefined])(
    "blocks healthy emergency owner=%s before attempt submission",
    async (senderIsOwner) => {
      const result = await run({ prompt: highPrompt, senderIsOwner });
      expect(mockedRunEmbeddedAttempt).not.toHaveBeenCalled();
      expect(mockedGlobalHookRunner.runBeforeModelResolve).not.toHaveBeenCalled();
      expect(result.payloads?.[0]?.text).toContain("owner_authority_required");
    },
  );

  it.each([false, undefined])(
    "blocks stopped emergency owner=%s before attempt submission",
    async (senderIsOwner) => {
      await fs.writeFile(path.join(dir, "stop.json"), JSON.stringify({ stopped: true }));
      const result = await run({ prompt: highPrompt, senderIsOwner });
      expect(mockedRunEmbeddedAttempt).not.toHaveBeenCalled();
      expect(mockedGlobalHookRunner.runBeforeModelResolve).not.toHaveBeenCalled();
      expect(result.payloads?.[0]?.text).toContain("router_stopped_emergency_high_risk");
    },
  );

  it.each(["cron", "heartbeat"] as const)(
    "stale owner cannot bypass stopped %s emergency",
    async (trigger) => {
      await fs.writeFile(path.join(dir, "stop.json"), JSON.stringify({ stopped: true }));
      const result = await run({ prompt: highPrompt, trigger, senderIsOwner: true });
      expect(mockedRunEmbeddedAttempt).not.toHaveBeenCalled();
      expect(result.payloads?.[0]?.text).toContain("router_stopped_emergency_high_risk");
    },
  );

  it("normal dispatches Sol; current owner HIGH dispatches Astra", async () => {
    await run({ prompt: "Hello", senderIsOwner: true });
    const first = mockedGlobalHookRunner.runBeforeModelResolve.mock.lastCall?.[1];
    expect(first?.senderIsOwner).toBe(true);
    expect(mockedRunEmbeddedAttempt.mock.lastCall?.[0]).toMatchObject({
      provider: "openai",
      modelId: "gpt-5.6-sol",
    });
    await run({ prompt: highPrompt, senderIsOwner: true });
    expect(mockedRunEmbeddedAttempt.mock.lastCall?.[0]).toMatchObject({
      provider: "openai",
      modelId: "gpt-6-astra",
    });
    const context = mockedGlobalHookRunner.runBeforeModelResolve.mock.lastCall?.[1];
    expect(context?.senderIsOwner).toBe(true);
  });

  it("same-session prior owner binding never admits the next non-owner emergency", async () => {
    await run({ prompt: "Hello", senderIsOwner: true });
    const store = JSON.parse(await fs.readFile(path.join(dir, "owners.json"), "utf8"));
    expect(store.owners).toHaveLength(1);
    mockedRunEmbeddedAttempt.mockClear();
    await fs.writeFile(path.join(dir, "stop.json"), JSON.stringify({ stopped: true }));
    await run({ prompt: highPrompt, senderIsOwner: false });
    expect(mockedRunEmbeddedAttempt).not.toHaveBeenCalled();
  });
});
