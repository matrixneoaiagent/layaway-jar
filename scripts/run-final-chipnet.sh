#!/usr/bin/env bash
# Final post-kickoff Chipnet run for the Layaway Jar submission.
# Run only after the BCH Blaze kickoff (2026-11-14T14:00Z). Testnet only.
#
# Usage: bash scripts/run-final-chipnet.sh
# Outputs: artifacts/final-run-summary.json + per-step logs in artifacts/final-run/
set -euo pipefail
export PATH=/home/kozak/.local/bin:$PATH
cd "$(dirname "$0")/.."
export XO_WALLET="${XO_WALLET:-/tmp/opencode/xo_bounty/work_chipnet_wallet.json}"
export XO_DB_PATH="${XO_DB_PATH:-$PWD/.xo-data}"
export BROADCAST=1

OUT="$PWD/artifacts/final-run"
mkdir -p "$OUT"

parse() { # file key
  grep -E "^$2 " "$1" | tail -1 | awk '{print $2}'
}

echo "=== [$(date -u +%FT%TZ)] create jar A ==="
INITIAL_SATS=2000 TARGET_SATS=10000 ./node_modules/.bin/tsx scripts/create.ts | tee "$OUT/1-create-a.log"
A_TX=$(parse "$OUT/1-create-a.log" BROADCAST_TXID)
A_ID=$(parse "$OUT/1-create-a.log" JAR_ID)
A_SAVER=$(parse "$OUT/1-create-a.log" SAVER_SCRIPT)
A_MERCHANT=$(parse "$OUT/1-create-a.log" MERCHANT_SCRIPT)
[ -n "$A_TX" ] && [ -n "$A_ID" ] || { echo "create A failed"; exit 2; }

echo "=== [$(date -u +%FT%TZ)] deposit jar A ==="
JAR_TXID="$A_TX" JAR_VOUT=0 JAR_ID="$A_ID" JAR_SATS=2000 DEPOSIT_SATS=11000 \
  TARGET_SATS=10000 SAVER_SCRIPT="$A_SAVER" MERCHANT_SCRIPT="$A_MERCHANT" \
  ./node_modules/.bin/tsx scripts/deposit.ts | tee "$OUT/2-deposit-a.log"
A_DEP_TX=$(parse "$OUT/2-deposit-a.log" BROADCAST_TXID)
A_NEW_SATS=$(parse "$OUT/2-deposit-a.log" NEW_JAR_SATS)
[ -n "$A_DEP_TX" ] && [ -n "$A_NEW_SATS" ] || { echo "deposit A failed"; exit 2; }

echo "=== [$(date -u +%FT%TZ)] release jar A ==="
JAR_TXID="$A_DEP_TX" JAR_VOUT=0 JAR_ID="$A_ID" JAR_SATS="$A_NEW_SATS" \
  TARGET_SATS=10000 SAVER_SCRIPT="$A_SAVER" MERCHANT_SCRIPT="$A_MERCHANT" \
  ./node_modules/.bin/tsx scripts/release.ts | tee "$OUT/3-release-a.log"
A_REL_TX=$(parse "$OUT/3-release-a.log" BROADCAST_TXID)
[ -n "$A_REL_TX" ] || { echo "release A failed"; exit 2; }

echo "=== [$(date -u +%FT%TZ)] create jar B ==="
INITIAL_SATS=5000 TARGET_SATS=10000 ./node_modules/.bin/tsx scripts/create.ts | tee "$OUT/4-create-b.log"
B_TX=$(parse "$OUT/4-create-b.log" BROADCAST_TXID)
B_ID=$(parse "$OUT/4-create-b.log" JAR_ID)
B_SAVER=$(parse "$OUT/4-create-b.log" SAVER_SCRIPT)
B_MERCHANT=$(parse "$OUT/4-create-b.log" MERCHANT_SCRIPT)
[ -n "$B_TX" ] && [ -n "$B_ID" ] || { echo "create B failed"; exit 2; }

echo "=== [$(date -u +%FT%TZ)] refund jar B ==="
JAR_TXID="$B_TX" JAR_VOUT=0 JAR_ID="$B_ID" JAR_SATS=5000 TARGET_SATS=10000 \
  SAVER_SCRIPT="$B_SAVER" MERCHANT_SCRIPT="$B_MERCHANT" \
  ./node_modules/.bin/tsx scripts/refund.ts | tee "$OUT/5-refund-b.log"
B_REF_TX=$(parse "$OUT/5-refund-b.log" BROADCAST_TXID)
[ -n "$B_REF_TX" ] || { echo "refund B failed"; exit 2; }

python3 - "$OUT/final-run-summary.json" "$A_TX" "$A_DEP_TX" "$A_REL_TX" "$B_TX" "$B_REF_TX" "$A_ID" <<'PY'
import json, sys, datetime
path, a, d, r, b, br, aid = sys.argv[1:]
data = {
  "generatedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "network": "chipnet",
  "templateId": "bc076569ef069e2141b74f21382d50c7ba552ef8182d0076b4ded899c0089a6e",
  "jarA": {"jarId": aid, "createTxid": a, "depositTxid": d, "releaseTxid": r},
  "jarB": {"createTxid": b, "refundTxid": br},
}
open(path, "w").write(json.dumps(data, indent=1) + "\n")
print(json.dumps(data, indent=1))
PY

echo "=== DONE $(date -u +%FT%TZ) ==="
cat "$OUT/final-run-summary.json"
