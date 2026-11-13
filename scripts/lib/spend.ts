import { DUST_LIMIT_SATOSHIS, type Engine } from '@xo-cash/engine';
import { hexToBin } from '@bitauth/libauth';
import { MIN_FEE_SATOSHIS } from '../../source/index.js';
import { DEFAULT_SAT_PER_BYTE } from './config.js';
import { archiveAllInvitations } from './engine.js';
import { checkFee, feeForVsize } from './fee.js';
import { verifyInvitationTransaction } from '../verify-tx.js';

type InvitationVariables = NonNullable<Parameters<Engine['createInvitation']>[0]['variables']>;

export type SpendResult = {
    invitationIdentifier: string;
    feeSatoshis: bigint;
    preview: Awaited<ReturnType<typeof verifyInvitationTransaction>>;
};

/**
 * Creates, signs and VM-verifies a release or refund invitation up to three
 * times: the first pass measures the real vsize, and if the fee does not cover
 * the default 2 sat/B policy the invitation is rebuilt with the higher fee.
 */
export async function buildJarSpend(params: {
    engine: Engine;
    templateIdentifier: string;
    actionIdentifier: 'release' | 'refund';
    intent: unknown;
    variables: InvitationVariables;
    outputIdentifiers: string[];
    jarTxid: string;
    jarVout: number;
    maxFeeSatoshis: bigint;
    initialFeeSatoshis: bigint;
    satPerByte?: bigint;
}): Promise<SpendResult> {
    const {
        engine, templateIdentifier, actionIdentifier, intent, variables, outputIdentifiers,
        jarTxid, jarVout, maxFeeSatoshis, initialFeeSatoshis,
        satPerByte = DEFAULT_SAT_PER_BYTE,
    } = params;

    let feeSatoshis = initialFeeSatoshis > maxFeeSatoshis ? maxFeeSatoshis : initialFeeSatoshis;
    if (feeSatoshis < MIN_FEE_SATOSHIS) throw new Error(`fee ${feeSatoshis} is below the documented minimum ${MIN_FEE_SATOSHIS}`);
    if (feeSatoshis > maxFeeSatoshis) throw new Error(`fee ${feeSatoshis} leaves less than dust; lower FEE_SATS`);

    for (let attempt = 0; attempt < 3; attempt += 1) {
        await archiveAllInvitations(engine);
        const created = await engine.createInvitation({
            templateIdentifier,
            actionIdentifier,
            intent: intent as Parameters<Engine['createInvitation']>[0]['intent'],
            variables: [...variables, { variableIdentifier: 'feeSatoshis', roleIdentifier: 'saver', value: feeSatoshis }],
            inputs: [{
                inputIdentifier: 'jarInput',
                outpointTransactionHash: hexToBin(jarTxid),
                outpointIndex: jarVout,
            }],
        });
        const invitationIdentifier = created.invitation.invitationIdentifier;

        await engine.appendInvitation(invitationIdentifier, {
            templateIdentifier,
            actionIdentifier,
            outputs: outputIdentifiers.map((outputIdentifier) => ({ outputIdentifier })),
        });

        for (const inputIndex of await engine.listOwnInputIndexes(invitationIdentifier)) {
            await engine.signInvitation(invitationIdentifier, inputIndex);
        }

        const preview = await verifyInvitationTransaction(engine, invitationIdentifier, 0);
        checkFee(feeSatoshis, preview.transactionByteLength, { satPerByte, cap: maxFeeSatoshis });
        const recommended = feeForVsize(preview.transactionByteLength, satPerByte, maxFeeSatoshis);
        console.log('fee check', 'size', preview.transactionByteLength, 'fee', String(feeSatoshis), 'recommended', String(recommended));

        if (recommended <= feeSatoshis) return { invitationIdentifier, feeSatoshis, preview };
        console.log('rebuilding with higher fee', String(recommended));
        feeSatoshis = recommended;
    }
    throw new Error('fee negotiation did not converge after 3 attempts');
}

export { DUST_LIMIT_SATOSHIS };
