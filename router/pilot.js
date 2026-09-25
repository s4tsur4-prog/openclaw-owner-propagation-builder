import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function sanitizeTaskId(value) {
  if (!value) return null;
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24)}`;
}

export function isEmergencyHighRisk(prompt) {
  const text = String(prompt ?? "").normalize("NFKC").toLowerCase();
  const highRiskObject = /\b(production|produksi|prod|database|schema|skema|credential|oauth|authentication|permission|firewall|deployment|migrasi|migration|recovery|restore)\b/.test(text);
  const mutationOrIncident = /\b(ubah|change|alter|delete|drop|hapus|write|mutasi|migrate|migrasi|deploy|rotate|revoke|recover|recovery|restore|gagal|failure|incident)\b/.test(text);
  return highRiskObject && mutationOrIncident;
}

const NON_AVAILABILITY_FAILURE_KINDS = new Set([
  "aborted",
  "cancelled",
  "terminated"
]);

const EXPLICIT_UNAVAILABLE_CATEGORIES = new Set([
  "authentication",
  "authorization",
  "billing",
  "capacity",
  "connection_closed",
  "connection_refused",
  "connection_reset",
  "dns",
  "entitlement",
  "model_not_found",
  "provider_unavailable",
  "rate_limit",
  "service_unavailable",
  "timeout"
]);

export function classifySeniorModelFailure(event, selectedModel) {
  const effectiveModel = event?.resolvedRef || (event?.provider && event?.model ? `${event.provider}/${event.model}` : null);
  if (!selectedModel || effectiveModel !== selectedModel || event?.outcome !== "error") {
    return { unavailable: false, reason: "not_selected_senior_model_error" };
  }

  const failureKind = String(event?.failureKind ?? "").trim().toLowerCase();
  const errorCategory = String(event?.errorCategory ?? "").trim().toLowerCase();
  if (NON_AVAILABILITY_FAILURE_KINDS.has(failureKind)) {
    return { unavailable: false, reason: `interruption:${failureKind}` };
  }
  if (failureKind === "timeout" || failureKind === "connection_closed" || failureKind === "connection_reset") {
    return { unavailable: true, reason: `transport:${failureKind}` };
  }
  if (EXPLICIT_UNAVAILABLE_CATEGORIES.has(errorCategory)) {
    return { unavailable: true, reason: `provider:${errorCategory}` };
  }
  return { unavailable: false, reason: "generic_or_unproven_model_failure" };
}

export function emptyMetrics() {
  return {
    total_routed_turns: 0,
    sol_count: 0,
    astra_count: 0,
    astra_percentage: 0,
    forced_astra_count: 0,
    score_triggered_astra_count: 0,
    fallback_count: 0,
    wrong_route_corrections: 0,
    false_positive_count: 0,
    false_negative_count: 0,
    average_latency_sol_ms: null,
    average_latency_astra_ms: null,
    routing_errors: 0,
    _latency_sol_total_ms: 0,
    _latency_sol_samples: 0,
    _latency_astra_total_ms: 0,
    _latency_astra_samples: 0
  };
}

function writePrivateJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

export function updateMetrics(filePath, decision) {
  let metrics = emptyMetrics();
  try {
    metrics = { ...metrics, ...JSON.parse(fs.readFileSync(filePath, "utf8")) };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  metrics.total_routed_turns += 1;
  const astra = decision.decision === "ASTRA_OVERRIDE";
  if (astra) {
    metrics.astra_count += 1;
    if (String(decision.routing_reason).startsWith("forced ASTRA:")) metrics.forced_astra_count += 1;
    else metrics.score_triggered_astra_count += 1;
  } else {
    metrics.sol_count += 1;
  }
  if (decision.fallback) metrics.fallback_count += 1;
  if (decision.result !== "PASS") metrics.routing_errors += 1;
  if (Number.isFinite(decision.latency_ms)) {
    const stem = astra ? "astra" : "sol";
    metrics[`_latency_${stem}_total_ms`] += decision.latency_ms;
    metrics[`_latency_${stem}_samples`] += 1;
    metrics[`average_latency_${stem}_ms`] = Math.round(metrics[`_latency_${stem}_total_ms`] / metrics[`_latency_${stem}_samples`]);
  }
  metrics.astra_percentage = metrics.total_routed_turns === 0 ? 0 : Number((metrics.astra_count * 100 / metrics.total_routed_turns).toFixed(2));
  writePrivateJson(filePath, metrics);
  return metrics;
}

export function writeStopState(filePath, trigger, details = {}) {
  const state = { stopped: true, timestamp: new Date().toISOString(), trigger, ...details };
  writePrivateJson(filePath, state);
  return state;
}

export function readStopState(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { stopped: false };
    throw error;
  }
}

export function clearStopState(filePath, details = {}) {
  const state = { stopped: false, timestamp: new Date().toISOString(), ...details };
  writePrivateJson(filePath, state);
  return state;
}
