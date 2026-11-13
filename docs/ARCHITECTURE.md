# Architecture

The Layaway Jar is a single-saver BCH savings covenant. This document describes
the on-chain state model, the redeem-script branches, the fee model and the
parts of the XO engine that constrain the implementation.

## 1. State model

The authoritative jar balance is the **value of the P2SH32 UTXO**. Nothing about
the balance is committed into the redeem script, because doing so would change
the address after every deposit.

The redeem script commits to the rest of the state:

| Value | Where it lives | Mutable? |
|-------|----------------|----------|
| `jarId` | 32-byte salt pushed and dropped in the redeem script | No |
| `targetSatoshis` | pushed as a VM number inside the covenant | No |
| `merchantLockingScript` | pushed as bytes inside the covenant | No |
| `saverLockingScript` | pushed as bytes inside the covenant | No |
| balance | UTXO value | Yes, deposits only increase it |
| `jarSatoshis` | template variable used for descriptions and output construction | Informational mirror only |

`jarId` makes every jar unique. Two jars with the same target, merchant and
saver but different `jarId` values compile to different redeem scripts and
therefore different P2SH32 addresses (`OP_HASH256 <32-byte hash> OP_EQUAL`).

## 2. Redeem script

`source/layaway-jar.ts` compiles to this flow:

```
<jarId> OP_DROP
enforceSaverSignature
enforceJarRules
```

`enforceSaverSignature` is the standard P2PKH-style check against the saver key:
`OP_DUP OP_HASH160 <saverPublicKeyHash> OP_EQUALVERIFY OP_CHECKSIGVERIFY`.
Every path therefore requires a Schnorr signature from the jar's saver key.

`enforceJarRules` looks at output 0:

```
if output0.bytecode == input.bytecode:
    deposit
else if output0.bytecode == merchantLockingScript:
    release
else:
    refund
```

### Deposit

```
output0.value > input.value
```

The bytecode equality is checked before the branch, so a deposit must reuse the
**exact** covenant and only increase its value. Because the redeem script is
identical, `jarId`, target, merchant and saver cannot be changed by a deposit.

### Release

```
input.value >= targetSatoshis
output0.value == targetSatoshis
```

Output 0 is the merchant. Any excess is expected on output 1 to the saver as
change. The covenant does not need to inspect output 1: the transaction's value
conservation plus the exact merchant payment already leaves the excess for the
saver output defined by the template.

The action also requires `input.value >= target + fee + dust` so a release can
pay a miner fee and leave a non-dust change output. This is a UI/application
gate; the covenant enforces the target and destination.

### Refund

```
output0.bytecode == saverLockingScript
output0.value >= input.value - 3000
```

Output 0 pays the saver. The covenant caps the miner fee at **3,000 sats**.
That cap is inlined as `<3000>` because template constants are not exposed inside
covenant scripts by the current compiler; the template constant
`maxRefundFeeSatoshis` documents the same number and is used by the library
helpers.

Release is tested before refund. If a merchant locking script happened to equal
the saver locking script, the release branch would win, so the target check
cannot be bypassed by choosing a merchant script equal to the saver script.

## 3. Fee model

The original prototype used fixed 500/1,000 sat fees, which is below a safe
relay rate for P2SH32 inputs. The final template adds an explicit
`feeSatoshis` variable and a documented policy:

| Constant | Value | Purpose |
|----------|-------|---------|
| `minimumFeeSatoshis` | 2,000 sats | Documented minimum for release and refund |
| `maxRefundFeeSatoshis` | 3,000 sats | Mirrors the on-chain refund cap |
| `dustLimit` | 546 sats | Minimum saver change output |

`scripts/lib/fee.ts` computes `vsize * satPerByte` (default 2 sat/B), clamps it
to the 2,000 sat minimum and optionally to the refund cap. The release and
refund scripts build the invitation once, measure the real transaction size,
and rebuild with the higher fee if the measured size needs it. The fee is only
accepted when it covers the measured vsize.

Because the refund fee is capped at 3,000 sats, a jar holding less than
`3,000 + 546 = 3,546` sats cannot be refunded economically. The library's
`refundValue` helper rejects such a spend before it reaches the engine.

## 4. Actions and variables

| Action | Inputs | Outputs | Required variables |
|--------|--------|---------|--------------------|
| `createJar` | funding | `initialJarOutput` (+ change) | `jarId`, `jarSatoshis`, `targetSatoshis`, `merchantLockingScript`, `saverLockingScript` |
| `deposit` | `jarInput` + funding | `depositJarOutput` (+ change) | the five state values + `depositedSatoshis` |
| `release` | `jarInput` | `merchantOutput`, `releaseRefundOutput` | the five state values + `feeSatoshis` |
| `refund` | `jarInput` | `refundOutput` | the five state values + `feeSatoshis` |

All immutable values are passed explicitly on every follow-up. The engine stores
state values as strings; without re-supplying them, a satoshi value can be
compiled as text rather than a VM number. `scripts/lib/spend.ts` does this
consistently.

## 5. Transaction construction

The scripts follow the same sequence as the prototype:

1. Archive old invitations to release local UTXO reservations.
2. Import the template and derive saver/merchant locking scripts.
3. Create the invitation with all variables.
4. Append output identifiers, then the jar/funding inputs.
5. Reserve change explicitly (the engine fee estimator undershoots P2SH32).
6. Sign the wallet inputs.
7. Build the merged transaction and run libauth's BCH VM on it.
8. Write the serialized invitation under `artifacts/`.
9. Broadcast only when `BROADCAST=1`.

## 6. Engine limitations that shaped the design

These are documented so the template is not mistaken for a fully validated
production wallet.

1. **String state.** Follow-up actions must pass every immutable variable.
2. **Fee estimator.** `estimateTransactionFee` ignores the large P2SH32
   unlocking bytecode; fees are measured from the built transaction instead.
3. **UTXO selectability.** Electrum UTXOs are marked `selectable: true` even
   when the template role says `selectable: false`. Scripts pass the jar input
   explicitly and exclude it from funding selection.
4. **Constants in covenant scripts.** The refund cap is inlined at `<3000>`.
5. **Conditions are not evaluated by the engine.** `conditions` are schema
   metadata for UIs; the covenant and the script-level guards are the real
   enforcement.
6. **No VM check for single-party invitations.** `scripts/verify-tx.ts` runs
   libauth's VM before any broadcast.
7. **Shutdown noise.** `DatabaseClosedError` and Electrum subscription errors
   can appear after a successful broadcast; the scripts tolerate them.

## 7. Test strategy

- `test/template.test.ts`: parse/serialize identifier stability, required
  variables, fee constants, negative-refund guard.
- `test/vm.test.ts`: compiles the real CashASM with libauth, signs with a real
  Schnorr key, and evaluates all four actions plus the forged below-target,
  wrong-destination, fee-cap and wrong-key cases.
- `test/import.test.ts`: optional engine import agreement, gated by
  `XO_INTEGRATION=1` because it needs a Chipnet connection.

The VM vectors are the strongest guarantee: they exercise the actual compiled
redeem script, not a reimplementation of its rules.
