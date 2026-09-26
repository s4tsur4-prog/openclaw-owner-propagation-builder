import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { isTrustedOwner, recordTrustedOwner } from "./owner.js";
import {
  clearStopState,
  classifySeniorModelFailure,
  isEmergencyHighRisk,
  readStopState,
  sanitizeTaskId,
  updateMetrics,
  writeStopState,
} from "./pilot.js";
import { classifyTask, verifyEffectiveModel } from "./router.js";

const DEFAULT_SOL = "openai/gpt-5.6-sol";
const DEFAULT_ASTRA = "openai/gpt-6-astra";
const BLOCKED_MODEL = "model-router-v1-blocked/high-risk-fail-closed";

function splitModel(ref) {
  const index = ref.indexOf("/");
  if (index < 1 || index === ref.length - 1) {
    throw new Error(`invalid canonical model ref: ${ref}`);
  }
  return { provider: ref.slice(0, index), model: ref.slice(index + 1) };
}

function defaultDataPath(filename) {
  const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
  return path.join(stateDir, "logs", filename);
}

function appendAudit(logPath, record) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 });
  fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
}

function auditRecord(decision) {
  return {
    timestamp: new Date().toISOString(),
    agent: decision.agent,
    task_session_id: decision.task_session_id,
    routing_score: decision.routing_score,
    routing_factors: decision.routing_factors,
    routing_reason: decision.routing_reason,
    risk_level: decision.risk_level,
    decision: decision.decision,
    selected_model: decision.selected_model,
    effective_model: decision.effective_model,
    fallback: decision.fallback,
    latency_ms: decision.latency_ms,
    result: decision.result,
  };
}

export default definePluginEntry({
  id: "model-router-v1",
  name: "Model Router V1",
  description: "Conservative, auditable Sol-to-Astra model selection",
  register(api) {
    const config = api.pluginConfig ?? {};
    const mode = config.mode === "live" ? "live" : "test-only";
    const agentIds = new Set(Array.isArray(config.agentIds) ? config.agentIds : ["main"]);
    const testSessionPrefixes = Array.isArray(config.testSessionPrefixes)
      ? config.testSessionPrefixes.filter(Boolean)
      : [];
    const solModel = config.solModel || DEFAULT_SOL;
    const astraModel = config.astraModel || DEFAULT_ASTRA;
    const logPath = config.logPath || defaultDataPath("model-router-v1.jsonl");
    const metricsPath = config.metricsPath || defaultDataPath("model-router-v1-metrics.json");
    const statePath = config.statePath || defaultDataPath("model-router-v1-state.json");
    const ownerStorePath = config.ownerStorePath || defaultDataPath("model-router-v1-owners.json");
    const decisions = new Map();
    const blockedTurns = new Map();

    const inScope = (ctx) => {
      if (!ctx?.agentId || !agentIds.has(ctx.agentId)) {
        return false;
      }
      if (mode === "live") {
        return true;
      }
      return Boolean(
        ctx.sessionKey && testSessionPrefixes.some((prefix) => ctx.sessionKey.startsWith(prefix)),
      );
    };
    const keyFor = (ctx, event) =>
      event?.runId || ctx?.runId || (ctx?.sessionKey ? `session:${ctx.sessionKey}` : undefined);
    const findDecision = (ctx, event) => {
      const candidates = [
        event?.runId,
        ctx?.runId,
        event?.sessionKey ? `session:${event.sessionKey}` : undefined,
        ctx?.sessionKey ? `session:${ctx.sessionKey}` : undefined,
      ].filter(Boolean);
      for (const key of candidates) {
        if (decisions.has(key)) {
          return decisions.get(key);
        }
      }
      return undefined;
    };
    // Never carry a block through a session key to a different run.
    const blockKeysFor = (ctx, event) => [ctx?.runId || event?.runId].filter(Boolean);
    const isVerifiedOwner = (ctx, event) => isTrustedOwner(ownerStorePath, ctx, event);

    const failClosed = (ctx, event, reason) => {
      const blocked = {
        reason,
        blocked_model: BLOCKED_MODEL,
        blocked_at: new Date().toISOString(),
      };
      for (const key of blockKeysFor(ctx, event)) {
        blockedTurns.set(key, blocked);
      }
      return undefined;
    };

    const takeBlocked = (ctx, event) => {
      const keys = blockKeysFor(ctx, event);
      let blocked;
      for (const key of keys) {
        if (!blocked && blockedTurns.has(key)) {
          blocked = blockedTurns.get(key);
        }
      }
      if (blocked) {
        for (const key of keys) {
          blockedTurns.delete(key);
        }
      }
      return blocked;
    };

    api.on(
      "before_agent_reply",
      (event, ctx) => {
        if (!inScope(ctx)) {
          return;
        }
        // This canonical gate precedes model resolution, including Codex submission.
        // Owner authority is turn-local: persisted bindings cannot bypass this check.
        if (isEmergencyHighRisk(event.cleanedBody) && !isVerifiedOwner(ctx, event)) {
          let reason = "owner_authority_required";
          try {
            if (readStopState(statePath).stopped) {
              reason = "router_stopped_emergency_high_risk";
            }
          } catch {
            reason = "router_failure_emergency_high_risk";
          }
          if (reason) {
            failClosed(ctx, event, reason);
          }
        }
        const blocked = takeBlocked(ctx, event);
        if (!blocked) {
          return;
        }

        return {
          handled: true,
          reply: {
            text: `Model Router V1 memblokir turn ini secara fail-closed (${blocked.reason}). Tidak ada request yang dikirim ke model.`,
          },
        };
      },
      {
        priority: 1000,
        registrationId: "model-router-v1-fail-closed-reply",
      },
    );

    api.on(
      "before_model_resolve",
      (event, ctx) => {
        if (!inScope(ctx)) {
          return;
        }
        const key = keyFor(ctx, event);
        const taskId = sanitizeTaskId(ctx.sessionKey || ctx.sessionId || ctx.runId);
        const verifiedOwner = isVerifiedOwner(ctx, event);
        if (verifiedOwner) {
          recordTrustedOwner(ownerStorePath, ctx, event);
        }
        let classification;
        try {
          const stopped = readStopState(statePath);
          classification = classifyTask(event.prompt);
          if (isEmergencyHighRisk(event.prompt) && !verifiedOwner) {
            return failClosed(
              ctx,
              event,
              stopped.stopped ? "router_stopped_emergency_high_risk" : "owner_authority_required",
            );
          }
          if (key && decisions.has(key)) {
            writeStopState(statePath, "routing_loop_or_duplicate_invocation", {
              task_session_id: taskId,
            });
            return classification.riskLevel === "HIGH" && !verifiedOwner
              ? failClosed(ctx, event, "routing_loop_or_duplicate_invocation")
              : undefined;
          }
        } catch {
          writeStopState(statePath, "router_failure", { task_session_id: taskId });
          const failed = {
            agent: ctx.agentId || null,
            task_session_id: taskId,
            routing_score: null,
            routing_factors: null,
            decision: "ROUTER_FAILURE",
            selected_model: isEmergencyHighRisk(event.prompt) ? BLOCKED_MODEL : solModel,
            effective_model: null,
            fallback: false,
            latency_ms: null,
            result: "FAIL",
          };
          appendAudit(logPath, auditRecord(failed));
          updateMetrics(metricsPath, failed);
          return isEmergencyHighRisk(event.prompt) && !verifiedOwner
            ? failClosed(ctx, event, "router_failure_emergency_high_risk")
            : undefined;
        }

        const selectedModel = classification.target === "ASTRA" ? astraModel : solModel;
        const decision = {
          agent: ctx.agentId || null,
          task_session_id: taskId,
          routing_score: classification.score,
          routing_factors: classification.factors,
          routing_reason: classification.reason,
          risk_level: classification.riskLevel,
          decision: classification.target === "ASTRA" ? "ASTRA_OVERRIDE" : "SOL_NO_OVERRIDE",
          selected_model: selectedModel,
          effective_model: null,
          fallback: false,
          latency_ms: null,
          result: "SELECTED",
        };
        if (key) {
          decisions.set(key, decision);
        }
        if (classification.target !== "ASTRA") {
          return;
        }
        const selected = splitModel(selectedModel);
        return { providerOverride: selected.provider, modelOverride: selected.model };
      },
      { priority: 100, registrationId: "model-router-v1-select", timeoutMs: 1000 },
    );

    api.on(
      "model_call_ended",
      (event, ctx) => {
        const decision = findDecision(ctx, event);
        if (!decision || decision.decision !== "ASTRA_OVERRIDE" || decision.risk_level !== "HIGH") {
          return;
        }
        const evidence = classifySeniorModelFailure(event, decision.selected_model);
        decision.senior_model_failure_evidence = evidence;
        if (evidence.unavailable) {
          writeStopState(statePath, "high_risk_senior_model_unavailable", {
            task_session_id: decision.task_session_id,
            evidence: evidence.reason,
          });
        }
      },
      { registrationId: "model-router-v1-model-call-outcome", timeoutMs: 1000 },
    );

    api.on(
      "llm_output",
      (event, ctx) => {
        const decision = findDecision(ctx, event);
        if (!decision) {
          return;
        }
        const effectiveModel = event.resolvedRef || `${event.provider}/${event.model}`;
        const verification = verifyEffectiveModel(decision.selected_model, effectiveModel);
        decision.effective_model = effectiveModel;
        decision.fallback = verification.fallback;
        decision.result = verification.result;
        if (verification.fallback) {
          writeStopState(statePath, "silent_fallback", {
            task_session_id: decision.task_session_id,
          });
        } else {
          const stopState = readStopState(statePath);
          if (
            stopState.stopped &&
            stopState.trigger === "silent_fallback" &&
            stopState.task_session_id === decision.task_session_id
          ) {
            clearStopState(statePath, {
              trigger: "silent_fallback_recovered",
              task_session_id: decision.task_session_id,
            });
          }
        }
      },
      { registrationId: "model-router-v1-effective", timeoutMs: 1000 },
    );

    api.on(
      "before_agent_finalize",
      (event, ctx) => {
        const decision = findDecision(ctx, event);
        if (!decision || !event.provider || !event.model) {
          return;
        }
        const effectiveModel = `${event.provider}/${event.model}`;
        const verification = verifyEffectiveModel(decision.selected_model, effectiveModel);
        decision.effective_model = effectiveModel;
        decision.fallback = verification.fallback;
        decision.result = verification.result;
        if (verification.fallback) {
          writeStopState(statePath, "silent_fallback", {
            task_session_id: decision.task_session_id,
          });
        } else {
          const stopState = readStopState(statePath);
          if (
            stopState.stopped &&
            stopState.trigger === "silent_fallback" &&
            stopState.task_session_id === decision.task_session_id
          ) {
            clearStopState(statePath, {
              trigger: "silent_fallback_recovered",
              task_session_id: decision.task_session_id,
            });
          }
        }
      },
      { registrationId: "model-router-v1-finalize-check", timeoutMs: 1000 },
    );

    api.on(
      "agent_end",
      (event, ctx) => {
        const decision = findDecision(ctx, event);
        if (!decision) {
          return;
        }
        decision.latency_ms = event.durationMs ?? null;
        if (decision.result === "SELECTED") {
          decision.result = event.success ? "UNVERIFIED" : "FAIL";
        }
        if (!event.success) {
          decision.result = "FAIL";
        }
        appendAudit(logPath, auditRecord(decision));
        updateMetrics(metricsPath, decision);
        const key = keyFor(ctx, event);
        if (key) {
          decisions.delete(key);
        }
      },
      { registrationId: "model-router-v1-final", timeoutMs: 1000 },
    );

    api.on(
      "before_agent_run",
      (event, ctx) => {
        if (!inScope(ctx)) {
          return;
        }
        // This submission gate must stand alone: locked selection may bypass routing,
        // and authority/state may change after the earlier reply/selection hooks.
        if (isEmergencyHighRisk(event.prompt) && !isVerifiedOwner(ctx, event)) {
          let reason = "owner_authority_required";
          try {
            if (readStopState(statePath).stopped) {
              reason = "router_stopped_emergency_high_risk";
            }
          } catch {
            reason = "router_failure_emergency_high_risk";
          }
          return { outcome: "block", reason };
        }
        const blocked = takeBlocked(ctx, event);
        if (blocked) {
          return { outcome: "block", reason: blocked.reason };
        }
        // Never use the session fallback here: only this exact run's selection counts.
        const decision = ctx?.runId ? decisions.get(ctx.runId) : undefined;
        if (!decision) {
          return { outcome: "block", reason: "routing_selection_missing" };
        }
        if (!ctx.modelProviderId || !ctx.modelId) {
          return { outcome: "block", reason: "routing_effective_model_unknown" };
        }
        const effectiveModel = `${ctx.modelProviderId}/${ctx.modelId}`;
        if (effectiveModel !== decision.selected_model) {
          decision.effective_model = effectiveModel;
          decision.fallback = true;
          decision.result = "FAIL";
          writeStopState(statePath, "silent_fallback", {
            task_session_id: decision.task_session_id,
          });
          return { outcome: "block", reason: "silent_fallback" };
        }
        recordTrustedOwner(ownerStorePath, ctx, event);
      },
      { priority: 1000, registrationId: "model-router-v1-owner-identity", timeoutMs: 1000 },
    );
  },
});
