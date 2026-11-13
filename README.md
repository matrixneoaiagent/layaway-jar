# Layaway Jar — XO template

A single-saver BCH savings jar with a fixed target and merchant. The saver puts
BCH into a P2SH32 covenant; once the jar holds the target, the saver can release
exactly the target to the merchant and keep the excess. At any time the saver can
refund the balance to themselves, with a covenant-capped miner fee.

Every path requires a Schnorr signature from the saver key. Every jar has a
random 32-byte `jarId` salt, so two jars with the same target and merchant still
compile to different addresses.

> **Chipnet only.** This repository contains no mainnet configuration. The
> included run scripts are dry-run by default and refuse to broadcast unless
> `BROADCAST=1` is set.

## Template identifier

```
bc076569ef069e2141b74f21382d50c7ba552ef8182d0076b4ded899c0089a6e
```

`parseTemplate` + `generateTemplateIdentifier` and `Engine.importTemplate`
produce the same identifier (verified; see `test/import.test.ts`). The identifier
is a content hash: changing the template object changes the id.

Serialized template: [`fixtures/layaway-jar.template.json`](fixtures/layaway-jar.template.json).

## Covenant

| Action | On-chain rule | Signature |
|--------|---------------|-----------|
| `createJar` | Creates the P2SH32 jar output holding `jarSatoshis`. | saver |
| `deposit` | Output 0 must reuse the **exact covenant bytecode** and hold a **strictly larger** value. | saver |
| `release` | Jar input must hold at least `targetSatoshis`; output 0 must pay the merchant script **exactly** `targetSatoshis`; the excess returns to the saver on output 1. | saver |
| `refund` | Output 0 must pay the saver script; the covenant caps the miner fee at **3,000 sats**. | saver |

The redeem script is:

```
<jarId> OP_DROP
OP_DUP OP_HASH160 <saverPublicKeyHash> OP_EQUALVERIFY OP_CHECKSIGVERIFY
if output0.bytecode == input.bytecode: output0.value > input.value
else if output0.bytecode == merchantScript: input.value >= target && output0.value == target
else: output0.bytecode == saverScript && output0.value >= input.value - 3000
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full state model and
threat model.

## Fee model

The prototype used fixed fees; this template uses an explicit `feeSatoshis`
variable plus a measured-vsize policy:

- documented minimum: **2,000 sats** (`minimumFeeSatoshis`);
- release must cover `target + fee + 546` sats;
- refund fee is capped on-chain at **3,000 sats** (inlined `<3000>`, mirrored by
  `maxRefundFeeSatoshis`);
- `scripts/lib/fee.ts` computes `vsize × satPerByte` (default 2 sat/B), clamps to
  the minimum, and the action scripts retry once with a higher fee if the
  measured transaction size needs it.

The final Chipnet run uses 2,000 sat fees (roughly 4–9 sat/B for these
transactions), so confirmation is prompt.

## Repository layout

```
source/
  index.ts            public exports
  layaway-jar.ts      the XO template (CashASM covenant)
  types.ts            state types, fee constants, refund/release guards
test/
  helpers/covenant.ts libauth VM harness (compiles the real CashASM)
  vm.test.ts          VM vectors for all four actions and failure cases
  template.test.ts    parse/serialize, required variables, negative refund
  import.test.ts      optional Engine.importTemplate agreement
fixtures/
  layaway-jar.template.json   serialized final template
  legacy/                     pre-kickoff prototype artifacts (old template)
scripts/
  lib/                config, engine, fee, spend, artifacts helpers
  serialize-template.ts
  create.ts deposit.ts release.ts refund.ts verify-tx.ts
docs/ARCHITECTURE.md
.github/workflows/ci.yml
```

## Quick start

Requirements: Node.js 22+, a Chipnet Electrum connection, and a funded Chipnet
wallet file. The default test wallet is
`/tmp/opencode/xo_bounty/work_chipnet_wallet.json` (mode 600, testnet only; the
mnemonic is never printed or committed).

```bash
export PATH=/home/kozak/.local/bin:$PATH
npm install            # or npm ci with the lockfile
npm run typecheck
npm test
npm run fixtures:template
```

If `npm` is not installed, the same checks run directly:

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/tsx --test test/*.test.ts
./node_modules/.bin/tsx scripts/serialize-template.ts
```

`npm test` runs the unit suite and skips the engine integration test. To run the
integration test (needs a Chipnet connection):

```bash
npm run test:integration
```

Observed locally: `tsc --noEmit` clean and **16/16 unit tests passing**
(`test/template.test.ts` + `test/vm.test.ts`); the gated import test passes with
`XO_INTEGRATION=1`.

## Commands

All scripts read the wallet from `XO_WALLET` (default:
`/tmp/opencode/xo_bounty/work_chipnet_wallet.json`) and use Chipnet. They archive
stale invitations first, so a dry run releases its UTXO reservations.

| Command | Purpose |
|---------|---------|
| `npm run fixtures:template` | Parse, validate, print the id, rewrite the fixture. |
| `npm run create` | Create a jar (`INITIAL_SATS`, `TARGET_SATS`, optional `JAR_ID`). |
| `npm run deposit` | Add `DEPOSIT_SATS` to a jar. |
| `npm run release` | Pay the target to the merchant. |
| `npm run refund` | Return the balance minus `FEE_SATS` to the saver. |

`scripts/verify-tx.ts` is imported by every action script; it builds the merged
transaction and runs libauth's BCH VM before any broadcast. There is no separate
`verify` command because verification is part of each action.

Common environment variables:

| Variable | Default | Meaning |
|----------|---------|---------|
| `BROADCAST` | unset | Set to `1` to broadcast; anything else is a dry run. |
| `XO_DB_PATH` | `./.xo-data` | Engine database directory. |
| `XO_DB_NAME` | engine default | Database filename prefix. |
| `INITIAL_SATS` | `2000` | Initial jar balance. |
| `TARGET_SATS` | `10000` | Release target. |
| `DEPOSIT_SATS` | `9500` | Deposit amount. |
| `FEE_SATS` | `2000` | Miner fee; clamped to the refund cap. |
| `SAT_PER_BYTE` | `2` | Fee coverage check. |
| `JAR_ID` | random | 32-byte hex salt (reuse to re-create the same address). |
| `SAVER_SCRIPT` / `MERCHANT_SCRIPT` | wallet receive policy | Locking scripts (hex). |
| `JAR_TXID` / `JAR_VOUT` / `JAR_SATS` | — | Existing jar outpoint and balance. |

## Reproducing an invitation

Each action builds and signs a transaction, runs libauth's BCH VM on it, and
writes the serialized invitation with `serializeInvitation`:

```
artifacts/createJar-invitation.json
artifacts/deposit-invitation.json
artifacts/release-invitation.json
artifacts/refund-invitation.json
artifacts/jar.json          # jarId, txid, scripts, balances
```

`artifacts/` is gitignored because invitations are run-specific. No mnemonic,
private key or WIF is written to an invitation.

## Debug tool

1. Open <https://blaze.xo.cash>, create/use an account and select **Chipnet**.
2. **Import the template first**: **Import Template** → paste
   `fixtures/layaway-jar.template.json` → **Import JSON**. A toast confirms
   `Template imported: Layaway Jar (<template id>)`.
3. **Join Invitation** → paste an invitation JSON from `artifacts/` into the
   **Invitation JSON** box → **View invitation**. The preview shows the action,
   invitation id, signed commits and inputs; no error banner.
4. Do not click **Accept invitation** unless you intend to add your signature.

Invitations cannot be resolved before the matching template is imported. A
mismatched template produces:
`Template not found: import template "<id>" before joining this invitation.`
The debug tool is a viewer/signer; the covenant rules still apply on-chain.

**Verified on 2026-11-13** against the prototype template: both the `release`
and `deposit` invitations preview cleanly in the official tool. Screenshots:
`docs/debug-tool/prototype/` (template import success, release preview, deposit
preview, mismatched-template error). The final-template screenshots will be
added to `docs/debug-tool/final/` after the post-kickoff run.

## Post-kickoff final run

The sequence below was prepared but **not broadcast** before the 2026-11-14
14:00Z kickoff. It uses the funded Chipnet test wallet and the synced scratch
database that already tracks its UTXOs. The jar at `7c15d07d…:1` held 968,940
sats at preparation time.

If `/tmp/opencode/xo_bounty` is unavailable, omit `XO_DB_PATH`; the engine will
create `./.xo-data` and sync a fresh Chipnet database (slower, same commands).

```bash
cd /tmp/opencode/layaway-jar-repo
export PATH=/home/kozak/.local/bin:$PATH
export XO_DB_PATH=/tmp/opencode/xo_bounty          # synced Chipnet state DB
export XO_WALLET=/tmp/opencode/xo_bounty/work_chipnet_wallet.json

# 0. Sanity: typecheck, unit tests, template id.
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/tsx --test test/*.test.ts
./node_modules/.bin/tsx scripts/serialize-template.ts
# expect TEMPLATE_IDENTIFIER bc076569ef069e2141b74f21382d50c7ba552ef8182d0076b4ded899c0089a6e

# 1. Jar A: create with 2,000 sats toward a 10,000 sat target.
BROADCAST=1 INITIAL_SATS=2000 TARGET_SATS=10000 ./node_modules/.bin/tsx scripts/create.ts
# copy JAR_TXID, JAR_ID, SAVER_SCRIPT, MERCHANT_SCRIPT from the output
export JAR_A_TXID=<create-A-txid>
export JAR_A_ID=<create-A-jar-id>
export SAVER_SCRIPT=<create-A-saver-script>
export MERCHANT_SCRIPT=<create-A-merchant-script>

# 2. Deposit 11,000 sats: jar 2,000 -> 13,000.
BROADCAST=1 JAR_TXID=$JAR_A_TXID JAR_VOUT=0 JAR_ID=$JAR_A_ID \
  JAR_SATS=2000 DEPOSIT_SATS=11000 TARGET_SATS=10000 \
  SAVER_SCRIPT=$SAVER_SCRIPT MERCHANT_SCRIPT=$MERCHANT_SCRIPT ./node_modules/.bin/tsx scripts/deposit.ts
export JAR_A_DEPOSIT_TXID=<deposit-A-txid>

# 3. Release: 10,000 to the merchant, 1,000 back to the saver, 2,000 fee.
BROADCAST=1 JAR_TXID=$JAR_A_DEPOSIT_TXID JAR_VOUT=0 JAR_ID=$JAR_A_ID \
  JAR_SATS=13000 TARGET_SATS=10000 \
  SAVER_SCRIPT=$SAVER_SCRIPT MERCHANT_SCRIPT=$MERCHANT_SCRIPT ./node_modules/.bin/tsx scripts/release.ts

# 4. Jar B: create with 5,000 sats for the refund path.
BROADCAST=1 INITIAL_SATS=5000 TARGET_SATS=10000 ./node_modules/.bin/tsx scripts/create.ts
export JAR_B_TXID=<create-B-txid>
export JAR_B_ID=<create-B-jar-id>
export SAVER_SCRIPT_B=<create-B-saver-script>
export MERCHANT_SCRIPT_B=<create-B-merchant-script>

# 5. Refund: 3,000 back to the saver, 2,000 fee (below the 3,000 cap).
BROADCAST=1 JAR_TXID=$JAR_B_TXID JAR_VOUT=0 JAR_ID=$JAR_B_ID \
  JAR_SATS=5000 TARGET_SATS=10000 \
  SAVER_SCRIPT=$SAVER_SCRIPT_B MERCHANT_SCRIPT=$MERCHANT_SCRIPT_B ./node_modules/.bin/tsx scripts/refund.ts
```

Expected outputs:

| Step | Key output |
|------|------------|
| create A | `JAR_TXID <txid>`, `VM_OK`, `BROADCAST_TXID <same txid>` |
| deposit A | `jar output 13000`, `VM_OK`, `NEW_JAR_SATS 13000` |
| release A | `merchant gets 10000 saver gets 1000 fee 2000`, `VM_OK` |
| create B | `JAR_TXID <txid>`, `VM_OK` |
| refund B | `saver gets 3000 fee 2000`, `VM_OK` |

Record the five txids in the table below after broadcasting. Explorer:
`https://chipnet.imaginary.cash/tx/<txid>`.

### Final-template txids (fill after kickoff)

| Step | Txid | Status |
|------|------|--------|
| create jar A | `PENDING_CREATE_A_TXID` | not broadcast |
| deposit jar A | `PENDING_DEPOSIT_A_TXID` | not broadcast |
| release jar A | `PENDING_RELEASE_A_TXID` | not broadcast |
| create jar B | `PENDING_CREATE_B_TXID` | not broadcast |
| refund jar B | `PENDING_REFUND_B_TXID` | not broadcast |

### Validation run (pre-kickoff, 2026-11-13T21:22Z, declared)

The final `bc076569…` template and `scripts/run-final-chipnet.sh` were exercised once before
the kickoff to validate the wrapper. This is disclosed pre-existing work; the submission
will use a fresh post-kickoff run.

| Step | Txid |
|------|------|
| create jar A | `b2d004b467c782cc48b9a8c196ea6cc69b4d6813f7975716ddceb7376461d743` |
| deposit jar A | `b19c806701845c655394a005072a998da3103e7afe867f9b586286eea082a641` |
| release jar A | `9568efd8e77c270341406d26c59db33a1d6db694f13d5f0e1452667bc8a2b4d1` |
| create jar B | `17425f6a8fb08b8ea1d00c1057736aee8647aea1e42ff89be65eea5e6226de06` |
| refund jar B | `f629fde020d2c38c624431161187bf2694b9b37eccdda5d8db299138891180a1` |

## Pre-kickoff disclosure

The prototype and its limitations were published before the kickoff:

- Repository: <https://github.com/matrixneoaiagent/layaway-jar-prework>
- Archive SHA-256: `7c9e7a7eed8920163881167443241695492e1ebc8662331d6e2119128e15ea85`

This repository builds on that prototype. The improvements here are the unique
`jarId` salt, the explicit fee model with a documented minimum and refund cap,
the VM test suite, CI, and the reproducible scripts.

### Prototype Chipnet artifacts (old template, preserved)

Old template id: `cc1642c92847c561e55dac1c330d5c08f477af91054588878c8c664aec5bb839`.

| Step | Txid |
|------|------|
| create jar #7 | `7c15d07df1caa3b92705a741935091243d431286f0c96df84379c91519054f39` |
| create jar #6 | `0fd2ff6af04c503714ac9009c48a54ec5ebed9654509498b3e5dd5e4544070b7` |
| deposit jar #6 | `6f59837de7bc6d124d48b4b55bbf8576760ee8953109c936ee8896910585b6cb` |
| release jar #6 | `11fe66e24a6a14f0fee1499ba8fad9bf8f51c6d9570dc916020e85ead9030480` |
| create jar #5 | `f88d06ba1c605d51f7df0d02deecc5c14086f224dbf750e28e940d4af3c7cdf1` |
| refund jar #5 | `a0b43c5403410d56ab204e6b68dc4c7aeba903bd1c03e732eeb1c4bcf32d1079` |

Serialized copies of the old invitations and template are in
[`fixtures/legacy/`](fixtures/legacy/).

## Limitations

These are engine/design constraints, not hidden TODOs:

1. **String state in the engine.** Follow-up actions must pass every immutable
   variable; the scripts do. See `docs/ARCHITECTURE.md`.
2. **Fee estimator undershoots P2SH32.** Fees are measured from the built
   transaction and enforced against a 2 sat/B floor.
3. **UTXO selectability flag ignored.** The jar input is always passed
   explicitly and excluded from funding selection.
4. **Template constants inside covenants.** The refund cap is inlined as
   `<3000>`; the constant documents the same value and is used off-chain.
5. **Action conditions are not evaluated by the engine.** They are UI metadata;
   the covenant and the script-level guards enforce the rules.
6. **No VM check for single-party invitations in the engine.** Every script runs
   libauth's VM before broadcasting.
7. **Shutdown noise.** Electrum/database errors after a successful broadcast are
   environmental; the scripts tolerate them.
8. **`jarSatoshis` is informational.** The authoritative balance is the UTXO
   value. A production UI should read the UTXO, not the state string.
9. **No merchant signature or receipt.** The merchant is a fixed destination, as
   specified; there is no invoice binding or proof-of-payment NFT.
10. **Small jars cannot be refunded economically.** The 3,000 sat cap plus dust
    means a refund needs at least 3,546 sats. The library rejects it early.

## Security notes

- Testnet only. No mainnet address, key or transaction exists in this repo.
- Not audited. The covenant is covered by deterministic libauth VM tests, but
  that is not a substitute for an external review.
- The saver key controls every path. Losing it loses the jar; leaking it lets
  the holder refund the jar.
- `jarId` must be random and unique. Reusing a `jarId` recreates the same
  address and key record.
- The merchant script is immutable for the jar's lifetime. Verify it before the
  first deposit.
- `release` pays **exactly** the target. If the target is wrong, the release is
  wrong; there is no partial release.
- Invitations contain only public commit data and signatures. They never contain
  the mnemonic or private key.
- Never commit `artifacts/`, `.xo-data/`, or the wallet file (all gitignored).

## CI

`.github/workflows/ci.yml` runs `npm install`, `npm run typecheck` and
`npm test` on Node 22. The integration test is opt-in because it needs a
Chipnet connection. A lockfile is included for reproducible installs.

## License

MIT. See [LICENSE](LICENSE).
