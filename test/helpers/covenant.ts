import {
    bigIntToVmNumber,
    createVirtualMachineBch,
    encodeDataPush,
    encodeLockingBytecodeP2pkh,
    flattenBinArray,
    generateSigningSerializationBch,
    hash160,
    hash256,
    hexToBin,
    secp256k1,
} from '@bitauth/libauth';
import { compileCashAssemblyString, parseTemplate } from '@xo-cash/utils';
import { layawayJarTemplate } from '../../source/index.js';

/** SIGHASH_ALL | SIGHASH_FORKID. */
export const SIGHASH_ALL_FORKID = 0x41;

export type TestCovenant = {
    redeem: Uint8Array;
    p2sh32: Uint8Array;
    saverPrivateKey: Uint8Array;
    saverPublicKey: Uint8Array;
    saverLockingScript: Uint8Array;
    merchantLockingScript: Uint8Array;
    targetSatoshis: bigint;
    jarId: Uint8Array;
};

const parse = parseTemplate(layawayJarTemplate);

function keyFromByte(byte: number): { privateKey: Uint8Array; publicKey: Uint8Array } {
    const privateKey = new Uint8Array(32);
    privateKey[31] = byte;
    const publicKey = secp256k1.derivePublicKeyCompressed(privateKey);
    if (typeof publicKey === 'string') throw new Error(publicKey);
    return { privateKey, publicKey };
}

export function buildTestCovenant(options?: {
    jarId?: Uint8Array;
    targetSatoshis?: bigint;
}): TestCovenant {
    const saver = keyFromByte(1);
    const merchant = keyFromByte(2);
    const jarId = options?.jarId ?? new Uint8Array(32).fill(0x42);
    const targetSatoshis = options?.targetSatoshis ?? 10_000n;
    const saverLockingScript = encodeLockingBytecodeP2pkh(hash160(saver.publicKey));
    const merchantLockingScript = encodeLockingBytecodeP2pkh(hash160(merchant.publicKey));

    // Replace the key method with a concrete test key so the rest of the
    // template's actual CashASM source is compiled unchanged.
    const scripts: Record<string, string> = {
        ...parse.scripts,
        saverPublicKeyHash: `<0x${Buffer.from(saver.publicKey).toString('hex')}> OP_HASH160`,
    };

    const redeemHex = compileCashAssemblyString({
        cashAssemblyText: scripts.jarRedeemBytecode,
        variables: {
            jarId,
            targetSatoshis,
            merchantLockingScript,
            saverLockingScript,
        },
        templateVariables: parse.variables,
        templateScripts: scripts,
        evaluationDecodeMode: 'hex',
    });
    const redeem = hexToBin(redeemHex);
    const p2sh32 = flattenBinArray([
        Uint8Array.of(0xaa), // OP_HASH256
        Uint8Array.of(0x20), // push 32 bytes
        hash256(redeem),
        Uint8Array.of(0x87), // OP_EQUAL
    ]);

    return {
        redeem,
        p2sh32,
        saverPrivateKey: saver.privateKey,
        saverPublicKey: saver.publicKey,
        saverLockingScript,
        merchantLockingScript,
        targetSatoshis,
        jarId,
    };
}

export type EvaluateResult = {
    success: boolean;
    reason?: string;
    transaction: unknown;
};

/**
 * Builds and signs a one-input transaction spending the covenant, then runs
 * libauth's BCH VM. The signature is valid for every case; failures therefore
 * come from the covenant rules, not from a missing signature.
 */
export function evaluateCovenantSpend(params: {
    covenant: TestCovenant;
    inputValueSatoshis: bigint;
    outputs: Array<{ lockingBytecode: Uint8Array; valueSatoshis: bigint }>;
    signWith?: Uint8Array;
}): EvaluateResult {
    const { covenant, inputValueSatoshis, outputs } = params;
    const input = {
        outpointTransactionHash: new Uint8Array(32).fill(0x11),
        outpointIndex: 0,
        sequenceNumber: 0,
        unlockingBytecode: new Uint8Array(),
    };
    const transaction = {
        version: 2,
        inputs: [ input ],
        outputs,
        locktime: 0,
    };
    const sourceOutputs = [{
        lockingBytecode: covenant.p2sh32,
        valueSatoshis: inputValueSatoshis,
    }];

    const signingSerialization = generateSigningSerializationBch(
        { inputIndex: 0, sourceOutputs, transaction },
        { coveredBytecode: covenant.redeem, signingSerializationType: Uint8Array.of(SIGHASH_ALL_FORKID) },
    );
    const signature = secp256k1.signMessageHashSchnorr(
        params.signWith ?? covenant.saverPrivateKey,
        hash256(signingSerialization),
    );
    if (typeof signature === 'string') throw new Error(signature);
    const unlockingBytecode = flattenBinArray([
        encodeDataPush(flattenBinArray([ signature, Uint8Array.of(SIGHASH_ALL_FORKID) ])),
        encodeDataPush(covenant.saverPublicKey),
        encodeDataPush(covenant.redeem),
    ]);

    const signedTransaction = {
        ...transaction,
        inputs: [{ ...input, unlockingBytecode }],
    };
    const vm = createVirtualMachineBch();
    const state = vm.evaluate({
        inputIndex: 0,
        sourceOutputs,
        transaction: signedTransaction,
    });
    const result = vm.stateSuccess(state);
    return {
        success: result === true,
        reason: result === true ? undefined : String(result),
        transaction: signedTransaction,
    };
}

export function p2pkhForPrivateKeyByte(byte: number): Uint8Array {
    const { publicKey } = keyFromByte(byte);
    return encodeLockingBytecodeP2pkh(hash160(publicKey));
}

export function vmNumber(value: bigint): Uint8Array {
    return bigIntToVmNumber(value);
}
