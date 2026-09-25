import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readStopState, writeStopState } from "../pilot.js";

const ASTRA = "openai/gpt-6-astra";

async function harness() {
  const sourcePath = new URL("../index.js", import.meta.url);
  const source = fs.readFileSync(sourcePath, "utf8");
  const importPath = path.join(os.tmpdir(), `model-router-v1-index-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(importPath, source.replace('import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";', 'const definePluginEntry = (entry) => entry;').replaceAll('"./router.js"', `"${new URL("../router.js", import.meta.url).href}"`).replaceAll('"./pilot.js"', `"${new URL("../pilot.js", import.meta.url).href}"`).replaceAll('"./owner.js"', `"${new URL("../owner.js", import.meta.url).href}"`));
  const { default: plugin } = await import(`${new URL(`file://${importPath}`).href}?v=${Date.now()}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "router-plugin-lifecycle-"));
  const hooks = new Map();
  const api = {
    pluginConfig: {
      mode: "live",
      agentIds: ["main"],
      logPath: path.join(dir, "audit.jsonl"),
      metricsPath: path.join(dir, "metrics.json"),
      statePath: path.join(dir, "state.json"),
      ownerStorePath: path.join(dir, "owners.json")
    },
    on(name, handler) {
      hooks.set(name, handler);
    }
  };
  plugin.register(api);
  return { dir, hooks, statePath: api.pluginConfig.statePath, ownerStorePath: api.pluginConfig.ownerStorePath };
}

const ctx = {
  agentId: "main",
  sessionKey: "agent:main:telegram:direct:1000000001",
  channel: "telegram",
  accountId: "default",
  senderIsOwner: true,
  modelProviderId: "openai",
  modelId: "gpt-6-astra",
  senderId: "1000000001"
};
const readOnlyPrompt = "Review a proposed change to a production database schema and migration recovery plan; this is read-only analysis and must not execute any mutation.";
const highPrompt = "Change the production database schema and migrate it with a recovery plan.";

test("verified owner HIGH read-only lifecycle selects Astra and completes without STOP", async () => {
  const { hooks, statePath } = await harness();
  const runId = "owner-high-readonly";
  const selected = await hooks.get("before_model_resolve")({ runId, prompt: readOnlyPrompt }, { ...ctx, runId });
  assert.deepEqual(selected, { providerOverride: "openai", modelOverride: "gpt-6-astra" });
  await hooks.get("before_agent_run")({ runId, senderIsOwner: true }, { ...ctx, runId });
  await hooks.get("model_call_ended")({ runId, resolvedRef: ASTRA, outcome: "completed" }, { ...ctx, runId });
  await hooks.get("llm_output")({ runId, resolvedRef: ASTRA, provider: "openai", model: "gpt-6-astra" }, { ...ctx, runId });
  await hooks.get("agent_end")({ runId, success: true, durationMs: 1 }, { ...ctx, runId });
  assert.equal(readStopState(statePath).stopped, false);
});

test("simulated user abort after Astra selection keeps stopped false", async () => {
  const { hooks, statePath } = await harness();
  const runId = "simulated-user-abort";
  await hooks.get("before_model_resolve")({ runId, prompt: highPrompt }, { ...ctx, runId });
  await hooks.get("before_agent_run")({ runId, senderIsOwner: true }, { ...ctx, runId });
  await hooks.get("model_call_ended")({ runId, resolvedRef: ASTRA, outcome: "error", failureKind: "aborted", errorCategory: "provider_unavailable", upstreamRequestIdHash: "sha256:test" }, { ...ctx, runId });
  await hooks.get("agent_end")({ runId, success: false, durationMs: 1 }, { ...ctx, runId });
  assert.equal(readStopState(statePath).stopped, false);
});

test("genuine Astra unavailable after HIGH selection is fail-closed STOP", async () => {
  const { hooks, statePath } = await harness();
  const runId = "genuine-astra-unavailable";
  await hooks.get("before_model_resolve")({ runId, prompt: highPrompt }, { ...ctx, runId });
  await hooks.get("before_agent_run")({ runId, senderIsOwner: true }, { ...ctx, runId });
  await hooks.get("model_call_ended")({ runId, resolvedRef: ASTRA, outcome: "error", errorCategory: "provider_unavailable" }, { ...ctx, runId });
  const state = readStopState(statePath);
  assert.equal(state.stopped, true);
  assert.equal(state.trigger, "high_risk_senior_model_unavailable");
  assert.equal(state.evidence, "provider:provider_unavailable");
});

// This suite exercises plugin hooks only. The separate canonical orchestrator bridge
// is required to prove that handled replies prevent runtime/model submission.
test("normal selects Sol without override and audits matching effective model", async () => {
  const { hooks, dir } = await harness();
  const runId = "normal";
  const context = { ...ctx, runId };
  assert.equal(await hooks.get("before_agent_reply")({ cleanedBody: "Hello" }, context), undefined);
  assert.equal(await hooks.get("before_model_resolve")({ prompt: "Hello" }, context), undefined);
  await hooks.get("llm_output")({ resolvedRef: "openai/gpt-5.6-sol" }, context);
  await hooks.get("agent_end")({ success: true }, context);
  const record = JSON.parse(fs.readFileSync(path.join(dir, "audit.jsonl"), "utf8").trim());
  assert.equal(record.selected_model, record.effective_model);
  assert.equal(record.fallback, false);
  assert.equal(record.result, "PASS");
});

for (const senderIsOwner of [false, undefined]) {
  test(`owner binding does not authorize subsequent ${senderIsOwner} in same session`, async () => {
    const { hooks, ownerStorePath, statePath } = await harness();
    await hooks.get("before_model_resolve")({ prompt: "Hello" }, { ...ctx, runId: "owner-first" });
    assert.equal(JSON.parse(fs.readFileSync(ownerStorePath, "utf8")).owners.length, 1);
    writeStopState(statePath, "high_risk_senior_model_unavailable");
    const blocked = await hooks.get("before_agent_reply")({ cleanedBody: highPrompt, senderIsOwner: true }, { ...ctx, runId: "untrusted-next", senderIsOwner });
    assert.equal(blocked.handled, true);
    assert.match(blocked.reply.text, /router_stopped_emergency_high_risk/);
  });
}

for (const senderIsOwner of [false, undefined]) {
  test(`event true cannot create binding when context is ${senderIsOwner}`, async () => {
    const { hooks, ownerStorePath } = await harness();
    const context = { ...ctx, runId: "event-spoof", senderIsOwner };
    await hooks.get("before_model_resolve")({ prompt: "Hello", senderIsOwner: true }, context);
    await hooks.get("before_agent_run")({ senderIsOwner: true }, context);
    assert.equal(fs.existsSync(ownerStorePath), false);
  });
}

for (const errorCategory of ["tool_error", "message_delivery_failed", "finalization_failed"]) {
  test(`${errorCategory} cannot cause senior-unavailable STOP`, async () => {
    const { hooks, statePath } = await harness();
    const context = { ...ctx, runId: errorCategory };
    await hooks.get("before_model_resolve")({ prompt: highPrompt }, context);
    await hooks.get("model_call_ended")({ resolvedRef: ASTRA, outcome: "error", errorCategory }, context);
    await hooks.get("agent_end")({ success: false }, context);
    assert.equal(readStopState(statePath).stopped, false);
  });
}

test("selected Astra receiving Sol triggers silent fallback STOP", async () => {
  const { hooks, statePath } = await harness();
  const context = { ...ctx, runId: "fallback" };
  await hooks.get("before_model_resolve")({ prompt: highPrompt }, context);
  await hooks.get("llm_output")({ resolvedRef: "openai/gpt-5.6-sol" }, context);
  assert.equal(readStopState(statePath).trigger, "silent_fallback");
});

for (const senderIsOwner of [false, undefined]) {
  test(`healthy non-owner emergency requires current authority ${senderIsOwner}`, async () => {
    const { hooks, statePath } = await harness();
    const context = { ...ctx, runId: "healthy-emergency", senderIsOwner };
    assert.equal(readStopState(statePath).stopped, false);
    const blocked = await hooks.get("before_agent_reply")({ cleanedBody: highPrompt }, context);
    assert.equal(blocked.handled, true);
    assert.match(blocked.reply.text, /owner_authority_required/);
    assert.equal(await hooks.get("before_model_resolve")({ prompt: highPrompt }, context), undefined);
    const late = await hooks.get("before_agent_run")({}, context);
    assert.equal(late.outcome, "block");
    assert.equal(late.reason, "owner_authority_required");
  });
}

test("submission gate rejects locked model without same-run selection", async () => {
  const { hooks, statePath } = await harness();
  const result = await hooks.get("before_agent_run")({ prompt: "Hello" }, { ...ctx, runId: "locked" });
  assert.equal(result.reason, "routing_selection_missing");
  assert.equal(readStopState(statePath).stopped, false);
});

test("submission gate does not reuse prior same-session selection", async () => {
  const { hooks } = await harness();
  await hooks.get("before_model_resolve")({ prompt: highPrompt }, { ...ctx, runId: "prior-owner" });
  const result = await hooks.get("before_agent_run")({ prompt: "Hello" }, { ...ctx, runId: "next-owner" });
  assert.equal(result.reason, "routing_selection_missing");
});

test("late owner false cannot reuse an owner selection or event true", async () => {
  const { hooks, statePath } = await harness();
  const context = { ...ctx, runId: "late-authority" };
  await hooks.get("before_model_resolve")({ prompt: highPrompt }, context);
  writeStopState(statePath, "high_risk_senior_model_unavailable");
  const result = await hooks.get("before_agent_run")({ prompt: highPrompt, senderIsOwner: true }, { ...context, senderIsOwner: false });
  assert.equal(result.reason, "router_stopped_emergency_high_risk");
});

for (const senderIsOwner of [false, undefined]) {
  test(`submission gate independently rejects emergency authority ${senderIsOwner}`, async () => {
    const { hooks } = await harness();
    const result = await hooks.get("before_agent_run")({ prompt: highPrompt, senderIsOwner: true }, { ...ctx, runId: "untrusted-gate", senderIsOwner });
    assert.equal(result.reason, "owner_authority_required");
  });
}

for (const route of [{ modelProviderId: undefined }, { modelId: undefined }]) {
  test(`submission unknown route blocks without false unavailability ${JSON.stringify(route)}`, async () => {
    const { hooks, statePath } = await harness();
    const context = { ...ctx, runId: "unknown-route" };
    await hooks.get("before_model_resolve")({ prompt: highPrompt }, context);
    const result = await hooks.get("before_agent_run")({ prompt: highPrompt }, { ...context, ...route });
    assert.equal(result.reason, "routing_effective_model_unknown");
    assert.equal(readStopState(statePath).stopped, false);
  });
}

test("submission mismatch blocks and records silent fallback, not unavailability", async () => {
  const { hooks, statePath } = await harness();
  const context = { ...ctx, runId: "pre-submit-fallback" };
  await hooks.get("before_model_resolve")({ prompt: highPrompt }, context);
  const result = await hooks.get("before_agent_run")({ prompt: highPrompt }, { ...context, modelId: "gpt-5.6-sol" });
  assert.equal(result.reason, "silent_fallback");
  assert.equal(readStopState(statePath).trigger, "silent_fallback");
});

test("submission current-owner matching selection passes", async () => {
  const { hooks } = await harness();
  const context = { ...ctx, runId: "matched-gate" };
  await hooks.get("before_model_resolve")({ prompt: highPrompt }, context);
  assert.equal(await hooks.get("before_agent_run")({ prompt: highPrompt }, context), undefined);
});
