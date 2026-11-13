import { MAX_REFUND_FEE_SATOSHIS, MIN_FEE_SATOSHIS } from '../../source/index.js';
import { DEFAULT_SAT_PER_BYTE } from './config.js';

/**
 * Recommended miner fee for a transaction of `vsize` bytes.
 *
 * The fee is clamped to the documented minimum and, when `cap` is provided, to
 * the on-chain refund cap. The cap exists because the covenant refuses a refund
 * that leaves it with less than `input value - 3000` satoshis.
 */
export function feeForVsize(vsize: number, satPerByte: bigint = DEFAULT_SAT_PER_BYTE, cap?: bigint): bigint {
    if (!Number.isInteger(vsize) || vsize <= 0) throw new Error(`invalid vsize: ${vsize}`);
    const raw = BigInt(vsize) * satPerByte;
    const floored = raw < MIN_FEE_SATOSHIS ? MIN_FEE_SATOSHIS : raw;
    return cap !== undefined && floored > cap ? cap : floored;
}

/**
 * Checks that a fee meets the documented minimum, respects an optional cap and
 * covers the measured transaction size.
 *
 * @throws when the fee is below the minimum, above the cap, or when the size
 *         cannot be covered without exceeding the cap.
 */
export function checkFee(feeSatoshis: bigint, vsize: number, options?: { satPerByte?: bigint; cap?: bigint }): void {
    const { satPerByte = DEFAULT_SAT_PER_BYTE, cap } = options ?? {};
    if (feeSatoshis < MIN_FEE_SATOSHIS) {
        throw new Error(`fee ${feeSatoshis} is below the documented minimum ${MIN_FEE_SATOSHIS}`);
    }
    if (cap !== undefined && feeSatoshis > cap) {
        throw new Error(`fee ${feeSatoshis} exceeds the cap ${cap}`);
    }
    const required = BigInt(vsize) * satPerByte;
    if (required > feeSatoshis && cap !== undefined && required > cap) {
        throw new Error(`transaction needs ${required} sats at ${satPerByte} sat/B but the cap is ${cap}`);
    }
}

export { MAX_REFUND_FEE_SATOSHIS, MIN_FEE_SATOSHIS };
