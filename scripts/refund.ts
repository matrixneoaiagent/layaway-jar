import { DUST_LIMIT_SATOSHIS } from '@xo-cash/engine';
import { hexToBin } from '@bitauth/libauth';
import { serializeInvitation } from '@xo-cash/utils';
import { MAX_REFUND_FEE_SATOSHIS, MIN_FEE_SATOSHIS } from '../source/index.js';
import { writeArtifact } from './lib/artifacts.js';
import { isBroadcast, optionalBigInt, requireEnv } from './lib/config.js';
import { openEngine, stopEngine } from './lib/engine.js';
import { buildJarSpend } from './lib/spend.js';

const jarTxid = requireEnv('JAR_TXID');
const jarVout = Number(process.env.JAR_VOUT ?? '0');
const jarId = requireEnv('JAR_ID');
const jarSatoshis = optionalBigInt('JAR_SATS') ?? 5_000n;
const targetSatoshis = optionalBigInt('TARGET_SATS') ?? 10_000n;
const initialFee = optionalBigInt('FEE_SATS') ?? MIN_FEE_SATOSHIS;
const satPerByte = optionalBigInt('SAT_PER_BYTE');
const saverScript = requireEnv('SAVER_SCRIPT');
const merchantScript = requireEnv('MERCHANT_SCRIPT');
if (!/^[0-9a-f]{64}$/i.test(jarId)) throw new Error('JAR_ID must be 32 bytes of hex');

// The covenant caps the refund fee at 3000 sats, so the helper may never
// propose more even if the measured vsize would justify it.
const maxFee = jarSatoshis - BigInt(DUST_LIMIT_SATOSHIS) < MAX_REFUND_FEE_SATOSHIS
    ? jarSatoshis - BigInt(DUST_LIMIT_SATOSHIS)
    : MAX_REFUND_FEE_SATOSHIS;
if (maxFee < MIN_FEE_SATOSHIS) throw new Error('jar balance cannot cover the minimum fee and dust');

const { engine, templateIdentifier } = await openEngine();
try {
    const template = await engine.getTemplate(templateIdentifier);
    if (!template) throw new Error('template missing');
    const refundIntent = template.lockingScripts.jarScript.roles?.saver.actions?.find((intent) => intent.action === 'refund');
    if (!refundIntent) throw new Error('refund intent missing');

    console.log('template', templateIdentifier);
    console.log('jar', jarTxid, jarVout, 'jarId', jarId);
    console.log('balance', String(jarSatoshis), 'cap', String(maxFee));

    const result = await buildJarSpend({
        engine,
        templateIdentifier,
        actionIdentifier: 'refund',
        intent: refundIntent,
        variables: [
            { variableIdentifier: 'jarId', roleIdentifier: 'saver', value: jarId },
            { variableIdentifier: 'jarSatoshis', roleIdentifier: 'saver', value: jarSatoshis },
            { variableIdentifier: 'targetSatoshis', roleIdentifier: 'saver', value: targetSatoshis },
            { variableIdentifier: 'merchantLockingScript', roleIdentifier: 'saver', value: merchantScript },
            { variableIdentifier: 'saverLockingScript', roleIdentifier: 'saver', value: saverScript },
        ],
        outputIdentifiers: ['refundOutput'],
        jarTxid,
        jarVout,
        maxFeeSatoshis: maxFee,
        initialFeeSatoshis: initialFee,
        satPerByte,
    });

    console.log('saver gets', String(jarSatoshis - result.feeSatoshis), 'fee', String(result.feeSatoshis));
    console.log('missing', JSON.stringify(await engine.listMissingRequirements(result.invitationIdentifier), (_key, value) => typeof value === 'bigint' ? value.toString() : value));

    const stored = await engine.getInvitation(result.invitationIdentifier);
    if (!stored) throw new Error('stored invitation missing');
    console.log('invitation', writeArtifact('refund-invitation.json', serializeInvitation(stored.invitation)));
    console.log('REFUND_TXID', result.preview.transactionHash);

    if (isBroadcast()) {
        const broadcast = await engine.executeAction(result.invitationIdentifier, { broadcastTransaction: true });
        console.log('BROADCAST_TXID', broadcast.builtTransaction.transactionHash);
    } else {
        console.log('DRY_RUN (set BROADCAST=1 to send)');
    }
} finally {
    await stopEngine(engine);
}
