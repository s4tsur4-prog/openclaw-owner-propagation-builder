import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearStopState, emptyMetrics, isEmergencyHighRisk, readStopState, sanitizeTaskId, updateMetrics, writeStopState } from "../pilot.js";

test("task ids are sanitized deterministically without retaining source", () => {
  const source = "agent:main:telegram:direct:1000000001";
  const value = sanitizeTaskId(source);
  assert.match(value, /^sha256:[a-f0-9]{24}$/);
  assert.equal(value.includes("1000000001"), false);
  assert.equal(value, sanitizeTaskId(source));
});

test("emergency guard identifies high-risk mutations but not routine conversation", () => {
  assert.equal(isEmergencyHighRisk("Ubah schema database production"), true);
  assert.equal(isEmergencyHighRisk("Apa arti istilah database?"), false);
  assert.equal(isEmergencyHighRisk("Ringkas percakapan ini"), false);
});

test("pilot metrics aggregate routes, forced Astra, fallback, latency and errors", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "router-pilot-"));
  const file = path.join(dir, "metrics.json");
  updateMetrics(file, { decision: "SOL_NO_OVERRIDE", routing_reason: "forced SOL", fallback: false, result: "PASS", latency_ms: 100 });
  const metrics = updateMetrics(file, { decision: "ASTRA_OVERRIDE", routing_reason: "forced ASTRA: high risk", fallback: true, result: "FAIL", latency_ms: 300 });
  assert.deepEqual({
    total: metrics.total_routed_turns,
    sol: metrics.sol_count,
    astra: metrics.astra_count,
    astraPercentage: metrics.astra_percentage,
    forcedAstra: metrics.forced_astra_count,
    fallback: metrics.fallback_count,
    solLatency: metrics.average_latency_sol_ms,
    astraLatency: metrics.average_latency_astra_ms,
    errors: metrics.routing_errors,
    falsePositive: metrics.false_positive_count,
    falseNegative: metrics.false_negative_count
  }, { total: 2, sol: 1, astra: 1, astraPercentage: 50, forcedAstra: 1, fallback: 1, solLatency: 100, astraLatency: 300, errors: 1, falsePositive: 0, falseNegative: 0 });
});

test("empty metrics initializes correction categories", () => {
  const metrics = emptyMetrics();
  assert.equal(metrics.wrong_route_corrections, 0);
  assert.equal(metrics.false_positive_count, 0);
  assert.equal(metrics.false_negative_count, 0);
});

test("a recovered silent fallback can clear the persistent stop state", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "router-stop-state-"));
  const file = path.join(dir, "state.json");
  writeStopState(file, "silent_fallback", { task_session_id: "sha256:test" });
  assert.equal(readStopState(file).stopped, true);
  clearStopState(file, { trigger: "silent_fallback_recovered", task_session_id: "sha256:test" });
  const recovered = readStopState(file);
  assert.equal(recovered.stopped, false);
  assert.equal(recovered.trigger, "silent_fallback_recovered");
});
