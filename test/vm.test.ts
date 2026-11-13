import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTestCovenant, evaluateCovenantSpend, p2pkhForPrivateKeyByte } from './helpers/covenant.js';

const TARGET = 10_000n;

test('jarId changes the P2SH32 address and redeem script', () => {
    const first = buildTestCovenant({ jarId: new Uint8Array(32).fill(0x01) });
    const second = buildTestCovenant({ jarId: new Uint8Array(32).fill(0x02) });
    assert.notDeepEqual(first.redeem, second.redeem);
    assert.notDeepEqual(first.p2sh32, second.p2sh32);
});

test('deposit succeeds when output 0 reuses the covenant with a larger value', () => {
    const covenant = buildTestCovenant();
    const result = evaluateCovenantSpend({
        covenant,
        inputValueSatoshis: 2_000n,
        outputs: [
            { lockingBytecode: covenant.p2sh32, valueSatoshis: 3_000n },
        ],
    });
    assert.equal(result.success, true, result.reason ?? '');
});

test('deposit rejects an equal-value carry-over', () => {
    const covenant = buildTestCovenant();
    const result = evaluateCovenantSpend({
        covenant,
        inputValueSatoshis: 2_000n,
        outputs: [
            { lockingBytecode: covenant.p2sh32, valueSatoshis: 2_000n },
        ],
    });
    assert.equal(result.success, false);
});

test('release at/above target pays merchant exactly the target', () => {
    const covenant = buildTestCovenant();
    const result = evaluateCovenantSpend({
        covenant,
        inputValueSatoshis: 13_000n,
        outputs: [
            { lockingBytecode: covenant.merchantLockingScript, valueSatoshis: TARGET },
            { lockingBytecode: covenant.saverLockingScript, valueSatoshis: 1_000n },
        ],
    });
    assert.equal(result.success, true, result.reason ?? '');
});

test('release below target is rejected even with a valid signature', () => {
    const covenant = buildTestCovenant();
    const result = evaluateCovenantSpend({
        covenant,
        inputValueSatoshis: 2_000n,
        outputs: [
            { lockingBytecode: covenant.merchantLockingScript, valueSatoshis: TARGET },
            { lockingBytecode: covenant.saverLockingScript, valueSatoshis: 1_000n },
        ],
    });
    assert.equal(result.success, false);
    assert.match(result.reason ?? '', /OP_VERIFY/);
});

test('release to the wrong destination is rejected', () => {
    const covenant = buildTestCovenant();
    const result = evaluateCovenantSpend({
        covenant,
        inputValueSatoshis: 13_000n,
        outputs: [
            { lockingBytecode: p2pkhForPrivateKeyByte(3), valueSatoshis: TARGET },
            { lockingBytecode: covenant.saverLockingScript, valueSatoshis: 1_000n },
        ],
    });
    assert.equal(result.success, false);
});

test('refund pays the saver and respects the fee cap', () => {
    const covenant = buildTestCovenant();
    const result = evaluateCovenantSpend({
        covenant,
        inputValueSatoshis: 5_000n,
        outputs: [
            { lockingBytecode: covenant.saverLockingScript, valueSatoshis: 3_000n },
        ],
    });
    assert.equal(result.success, true, result.reason ?? '');
});

test('refund above the 3000 sat fee cap is rejected', () => {
    const covenant = buildTestCovenant();
    const result = evaluateCovenantSpend({
        covenant,
        inputValueSatoshis: 5_000n,
        outputs: [
            { lockingBytecode: covenant.saverLockingScript, valueSatoshis: 1_000n },
        ],
    });
    assert.equal(result.success, false);
});

test('a signature from a different key is rejected', () => {
    const covenant = buildTestCovenant();
    const result = evaluateCovenantSpend({
        covenant,
        inputValueSatoshis: 2_000n,
        outputs: [
            { lockingBytecode: covenant.p2sh32, valueSatoshis: 3_000n },
        ],
        signWith: new Uint8Array(32).fill(0x09),
    });
    assert.equal(result.success, false);
});
