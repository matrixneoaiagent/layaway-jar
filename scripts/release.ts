import { DUST_LIMIT_SATOSHIS } from '@xo-cash/engine';
import { hexToBin } from '@bitauth/libauth';
import { serializeInvitation } from '@xo-cash/utils';
import { MIN_FEE_SATOSHIS } from '../source/index.js';
import { writeArtifact } from './lib/artifacts.js';
import { isBroadcast, optionalBigInt, requireEnv } from './lib/config.js';
import { openEngine, stopEngine } from './lib/engine.js';
import { buildJarSpend } from './lib/spend.js';

const jarTxid = requireEnv('JAR_TXID');
const jarVout = Number(process.env.JAR_VOUT ?? '0');
const jarId = requireEnv('JAR_ID');
const jarSatoshis = optionalBigInt('JAR_SATS') ?? 11_500n;
const targetSatoshis = optionalBigInt('TARGET_SATS') ?? 10_000n;
const initialFee = optionalBigInt('FEE_SATS') ?? MIN_FEE_SATOSHIS;
const satPerByte = optionalBigInt('SAT_PER_BYTE');
const saverScript = requireEnv('SAVER_SCRIPT');
const merchantScript = requireEnv('MERCHANT_SCRIPT');
if (!/^[0-9a-f]{64}$/i.test(jarId)) throw new Error('JAR_ID must be 32 bytes of hex');
if (jarSatoshis < targetSatoshis) throw new Error('JAR_SATS must be at least TARGET_SATS');
const maxFee = jarSatoshis - targetSatoshis - BigInt(DUST_LIMIT_SATOSHIS);
if (maxFee < MIN_FEE_SATOSHIS) throw new Error('jar does not hold target + fee + dust');

const { engine, templateIdentifier } = await openEngine();
try {
    const template = await engine.getTemplate(templateIdentifier);
    if (!template) throw new Error('template missing');
    const releaseIntent = template.lockingScripts.jarScript.roles?.saver.actions?.find((intent) => intent.action === 'release');
    if (!releaseIntent) throw new Error('release intent missing');

    console.log('template', templateIdentifier);
    console.log('jar', jarTxid, jarVout, 'jarId', jarId);
    console.log('balance', String(jarSatoshis), 'target', String(targetSatoshis), 'max fee', String(maxFee));

    const result = await buildJarSpend({
        engine,
        templateIdentifier,
        actionIdentifier: 'release',
        intent: releaseIntent,
        variables: [
            { variableIdentifier: 'jarId', roleIdentifier: 'saver', value: jarId },
            { variableIdentifier: 'jarSatoshis', roleIdentifier: 'saver', value: jarSatoshis },
            { variableIdentifier: 'targetSatoshis', roleIdentifier: 'saver', value: targetSatoshis },
            { variableIdentifier: 'merchantLockingScript', roleIdentifier: 'saver', value: merchantScript },
            { variableIdentifier: 'saverLockingScript', roleIdentifier: 'saver', value: saverScript },
        ],
        outputIdentifiers: ['merchantOutput', 'releaseRefundOutput'],
        jarTxid,
        jarVout,
        maxFeeSatoshis: maxFee,
        initialFeeSatoshis: initialFee,
        satPerByte,
    });

    console.log('merchant gets', String(targetSatoshis), 'saver gets', String(jarSatoshis - targetSatoshis - result.feeSatoshis), 'fee', String(result.feeSatoshis));
    console.log('missing', JSON.stringify(await engine.listMissingRequirements(result.invitationIdentifier), (_key, value) => typeof value === 'bigint' ? value.toString() : value));

    const stored = await engine.getInvitation(result.invitationIdentifier);
    if (!stored) throw new Error('stored invitation missing');
    console.log('invitation', writeArtifact('release-invitation.json', serializeInvitation(stored.invitation)));
    console.log('RELEASE_TXID', result.preview.transactionHash);

    if (isBroadcast()) {
        const broadcast = await engine.executeAction(result.invitationIdentifier, { broadcastTransaction: true });
        console.log('BROADCAST_TXID', broadcast.builtTransaction.transactionHash);
    } else {
        console.log('DRY_RUN (set BROADCAST=1 to send)');
    }
} finally {
    await stopEngine(engine);
}
