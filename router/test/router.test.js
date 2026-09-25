import test from "node:test";
import assert from "node:assert/strict";
import { classifyTask, verifyEffectiveModel } from "../router.js";

const cases = [
  ["simple", "Balas hanya: ROUTER SIMPLE OK", "SOL"],
  ["status", "Tampilkan status Gateway.", "SOL"],
  ["simple db", "Berapa jumlah customer aktif?", "SOL"],
  ["debugging", "Analisis root cause migration PostgreSQL gagal dan buat recovery plan.", "ASTRA"],
  ["architecture", "Desain workflow lintas SDC, Intersys, n8n, dan ERP.", "ASTRA"],
  ["high risk", "Ubah schema database production.", "ASTRA"],
  ["ambiguous low risk", "Bantu cek kenapa data ini terlihat aneh.", "SOL"],
  ["database keyword false positive", "Apa arti istilah database?", "SOL"],
  ["high complexity without technical keywords", "Bandingkan beberapa aturan yang saling bertentangan, tentukan prioritasnya, jelaskan risiko keputusan, lalu buat rencana implementasi dengan rollback.", "ASTRA"]
];

for (const [name, prompt, expected] of cases) {
  test(name, () => assert.equal(classifyTask(prompt).target, expected));
}

test("effective model exact match passes", () => {
  assert.deepEqual(verifyEffectiveModel("openai/gpt-6-astra", "openai/gpt-6-astra"), { match: true, fallback: false, result: "PASS" });
});

test("silent fallback fails", () => {
  assert.deepEqual(verifyEffectiveModel("openai/gpt-6-astra", "openai/gpt-5.6-sol"), { match: false, fallback: true, result: "FAIL" });
});
