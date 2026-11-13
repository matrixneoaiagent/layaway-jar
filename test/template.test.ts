import assert from 'node:assert/strict';
import test from 'node:test';
import { generateTemplateIdentifier, parseTemplate, serializeTemplate } from '@xo-cash/utils';
import { layawayJarTemplate } from '../source/index.js';
import { MAX_REFUND_FEE_SATOSHIS, MIN_FEE_SATOSHIS, refundValue, releaseValue } from '../source/types.js';

const parsed = parseTemplate(layawayJarTemplate);

test('parseTemplate returns a usable template with all four actions', () => {
    assert.deepEqual(Object.keys(parsed.actions).sort(), ['createJar', 'deposit', 'refund', 'release']);
    assert.equal(typeof parsed.scripts.jarRedeemBytecode, 'string');
    assert.match(parsed.scripts.jarRedeemBytecode, /<jarId> OP_DROP/);
});

test('the template identifier is stable across parse and serialization', () => {
    const first = generateTemplateIdentifier(parsed);
    const reparsed = parseTemplate(serializeTemplate(parsed));
    assert.equal(generateTemplateIdentifier(reparsed), first);
});

function requiredVariables(action: 'deposit' | 'release' | 'refund'): string[] {
    return parsed.actions[action]?.roles?.saver?.requirements?.variables ?? [];
}

test('every follow-up action requires the full immutable state including jarId', () => {
    for (const action of ['deposit', 'release', 'refund'] as const) {
        const required = requiredVariables(action);
        for (const variable of ['jarId', 'jarSatoshis', 'targetSatoshis', 'merchantLockingScript', 'saverLockingScript']) {
            assert.ok(required.includes(variable), `${action} must require ${variable}`);
        }
    }
});

test('release and refund require an explicit fee variable', () => {
    assert.ok(requiredVariables('release').includes('feeSatoshis'));
    assert.ok(requiredVariables('refund').includes('feeSatoshis'));
});

test('the refund fee cap is a documented, non-negative satoshi constant', () => {
    const constant = parsed.constants?.maxRefundFeeSatoshis;
    assert.ok(constant);
    assert.equal(constant.type, 'satoshis');
    assert.equal(typeof constant.value, 'bigint');
    assert.ok((constant.value as bigint) >= 0n);
    assert.equal(MAX_REFUND_FEE_SATOSHIS, constant.value as bigint);
});

test('a template-level negative refund throws before it can be built', () => {
    const state = {
        jarId: new Uint8Array(32),
        jarSatoshis: 1_000n,
        targetSatoshis: 10_000n,
        merchantLockingScript: '76a914000000000000000000000000000000000000000088ac',
        saverLockingScript: '76a914000000000000000000000000000000000000000088ac',
    };
    assert.throws(() => refundValue(state, MIN_FEE_SATOSHIS), /below dust or negative/);
    assert.throws(() => refundValue(state, MAX_REFUND_FEE_SATOSHIS + 1n), /exceeds the refund cap/);
    assert.throws(() => releaseValue(state, MIN_FEE_SATOSHIS), /target \+ fee \+ dust/);
});

test('refundValue and releaseValue return the documented splits', () => {
    const state = {
        jarId: new Uint8Array(32),
        jarSatoshis: 13_000n,
        targetSatoshis: 10_000n,
        merchantLockingScript: '76a914000000000000000000000000000000000000000088ac',
        saverLockingScript: '76a914000000000000000000000000000000000000000088ac',
    };
    assert.equal(refundValue(state, 2_000n), 11_000n);
    assert.deepEqual(releaseValue(state, 2_000n), { merchant: 10_000n, saver: 1_000n });
});
