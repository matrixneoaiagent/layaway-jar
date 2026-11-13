import type { XOTemplateVariableIdentifier } from '@xo-cash/types';

/** Actions exposed by the Layaway Jar template. */
export type LayawayJarAction = 'createJar' | 'deposit' | 'release' | 'refund';

/** The immutable and mutable state carried by one jar. */
export type LayawayJarState = {
    /** Random 32-byte salt that makes the jar address unique. */
    jarId: Uint8Array;
    /** Informational balance mirror. The authoritative balance is the UTXO value. */
    jarSatoshis: bigint;
    /** Amount the jar must hold before release is allowed. */
    targetSatoshis: bigint;
    /** Locking script paid the target on release. */
    merchantLockingScript: string;
    /** Locking script paid refunds and excess. */
    saverLockingScript: string;
};

/** Values an application must supply for a release or refund. */
export type LayawayJarSpendParameters = LayawayJarState & {
    /** Miner fee taken from the jar. Must be at least MIN_FEE_SATOSHIS. */
    feeSatoshis: bigint;
};

/** Documented minimum fee for release and refund actions. */
export const MIN_FEE_SATOSHIS = 2000n;

/** On-chain cap on the refund fee, mirrored by the covenant. */
export const MAX_REFUND_FEE_SATOSHIS = 3000n;

/** Dust floor for the saver's release change output. */
export const RELEASE_DUST_SATOSHIS = 546n;

/**
 * Computes the saver's refund and rejects impossible spends before they reach
 * the engine. A refund is negative when the fee is larger than the jar; the
 * covenant also caps the fee, so both limits are checked here.
 */
export function refundValue(state: LayawayJarState, feeSatoshis: bigint): bigint {
    if (state.jarSatoshis < 0n) throw new Error('jar balance cannot be negative');
    if (feeSatoshis < MIN_FEE_SATOSHIS) throw new Error(`fee ${feeSatoshis} is below the minimum ${MIN_FEE_SATOSHIS}`);
    if (feeSatoshis > MAX_REFUND_FEE_SATOSHIS) throw new Error(`fee ${feeSatoshis} exceeds the refund cap ${MAX_REFUND_FEE_SATOSHIS}`);
    const refund = state.jarSatoshis - feeSatoshis;
    if (refund < RELEASE_DUST_SATOSHIS) throw new Error(`refund ${refund} would be below dust or negative`);
    return refund;
}

/**
 * Computes both release outputs and rejects a release the covenant would
 * refuse: the jar must hold target + fee + dust.
 */
export function releaseValue(state: LayawayJarState, feeSatoshis: bigint): { merchant: bigint; saver: bigint } {
    if (state.targetSatoshis < 0n) throw new Error('target cannot be negative');
    if (feeSatoshis < MIN_FEE_SATOSHIS) throw new Error(`fee ${feeSatoshis} is below the minimum ${MIN_FEE_SATOSHIS}`);
    const saver = state.jarSatoshis - state.targetSatoshis - feeSatoshis;
    if (saver < RELEASE_DUST_SATOSHIS) throw new Error(`release leaves ${saver} for the saver; target + fee + dust is not covered`);
    return { merchant: state.targetSatoshis, saver };
}

/** Variable identifiers that every follow-up action must provide. */
export const JAR_FOLLOW_UP_VARIABLES: readonly XOTemplateVariableIdentifier[] = [
    'jarId',
    'jarSatoshis',
    'targetSatoshis',
    'merchantLockingScript',
    'saverLockingScript',
];
