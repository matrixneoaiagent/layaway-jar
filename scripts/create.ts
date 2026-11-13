import { DUST_LIMIT_SATOSHIS } from '@xo-cash/engine';
import { binToHex, hexToBin } from '@bitauth/libauth';
import { serializeInvitation } from '@xo-cash/utils';
import { MIN_FEE_SATOSHIS } from '../source/index.js';
import { generateJarId, writeArtifact } from './lib/artifacts.js';
import { isBroadcast, optionalBigInt } from './lib/config.js';
import { archiveAllInvitations, ensureDefaultPolicies, openEngine, stopEngine } from './lib/engine.js';
import { verifyInvitationTransaction } from './verify-tx.js';

const initialSatoshis = optionalBigInt('INITIAL_SATS') ?? 2_000n;
const targetSatoshis = optionalBigInt('TARGET_SATS') ?? 10_000n;
const jarId = process.env.JAR_ID ? hexToBin(process.env.JAR_ID) : generateJarId();
if (jarId.length !== 32) throw new Error('JAR_ID must be 32 bytes of hex');
if (initialSatoshis <= 0n) throw new Error('INITIAL_SATS must be positive');
if (targetSatoshis <= initialSatoshis) throw new Error('TARGET_SATS must be larger than INITIAL_SATS');

const { engine, templateIdentifier } = await openEngine();
try {
    await ensureDefaultPolicies(engine);
    await archiveAllInvitations(engine);
    const template = await engine.getTemplate(templateIdentifier);
    if (!template) throw new Error('template missing after import');
    const start = template.start.find((intent) => intent.action === 'createJar');
    if (!start) throw new Error('createJar start intent missing');

    const saverScript = process.env.SAVER_SCRIPT ?? await engine.generateLockingBytecodeFromDefaultPolicy('receive');
    const merchantScript = process.env.MERCHANT_SCRIPT ?? await engine.generateLockingBytecodeFromDefaultPolicy('receive');
    if (saverScript === merchantScript) {
        console.warn('warning: SAVER_SCRIPT equals MERCHANT_SCRIPT (set MERCHANT_SCRIPT to use a distinct merchant)');
    }

    console.log('template', templateIdentifier);
    console.log('jarId', binToHex(jarId));
    console.log('initial', String(initialSatoshis), 'target', String(targetSatoshis));
    console.log('saver', saverScript);
    console.log('merchant', merchantScript);

    const created = await engine.createInvitation({
        templateIdentifier,
        actionIdentifier: 'createJar',
        intent: start,
        variables: [
            { variableIdentifier: 'jarId', roleIdentifier: 'saver', value: binToHex(jarId) },
            { variableIdentifier: 'jarSatoshis', roleIdentifier: 'saver', value: initialSatoshis },
            { variableIdentifier: 'targetSatoshis', roleIdentifier: 'saver', value: targetSatoshis },
            { variableIdentifier: 'merchantLockingScript', roleIdentifier: 'saver', value: merchantScript },
            { variableIdentifier: 'saverLockingScript', roleIdentifier: 'saver', value: saverScript },
        ],
    });
    const invitationIdentifier = created.invitation.invitationIdentifier;

    await engine.appendInvitation(invitationIdentifier, {
        templateIdentifier,
        actionIdentifier: 'createJar',
        outputs: [{ outputIdentifier: 'initialJarOutput' }],
    });

    const spendable = await engine.listSpendableUnspentOutputs();
    const funding = spendable
        .filter((utxo) => BigInt(utxo.valueSatoshis) > initialSatoshis + 5_000n)
        .sort((a, b) => Number(BigInt(b.valueSatoshis) - BigInt(a.valueSatoshis)))[0];
    if (!funding) throw new Error('no funding UTXO larger than INITIAL_SATS + 5000');
    console.log('funding', funding.outpointTransactionHash, funding.outpointIndex, String(funding.valueSatoshis));

    await engine.appendInvitation(invitationIdentifier, {
        templateIdentifier,
        actionIdentifier: 'createJar',
        inputs: [{
            outpointTransactionHash: hexToBin(funding.outpointTransactionHash),
            outpointIndex: funding.outpointIndex,
        }],
    });

    const estimatedFee = await engine.estimateTransactionFee(invitationIdentifier);
    const feeSatoshis = optionalBigInt('FEE_SATS') ?? BigInt(Math.max(estimatedFee, Number(MIN_FEE_SATOSHIS)));
    const fundingValue = BigInt(funding.valueSatoshis);
    const changeSatoshis = fundingValue - initialSatoshis - feeSatoshis;
    if (changeSatoshis < BigInt(DUST_LIMIT_SATOSHIS)) {
        throw new Error(`change ${changeSatoshis} is below dust; lower INITIAL_SATS or raise the funding UTXO`);
    }
    await engine.appendInvitation(invitationIdentifier, {
        templateIdentifier,
        actionIdentifier: 'createJar',
        outputs: [{ lockingBytecode: hexToBin(saverScript), valueSatoshis: changeSatoshis }],
    });
    console.log('fee', String(feeSatoshis), 'change', String(changeSatoshis));

    for (const inputIndex of await engine.listOwnInputIndexes(invitationIdentifier)) {
        await engine.signInvitation(invitationIdentifier, inputIndex);
    }

    const preview = await verifyInvitationTransaction(engine, invitationIdentifier, 0);
    console.log('preview txid', preview.transactionHash, 'size', preview.transactionByteLength);
    console.log('missing', JSON.stringify(await engine.listMissingRequirements(invitationIdentifier), (_key, value) => typeof value === 'bigint' ? value.toString() : value));

    const stored = await engine.getInvitation(invitationIdentifier);
    if (!stored) throw new Error('stored invitation missing');
    const invitationPath = writeArtifact('createJar-invitation.json', serializeInvitation(stored.invitation));
    const record = {
        templateIdentifier,
        invitationIdentifier,
        jarId: binToHex(jarId),
        jarTxid: preview.transactionHash,
        jarVout: 0,
        jarSatoshis: initialSatoshis.toString(),
        targetSatoshis: targetSatoshis.toString(),
        merchantLockingScript: merchantScript,
        saverLockingScript: saverScript,
    };
    const recordPath = writeArtifact('jar.json', JSON.stringify(record, null, 2));
    console.log('invitation', invitationPath);
    console.log('jar record', recordPath);
    console.log('JAR_TXID', preview.transactionHash);
    console.log('JAR_ID', binToHex(jarId));
    console.log('SAVER_SCRIPT', saverScript);
    console.log('MERCHANT_SCRIPT', merchantScript);

    if (isBroadcast()) {
        const result = await engine.executeAction(invitationIdentifier, { broadcastTransaction: true });
        console.log('BROADCAST_TXID', result.builtTransaction.transactionHash);
    } else {
        console.log('DRY_RUN (set BROADCAST=1 to send)');
    }
} finally {
    await stopEngine(engine);
}
