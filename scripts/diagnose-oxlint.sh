#!/usr/bin/env bash
set -uo pipefail
helper_dir=$(cd "$(dirname "$0")" && pwd)
out=$(realpath ../owner-receipts)
mkdir -p "$out"
start=$(date +%s)
child= sampler= logger=
received=NONE
record_signal() {
  received=$1
  printf '%s signal=%s target=%s\n' "$(date -u +%FT%TZ)" "$received" "${child:-none}" | tee -a "$out/signals.log"
  if [[ -n "$child" ]]; then kill -s "$received" "$child" 2>/dev/null || true; fi
  exit "$2"
}
finish() {
  code=$?
  trap - EXIT
  [[ -z "$sampler" ]] || kill "$sampler" 2>/dev/null || true
  [[ -z "$logger" ]] || kill "$logger" 2>/dev/null || true
  printf '%s EXIT=%s received=%s\n' "$(date -u +%FT%TZ)" "$code" "$received" | tee -a "$out/signals.log"
  printf '%s\n' "$code" > "$out/diagnostic.exit"
  python3 - "$out" "$start" "$code" "$received" <<'PY'
import json,os,pathlib,sys,time
out=pathlib.Path(sys.argv[1]); samples=[]
if (out/'resources.jsonl').exists():
    for line in (out/'resources.jsonl').read_text().splitlines():
        try: samples.append(json.loads(line))
        except ValueError: pass
code=int(sys.argv[3])
r=dict(candidate='88a818f49858753eecb02a28623c4d8fb574a939', upstream='3a9d69db306cd7f081e06254cb89c4bcc14a7107',workflow_commit=os.environ.get('GITHUB_SHA'),run_id=os.environ.get('GITHUB_RUN_ID'),attempt=os.environ.get('GITHUB_RUN_ATTEMPT'),command=['node','--import','./scripts/tsx.mjs','scripts/run-oxlint-shards.mts','--only=core'],duration_seconds=time.time()-int(sys.argv[2]),exit=code,shell_received_signal=sys.argv[4],sample_interval_seconds=5,sample_count=len(samples),peak_sampled_process_tree_rss_kib=max((s['process_tree_rss_kib'] for s in samples),default=None),min_free_ram_kib=min((s['mem_free_kib'] for s in samples),default=None),min_available_ram_kib=min((s['mem_available_kib'] for s in samples),default=None),result='PASS' if code==0 else 'INTERRUPTED_UNKNOWN' if code in [130,137,143] else 'NONZERO_REQUIRES_LOG_AUDIT',production='NOT DEPLOYED')
(out/'diagnostic-terminal.json').write_text(json.dumps(r,indent=2)+'\n'); print(json.dumps(r),flush=True)
PY
  exit "$code"
}
trap 'record_signal SIGTERM 143' TERM
trap 'record_signal SIGINT 130' INT
trap finish EXIT
printf '%s\n' 'node --import ./scripts/tsx.mjs scripts/run-oxlint-shards.mts --only=core' | tee "$out/command.txt"
node --import ./scripts/tsx.mjs scripts/run-oxlint-shards.mts --only=core > "$out/oxlint.log" 2>&1 &
child=$!
python3 -u "$helper_dir/sample-lint-resources.py" "$child" "$out/resources.jsonl" &
sampler=$!
tail --pid="$child" -n +1 -f "$out/oxlint.log" &
logger=$!
wait "$child"
code=$?
wait "$logger" || true
logger=
exit "$code"
