import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyLocalRiskDecision } from "../decision.js";
import { isTrustedOwner, recordTrustedOwner } from "../owner.js";
import {
  classifySeniorModelFailure,
  clearStopState,
  readStopState,
  writeStopState,
} from "../pilot.js";
import { verifyEffectiveModel } from "../router.js";

const ASTRA = "openai/gpt-6-astra";
const ctx = { channel: "telegram", accountId: "default", senderId: "1000000001" };

function modelError(overrides = {}) {
  return { resolvedRef: ASTRA, outcome: "error", ...overrides };
}

test("HIGH + genuine Astra unavailable is explicit STOP evidence", () => {
  assert.deepEqual(
    classifySeniorModelFailure(modelError({ errorCategory: "provider_unavailable" }), ASTRA),
    {
      unavailable: true,
      reason: "provider:provider_unavailable",
    },
  );
});

test("HIGH + user/caller abort is not unavailable", () => {
  assert.equal(
    classifySeniorModelFailure(modelError({ failureKind: "aborted" }), ASTRA).unavailable,
    false,
  );
});

test("HIGH + gateway/recovery interruption is not unavailable", () => {
  assert.equal(
    classifySeniorModelFailure(modelError({ failureKind: "terminated" }), ASTRA).unavailable,
    false,
  );
});

test("HIGH + tool failure does not become model-unavailable evidence", () => {
  assert.equal(
    classifySeniorModelFailure({ outcome: "completed", errorCategory: "tool_result_error" }, ASTRA)
      .unavailable,
    false,
  );
  for (const errorCategory of [
    "tool_error",
    "message_delivery_failed",
    "finalization_failed",
    "agent_failed",
  ]) {
    const evidence = classifySeniorModelFailure(
      modelError({ errorCategory, upstreamRequestIdHash: "sha256:test" }),
      ASTRA,
    );
    assert.equal(
      evidence.unavailable,
      false,
      `${errorCategory} must not STOP even with an upstream request id`,
    );
  }
});

test("generic agent failure and wrong-model errors are not unavailable", () => {
  assert.equal(
    classifySeniorModelFailure(modelError({ errorCategory: "Error" }), ASTRA).unavailable,
    false,
  );
  assert.equal(
    classifySeniorModelFailure(
      {
        resolvedRef: "openai/gpt-5.6-sol",
        outcome: "error",
        errorCategory: "provider_unavailable",
      },
      ASTRA,
    ).unavailable,
    false,
  );
});

test("LOW risk failure does not meet HIGH-only stop precondition", () => {
  const evidence = classifySeniorModelFailure(
    modelError({ errorCategory: "provider_unavailable" }),
    ASTRA,
  );
  const decision = { decision: "ASTRA_OVERRIDE", risk_level: "LOW" };
  assert.equal(evidence.unavailable && decision.risk_level === "HIGH", false);
});

test("verified owner normal and HIGH are allowed", () => {
  const normal = applyLocalRiskDecision({
    classification: { riskLevel: "LOW" },
    verifiedOwner: true,
    existingFailClosed: false,
  });
  const high = applyLocalRiskDecision({
    classification: { riskLevel: "HIGH" },
    verifiedOwner: true,
    existingFailClosed: true,
  });
  assert.equal(normal.outcome, "ALLOW");
  assert.equal(high.outcome, "ALLOW");
});

test("stored binding cannot authorize restart/recovery or names", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "router-owner-"));
  const store = path.join(dir, "owners.json");
  assert.equal(
    recordTrustedOwner(store, { ...ctx, senderIsOwner: true }, { senderIsOwner: true }),
    true,
  );
  assert.equal(isTrustedOwner(store, ctx, {}), false);
  assert.equal(
    isTrustedOwner(store, { ...ctx, senderId: "attacker", username: "synthetic-name" }, {}),
    false,
  );
});

test("trusted owner binds transport independently of conversation channelId", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "router-owner-live-context-"));
  const store = path.join(dir, "owners.json");
  const liveCtx = {
    senderIsOwner: true,
    channelId: "conversation-fixture",
    messageProvider: "telegram",
    accountId: "default",
    senderId: "1000000001",
  };
  const liveEvent = { senderIsOwner: true, accountId: "default", senderId: "1000000001" };
  assert.equal(recordTrustedOwner(store, liveCtx, liveEvent), true);
  assert.equal(
    isTrustedOwner(store, liveCtx, { accountId: "default", senderId: "1000000001" }),
    true,
  );
});

test("inbound authoritative owner fields form the same immutable binding used after restart", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "router-owner-ingress-"));
  const store = path.join(dir, "owners.json");
  const inboundCtx = {
    senderIsOwner: true,
    channel: "telegram",
    channelId: "telegram",
    accountId: "default",
    senderId: "1000000001",
  };
  const inboundEvent = {
    channel: "telegram",
    accountId: "default",
    senderId: "1000000001",
    senderIsOwner: true,
  };
  assert.equal(recordTrustedOwner(store, inboundCtx, inboundEvent), true);
  assert.equal(
    isTrustedOwner(store, { ...inboundCtx, messageProvider: "telegram", channel: undefined }, {}),
    true,
  );
});

test("non-owner + genuine emergency + stopped remains fail-closed", () => {
  const result = applyLocalRiskDecision({
    classification: { riskLevel: "HIGH" },
    verifiedOwner: false,
    existingFailClosed: true,
  });
  assert.equal(result.outcome, "FAIL_CLOSED");
});

test("silent fallback detection remains active", () => {
  const fallback = verifyEffectiveModel(ASTRA, "openai/gpt-5.6-sol");
  const exact = verifyEffectiveModel(ASTRA, ASTRA);
  assert.equal(fallback.result, "FAIL");
  assert.equal(fallback.fallback, true);
  assert.equal(exact.result, "PASS");
  assert.equal(exact.fallback, false);
});

test("clear stop-state works", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "router-stop-"));
  const state = path.join(dir, "state.json");
  writeStopState(state, "high_risk_senior_model_unavailable");
  assert.equal(readStopState(state).stopped, true);
  clearStopState(state, { trigger: "operator_recovery" });
  assert.equal(readStopState(state).stopped, false);
});

test("selected and effective models are audited by exact canonical equality", () => {
  assert.equal(verifyEffectiveModel(ASTRA, ASTRA).result, "PASS");
  assert.equal(verifyEffectiveModel(ASTRA, "openai/gpt-5.6-sol").result, "FAIL");
});

for (const change of [{ channel: "discord" }, { accountId: "other" }, { senderId: "other" }]) {
  test(`stored binding never authorizes changed identity ${JSON.stringify(change)}`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "router-identity-"));
    const store = path.join(dir, "owners.json");
    assert.equal(recordTrustedOwner(store, { ...ctx, senderIsOwner: true }, {}), true);
    assert.equal(isTrustedOwner(store, { ...ctx, ...change, senderIsOwner: false }, {}), false);
    assert.equal(recordTrustedOwner(store, { ...ctx, ...change }, { senderIsOwner: true }), false);
    assert.equal(JSON.parse(fs.readFileSync(store, "utf8")).owners.length, 1);
  });
}
