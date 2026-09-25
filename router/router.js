const SYSTEM_NAMES = [
  "sdc", "intersys", "n8n", "erp", "postgresql", "postgres", "database",
  "gateway", "telegram", "oauth", "openai", "api", "worker", "queue"
];

function has(text, expression) {
  return expression.test(text);
}

function countSystems(text) {
  return new Set(SYSTEM_NAMES.filter((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(text))).size;
}

export function classifyTask(prompt) {
  const text = String(prompt ?? "").normalize("NFKC").toLowerCase();
  const factors = {
    coding_complexity: 0,
    reasoning_complexity: 0,
    system_risk: 0,
    ambiguity: 0,
    multi_system_scope: 0
  };
  const signals = [];

  const simpleStatus = has(text, /\b(status|health|versi|version|uptime)\b/) && !has(text, /\b(gagal|failure|error|recover|root[ -]?cause|ubah|deploy)\b/);
  const simpleLookup = has(text, /\b(berapa|jumlah|count|lookup|cari|tampilkan|show|list)\b/) && !has(text, /\b(analisis|mengapa|kenapa.*gagal|recovery|ubah|desain)\b/);
  const simpleRewrite = has(text, /\b(ringkas|summary|format|rewrite|parafrase|klasifikasi ringan|sop)\b/);
  const simpleAnswer = has(text, /\bbalas hanya\b/);
  const readOnly = has(text, /\b(read[ -]?only|hanya baca|tanpa perubahan)\b/);

  const codeBasic = has(text, /\b(code|coding|script|function|api|query|crud|sql)\b/);
  const engineering = has(text, /\b(migration|migrasi|schema|skema|deploy|deployment|debug|architecture|arsitektur|workflow|ocr|reconciliation|matching)\b/);
  const failureAnalysis = has(text, /\b(root[ -]?cause|akar masalah|analisis|debug|kenapa|mengapa)\b/) && has(text, /\b(gagal|failure|error|rusak|incident|masalah)\b/);
  const recovery = has(text, /\b(recovery|recover|pemulihan|rollback|restore)\b/);
  const design = has(text, /\b(desain|design|architecture|arsitektur|workflow|rancang)\b/);
  const constraintMarkers = [
    /\b(bertentangan|conflicting?|conflict)\b/,
    /\b(prioritas|prioriti[sz]e|priority)\b/,
    /\b(risiko|risk)\b/,
    /\b(implementasi|implementation)\b/,
    /\b(rollback|revert)\b/,
    /\b(bandingkan|compare|trade-?off)\b/
  ].filter((expression) => has(text, expression)).length;
  const manyConstraints = has(text, /\b(constraints?|aturan|rules?|syarat)\b/) && (
    (text.match(/[•\n;]|\b(dan|serta|tanpa|harus|jangan)\b/g) ?? []).length >= 4 ||
    constraintMarkers >= 4
  );
  const production = has(text, /\b(production|produksi|prod)\b/);
  const mutation = has(text, /\b(ubah|change|alter|delete|drop|hapus|write|mutasi|migrate|migrasi|deploy|rotate|revoke)\b/);
  const security = has(text, /\b(security|keamanan|authentication|auth|oauth|credential|permission|firewall|encryption)\b/) && mutation;
  const destructive = mutation && has(text, /\b(database|schema|skema|table|production|config|credential|permission|service)\b/);
  const crossRootCause = failureAnalysis && countSystems(text) >= 2;
  const complexSchema = has(text, /\b(schema|skema)\b/) && (design || has(text, /\b(complex|kompleks|migration|migrasi|production)\b/));
  const largeReconcile = has(text, /\b(reconciliation|rekonsiliasi|matching|pencocokan)\b/) && has(text, /\b(large|besar|massal|ribuan|jutaan|lintas)\b/);
  const complexOcr = has(text, /\bocr\b/) && has(text, /\b(reason|analisis|kompleks|multi|dokumen|rekonsiliasi)\b/);

  if (codeBasic) factors.coding_complexity = 1;
  if (engineering || design) factors.coding_complexity = Math.max(factors.coding_complexity, 2);
  if ((failureAnalysis && recovery) || complexSchema || (design && countSystems(text) >= 3)) factors.coding_complexity = 3;

  if (has(text, /\b(cek|check|kenapa|mengapa|analisis|review)\b/)) factors.reasoning_complexity = 1;
  if (failureAnalysis || design || has(text, /\b(plan|rencana|trade-?off|bandingkan)\b/)) factors.reasoning_complexity = 2;
  if ((failureAnalysis && recovery) || manyConstraints || (design && countSystems(text) >= 3)) factors.reasoning_complexity = 3;

  if (mutation || recovery || has(text, /\b(gagal|failure|incident|security|keamanan|auth)\b/)) factors.system_risk = 1;
  if (production || destructive || security || has(text, /\b(deployment failure|production recovery)\b/)) factors.system_risk = 3;
  else if (has(text, /\b(database migration|migrasi database|deploy|rollback|credential|permission)\b/)) factors.system_risk = 2;
  if (readOnly || simpleStatus || simpleLookup) factors.system_risk = Math.min(factors.system_risk, 1);

  const vague = has(text, /\b(data ini|ini terlihat|terlihat aneh|sesuatu|somehow|bantu cek|tolong cek)\b/) && !has(text, /\b(error|log|schema|migration|sistem|service|table|file)\b/);
  if (vague) factors.ambiguity = 2;
  else if (has(text, /\b(kira-kira|mungkin|tidak jelas|ambiguous|aneh)\b/)) factors.ambiguity = 1;

  const systemCount = countSystems(text);
  factors.multi_system_scope = systemCount >= 3 ? 2 : systemCount >= 2 ? 1 : 0;

  const forcedAstraReasons = [];
  if (has(text, /\b(database migration|migrasi database|migration postgresql|postgresql migration)\b/) && (failureAnalysis || recovery || production)) forcedAstraReasons.push("complex database migration");
  if (destructive && (production || factors.system_risk === 3)) forcedAstraReasons.push("risky destructive/write operation");
  if (production && recovery) forcedAstraReasons.push("production recovery");
  if (has(text, /\b(deployment|deploy)\b/) && has(text, /\b(gagal|failure|error|rollback|recovery)\b/)) forcedAstraReasons.push("deployment failure/recovery");
  if (crossRootCause) forcedAstraReasons.push("cross-system root-cause debugging");
  if (complexSchema) forcedAstraReasons.push("complex schema design/change");
  if (security) forcedAstraReasons.push("security/authentication change");
  if (largeReconcile) forcedAstraReasons.push("large-scale reconciliation/matching");
  if (design && systemCount >= 3) forcedAstraReasons.push("cross-subsystem architecture/workflow");
  if (complexOcr) forcedAstraReasons.push("complex OCR reasoning");
  if (manyConstraints) forcedAstraReasons.push("many simultaneous rules/constraints");

  const score = Object.values(factors).reduce((sum, value) => sum + value, 0);
  const riskLevel = factors.system_risk >= 3 ? "HIGH" : factors.system_risk >= 1 ? "MEDIUM" : "LOW";
  const forcedSol = (simpleStatus || simpleLookup || simpleRewrite || simpleAnswer || readOnly) && forcedAstraReasons.length === 0 && riskLevel !== "HIGH";

  let target = "SOL";
  let reason = "baseline score 0-3";
  let confidence = vague ? "low" : "high";
  if (forcedAstraReasons.length > 0) {
    target = "ASTRA";
    reason = `forced ASTRA: ${forcedAstraReasons.join(", ")}`;
  } else if (forcedSol) {
    target = "SOL";
    reason = "forced SOL: simple or read-only low-risk task";
  } else if (score >= 7) {
    target = "ASTRA";
    reason = "score >= 7";
  } else if (score >= 4) {
    const escalateLowConfidence = confidence === "low" && (factors.coding_complexity >= 2 || factors.system_risk >= 2 || factors.multi_system_scope >= 1);
    target = escalateLowConfidence ? "ASTRA" : "SOL";
    reason = escalateLowConfidence ? "score 4-6 with low confidence and material complexity" : "score 4-6; conservative Sol-first";
  }

  if (simpleStatus) signals.push("simple_status");
  if (simpleLookup) signals.push("simple_lookup");
  if (failureAnalysis) signals.push("failure_analysis");
  if (recovery) signals.push("recovery");
  if (production) signals.push("production");
  if (mutation) signals.push("mutation");
  if (design) signals.push("design");
  if (vague) signals.push("ambiguous_low_context");
  if (systemCount >= 2) signals.push(`systems:${systemCount}`);

  return { target, score, factors, reason, riskLevel, confidence, signals };
}

export function verifyEffectiveModel(selectedModel, effectiveModel) {
  const normalize = (value) => String(value ?? "").trim().toLowerCase();
  const selected = normalize(selectedModel);
  const effective = normalize(effectiveModel);
  const match = selected !== "" && selected === effective;
  return { match, fallback: effective !== "" && !match, result: match ? "PASS" : "FAIL" };
}
