import { DUST_LIMIT_SATOSHIS } from '@xo-cash/engine';
import { hexToBin } from '@bitauth/libauth';
import { serializeInvitation } from '@xo-cash/utils';
import { MIN_FEE_SATOSHIS } from '../source/index.js';
import { writeArtifact } from './lib/artifacts.js';
import { isBroadcast, optionalBigInt, requireEnv } from './lib/config.js';
import { archiveAllInvitations, openEngine, stopEngine } from './lib/engine.js';
import { verifyInvitationTransaction } from './verify-tx.js';

const jarTxid = requireEnv('JAR_TXID');
const jarVout = Number(process.env.JAR_VOUT ?? '0');
const jarId = requireEnv('JAR_ID');
const jarSatoshis = optionalBigInt('JAR_SATS') ?? 2_000n;
const depositedSatoshis = optionalBigInt('DEPOSIT_SATS') ?? 9_500n;
const targetSatoshis = optionalBigInt('TARGET_SATS') ?? 10_000n;
const feeSatoshis = optionalBigInt('FEE_SATS') ?? MIN_FEE_SATOSHIS;
const saverScript = requireEnv('SAVER_SCRIPT');
const merchantScript = requireEnv('MERCHANT_SCRIPT');
if (!/^[0-9a-f]{64}$/i.test(jarId)) throw new Error('JAR_ID must be 32 bytes of hex');
if (depositedSatoshis <= 0n) throw new Error('DEPOSIT_SATS must be positive');

const { engine, templateIdentifier } = await openEngine();
try {
    await archiveAllInvitations(engine);
    const template = await engine.getTemplate(templateIdentifier);
    if (!template) throw new Error('template missing');
    const depositIntent = template.lockingScripts.jarScript.roles?.saver.actions?.find((intent) => intent.action === 'deposit');
    if (!depositIntent) throw new Error('deposit intent missing');

    console.log('template', templateIdentifier);
    console.log('jar', jarTxid, jarVout, 'jarId', jarId, 'balance', String(jarSatoshis), 'deposit', String(depositedSatoshis));

    const created = await engine.createInvitation({
        templateIdentifier,
        actionIdentifier: 'deposit',
        intent: depositIntent,
        variables: [
            { variableIdentifier: 'jarId', roleIdentifier: 'saver', value: jarId },
            { variableIdentifier: 'jarSatoshis', roleIdentifier: 'saver', value: jarSatoshis },
            { variableIdentifier: 'depositedSatoshis', roleIdentifier: 'saver', value: depositedSatoshis },
            { variableIdentifier: 'targetSatoshis', roleIdentifier: 'saver', value: targetSatoshis },
            { variableIdentifier: 'merchantLockingScript', roleIdentifier: 'saver', value: merchantScript },
            { variableIdentifier: 'saverLockingScript', roleIdentifier: 'saver', value: saverScript },
        ],
        inputs: [{
            inputIdentifier: 'jarInput',
            outpointTransactionHash: hexToBin(jarTxid),
            outpointIndex: jarVout,
        }],
    });
    const invitationIdentifier = created.invitation.invitationIdentifier;

    await engine.appendInvitation(invitationIdentifier, {
        templateIdentifier,
        actionIdentifier: 'deposit',
        outputs: [{ outputIdentifier: 'depositJarOutput' }],
    });

    const spendable = await engine.listSpendableUnspentOutputs();
    const funding = spendable
        .filter((utxo) => !(utxo.outpointTransactionHash === jarTxid && utxo.outpointIndex === jarVout))
        .sort((a, b) => Number(BigInt(b.valueSatoshis) - BigInt(a.valueSatoshis)))[0];
    if (!funding) throw new Error('no funding UTXO for the deposit');
    console.log('funding', funding.outpointTransactionHash, funding.outpointIndex, String(funding.valueSatoshis));

    await engine.appendInvitation(invitationIdentifier, {
        templateIdentifier,
        actionIdentifier: 'deposit',
        inputs: [{
            outpointTransactionHash: hexToBin(funding.outpointTransactionHash),
            outpointIndex: funding.outpointIndex,
        }],
    });

    const jarOutput = jarSatoshis + depositedSatoshis;
    const totalInput = jarSatoshis + BigInt(funding.valueSatoshis);
    const changeSatoshis = totalInput - jarOutput - feeSatoshis;
    if (changeSatoshis < BigInt(DUST_LIMIT_SATOSHIS)) throw new Error(`change ${changeSatoshis} is below dust`);
    console.log('jar output', String(jarOutput), 'fee', String(feeSatoshis), 'change', String(changeSatoshis));
    await engine.appendInvitation(invitationIdentifier, {
        templateIdentifier,
        actionIdentifier: 'deposit',
        outputs: [{ lockingBytecode: hexToBin(saverScript), valueSatoshis: changeSatoshis }],
    });

    for (const inputIndex of await engine.listOwnInputIndexes(invitationIdentifier)) {
        await engine.signInvitation(invitationIdentifier, inputIndex);
    }

    const preview = await verifyInvitationTransaction(engine, invitationIdentifier, 0);
    console.log('preview txid', preview.transactionHash, 'size', preview.transactionByteLength);
    console.log('missing', JSON.stringify(await engine.listMissingRequirements(invitationIdentifier), (_key, value) => typeof value === 'bigint' ? value.toString() : value));

    const stored = await engine.getInvitation(invitationIdentifier);
    if (!stored) throw new Error('stored invitation missing');
    console.log('invitation', writeArtifact('deposit-invitation.json', serializeInvitation(stored.invitation)));
    console.log('NEW_JAR_SATS', String(jarOutput));

    if (isBroadcast()) {
        const result = await engine.executeAction(invitationIdentifier, { broadcastTransaction: true });
        console.log('BROADCAST_TXID', result.builtTransaction.transactionHash);
    } else {
        console.log('DRY_RUN (set BROADCAST=1 to send)');
    }
} finally {
    await stopEngine(engine);
}
