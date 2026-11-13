import type { XOTemplate } from '@xo-cash/types';

/**
 * Layaway Jar
 *
 * A single-saver BCH savings jar with a fixed target and merchant. The jar is a
 * P2SH32 covenant whose UTXO value is its authoritative balance.
 *
 * On-chain rules:
 * - deposit: output 0 must reuse the exact covenant bytecode and carry a
 *   strictly larger value. The target, merchant, saver and jarId stay fixed.
 * - release: the jar input must already hold at least targetSatoshis; output 0
 *   must pay the merchant locking script exactly targetSatoshis. Any excess is
 *   returned to the saver by output 1.
 * - refund: output 0 must pay the saver locking script. The covenant caps the
 *   fee at maxRefundFeeSatoshis (3000 sats).
 *
 * Every path requires a Schnorr signature from the saver key generated for the
 * jar. `jarId` is a random 32-byte salt pushed and dropped at the start of the
 * redeem script, so every jar gets a unique P2SH32 address and key record.
 *
 * The jar balance itself is not embedded in the redeem script: embedding it
 * would change the address on every deposit. The authoritative balance is the
 * UTXO value; `jarSatoshis` is an informational state mirror.
 */
export const layawayJarTemplate: XOTemplate = {
    $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',

    name: 'Layaway Jar',
    description: 'Save BCH toward a fixed target and release it to a merchant, or refund it to the saver.',
    icon: 'jar',

    version: '1',
    supported: [ 'BCH_2023_05', 'BCH_2024_05', 'BCH_2025_05', 'BCH_2026_05' ],

    resources: [
        {
            name: 'XO template documentation',
            description: 'Guide to writing XO templates.',
            url: 'https://stack.xo.cash/blog/2026-08-24-Vision-to-Reality-6-Writing-Templates.html',
        },
        {
            name: 'Pre-kickoff prototype',
            description: 'Public pre-kickoff repository and prototype disclosure.',
            url: 'https://github.com/matrixneoaiagent/layaway-jar-prework',
        },
    ],

    roles: {
        saver: {
            name: 'Saver',
            description: 'The person saving toward the target. Holds the key that authorizes deposits, release and refund.',
            icon: 'saver',
        },
    },

    start: [
        {
            action: 'createJar',
            role: 'saver',
            generate: [ 'saverKey' ],
        },
    ],

    actions: {
        createJar: {
            name: 'Create Layaway Jar',
            description: 'Start a jar with a target, a merchant, a unique jar id and an initial deposit.',
            icon: 'jar',

            roles: {
                saver: {
                    name: 'Create jar',
                    description: 'Choose the target, merchant and initial deposit.',
                    icon: 'saver',

                    generate: [ 'saverKey' ],

                    requirements: {
                        variables: [ 'jarId', 'jarSatoshis', 'targetSatoshis', 'merchantLockingScript', 'saverLockingScript' ],
                    },
                },
            },

            requirements: {
                participants: [
                    { role: 'saver', slots: { min: 1, max: 1 } },
                ],
            },

            transaction: 'createJarTransaction',
        },

        deposit: {
            name: 'Deposit',
            description: 'Add satoshis to the jar. The same jar covenant and jar id are carried forward with a larger balance.',
            icon: 'deposit',

            roles: {
                saver: {
                    requirements: {
                        variables: [ 'jarId', 'jarSatoshis', 'depositedSatoshis', 'targetSatoshis', 'merchantLockingScript', 'saverLockingScript' ],
                        secrets: [ 'saverKey' ],
                    },
                },
            },

            requirements: {
                participants: [
                    { role: 'saver', slots: { min: 1, max: 1 } },
                ],
            },

            transaction: 'depositTransaction',
        },

        release: {
            name: 'Release to Merchant',
            description: 'Pay the merchant the target once the jar holds at least the target plus the miner fee and a dust refund.',
            icon: 'release',

            roles: {
                saver: {
                    requirements: {
                        variables: [
                            'jarId',
                            'jarSatoshis',
                            'targetSatoshis',
                            'merchantLockingScript',
                            'saverLockingScript',
                            'feeSatoshis',
                        ],
                        secrets: [ 'saverKey' ],
                    },
                },
            },

            requirements: {
                participants: [
                    { role: 'saver', slots: { min: 1, max: 1 } },
                ],
            },

            // UI/application gates: the jar must pay target + fee + dust, and the
            // fee must meet the documented minimum. The covenant separately
            // checks the target and destination on-chain.
            conditions: [
                '$(OP_INPUTINDEX OP_UTXOVALUE <targetSatoshis> <feeSatoshis> OP_ADD <dustLimit> OP_ADD OP_GREATERTHANOREQUAL)',
                '$(<feeSatoshis> <minimumFeeSatoshis> OP_GREATERTHANOREQUAL)',
            ],

            transaction: 'releaseTransaction',
        },

        refund: {
            name: 'Refund to Saver',
            description: 'Return the jar balance minus the miner fee to the saver and close the jar.',
            icon: 'refund',

            roles: {
                saver: {
                    requirements: {
                        // All immutable values are required on every follow-up so
                        // the unlock redeem script is compiled from the same values
                        // as the locking script. See docs/ARCHITECTURE.md.
                        variables: [
                            'jarId',
                            'jarSatoshis',
                            'targetSatoshis',
                            'merchantLockingScript',
                            'saverLockingScript',
                            'feeSatoshis',
                        ],
                        secrets: [ 'saverKey' ],
                    },
                },
            },

            requirements: {
                participants: [
                    { role: 'saver', slots: { min: 1, max: 1 } },
                ],
            },

            conditions: [
                '$(OP_INPUTINDEX OP_UTXOVALUE <feeSatoshis> <dustLimit> OP_ADD OP_GREATERTHANOREQUAL)',
                '$(<feeSatoshis> <minimumFeeSatoshis> OP_GREATERTHANOREQUAL)',
            ],

            transaction: 'refundTransaction',
        },
    },

    transactions: {
        createJarTransaction: {
            name: 'Layaway Jar Created',
            description: 'Created a layaway jar with $(<jarSatoshis>) satoshis toward a target of $(<targetSatoshis>) satoshis.',
            icon: 'jar',

            inputs: [],
            outputs: [
                { output: 'initialJarOutput', outputIndex: 0 },
            ],

            version: 2,
            locktime: 0,
            composable: true,
        },

        depositTransaction: {
            name: 'Jar Deposit',
            description: 'Added $(<depositedSatoshis>) satoshis to the jar, bringing it to $(<jarSatoshis> <depositedSatoshis> OP_ADD) satoshis.',
            icon: 'deposit',

            inputs: [
                { input: 'jarInput', inputIndex: 0 },
            ],
            outputs: [
                { output: 'depositJarOutput', outputIndex: 0 },
            ],

            version: 2,
            locktime: 0,
            composable: true,
        },

        releaseTransaction: {
            name: 'Jar Released',
            description: 'Released $(<targetSatoshis>) satoshis to the merchant. The remaining jar balance returned to the saver.',
            icon: 'release',

            inputs: [
                { input: 'jarInput', inputIndex: 0 },
            ],
            outputs: [
                { output: 'merchantOutput', outputIndex: 0 },
                { output: 'releaseRefundOutput', outputIndex: 1 },
            ],

            version: 2,
            locktime: 0,
            composable: true,
        },

        refundTransaction: {
            name: 'Jar Refunded',
            description: 'Refunded the jar balance minus $(<feeSatoshis>) satoshis of miner fee to the saver.',
            icon: 'refund',

            inputs: [
                { input: 'jarInput', inputIndex: 0 },
            ],
            outputs: [
                { output: 'refundOutput', outputIndex: 0 },
            ],

            version: 2,
            locktime: 0,
            composable: true,
        },
    },

    inputs: {
        jarInput: {
            name: 'Jar balance',
            description: 'The layaway jar covenant output holding $(<jarSatoshis>) satoshis.',
            icon: 'jar',

            valueSatoshis: '$(<jarSatoshis>)',
            token: null,
            unlockingScript: 'unlockJar',
        },
    },

    outputs: {
        initialJarOutput: {
            name: 'Layaway Jar',
            description: 'A new jar holding $(<jarSatoshis>) satoshis toward a target of $(<targetSatoshis>) satoshis.',
            icon: 'jar',

            lockingScript: 'jarScript',
            valueSatoshis: '$(<jarSatoshis>)',
            token: null,
        },

        depositJarOutput: {
            name: 'Layaway Jar',
            description: 'The jar carried forward with $(<jarSatoshis> <depositedSatoshis> OP_ADD) satoshis.',
            icon: 'jar',

            lockingScript: 'jarScript',
            valueSatoshis: '$(<jarSatoshis> <depositedSatoshis> OP_ADD)',
            token: null,
        },

        merchantOutput: {
            name: 'Merchant payment',
            description: 'The merchant receives the $(<targetSatoshis>) satoshi target.',
            icon: 'merchant',

            lockingScript: '$(<merchantLockingScript>)',
            valueSatoshis: '$(<targetSatoshis>)',
            token: null,
        },

        releaseRefundOutput: {
            name: 'Saver refund',
            description: 'The part of the jar above the target, after the miner fee, returns to the saver.',
            icon: 'refund',

            lockingScript: '$(<saverLockingScript>)',
            valueSatoshis: '$(<jarSatoshis> <targetSatoshis> OP_SUB <feeSatoshis> OP_SUB)',
            token: null,
        },

        refundOutput: {
            name: 'Saver refund',
            description: 'The jar balance minus the miner fee returns to the saver.',
            icon: 'refund',

            lockingScript: '$(<saverLockingScript>)',
            valueSatoshis: '$(<jarSatoshis> <feeSatoshis> OP_SUB)',
            token: null,
        },
    },

    lockingScripts: {
        jarScript: {
            name: 'Layaway Jar Covenant',
            description: 'Holds the jar balance and enforces deposit, merchant release and saver refund.',
            icon: 'jar',

            lockingType: 'p2sh',
            lockingBytecode: 'jarRedeemBytecode',
            unlockingBytecode: 'unlockJar',

            state: {
                variables: [ 'jarId', 'jarSatoshis', 'targetSatoshis', 'merchantLockingScript', 'saverLockingScript' ],
                secrets: [],
            },

            roles: {
                saver: {
                    state: {
                        variables: [],
                        secrets: [ 'saverKey' ],
                    },

                    actions: [
                        { action: 'deposit', role: 'saver', secrets: [{ saverKey: null }] },
                        { action: 'release', role: 'saver', secrets: [{ saverKey: null }] },
                        { action: 'refund', role: 'saver', secrets: [{ saverKey: null }] },
                    ],

                    balance: {
                        satoshis: true,
                    },

                    // The engine currently normalizes Electrum UTXOs as selectable;
                    // apps must pass the jar input explicitly. See docs/ARCHITECTURE.md.
                    selectable: false,
                },
            },
        },
    },

    scripts: {
        // P2SH32 unlocking entries. The engine appends the redeem script.
        unlockJar: '<saverKey.schnorr_signature.all_outputs> <saverKey.public_key>',

        // Hash of the saver public key for the P2PKH-style signature check.
        saverPublicKeyHash: '<saverKey.public_key> OP_HASH160',

        // Require the saver signature on every spend path.
        enforceSaverSignature: 'OP_DUP OP_HASH160 saverPublicKeyHash OP_EQUALVERIFY OP_CHECKSIGVERIFY',

        // Deposit: the exact same covenant bytecode must continue with a larger value.
        enforceDeposit:
            'OP_0 OP_OUTPUTVALUE OP_BIN2NUM OP_INPUTINDEX OP_UTXOVALUE OP_BIN2NUM OP_GREATERTHAN OP_VERIFY OP_1',

        // Release: the jar must already hold the target; output 0 must pay the
        // merchant exactly the target.
        enforceRelease:
            'OP_INPUTINDEX OP_UTXOVALUE OP_BIN2NUM <targetSatoshis> OP_GREATERTHANOREQUAL OP_VERIFY OP_0 OP_OUTPUTVALUE OP_BIN2NUM <targetSatoshis> OP_NUMEQUAL OP_VERIFY OP_1',

        // Refund: pay the saver script and cap the fee at 3000 sats.
        // NOTE: The cap is inlined because template constants are not exposed
        // inside covenant scripts by the current engine compiler.
        enforceRefund:
            'OP_0 OP_OUTPUTBYTECODE <saverLockingScript> OP_EQUALVERIFY OP_0 OP_OUTPUTVALUE OP_BIN2NUM OP_INPUTINDEX OP_UTXOVALUE OP_BIN2NUM <3000> OP_SUB OP_GREATERTHANOREQUAL OP_VERIFY OP_1',

        // Release is checked before refund so a merchant script equal to the
        // saver script cannot bypass the target check.
        enforceMerchantOrRefund:
            'OP_0 OP_OUTPUTBYTECODE <merchantLockingScript> OP_EQUAL OP_IF enforceRelease OP_ELSE enforceRefund OP_ENDIF',

        // Deposit is detected by output 0 reusing the exact input covenant.
        enforceJarRules:
            'OP_0 OP_OUTPUTBYTECODE OP_INPUTINDEX OP_UTXOBYTECODE OP_EQUAL OP_IF enforceDeposit OP_ELSE enforceMerchantOrRefund OP_ENDIF',

        // Random 32-byte jarId makes every jar's P2SH32 address unique.
        jarRedeemBytecode: '<jarId> OP_DROP enforceSaverSignature enforceJarRules',
    },

    constants: {
        minimumFeeSatoshis: {
            name: 'Minimum miner fee',
            description: 'Documented minimum fee for release and refund actions. Applications should choose at least this value.',
            type: 'satoshis',
            value: 2000n,
        },
        maxRefundFeeSatoshis: {
            name: 'Maximum refund fee',
            description: 'On-chain cap on the fee a refund may take from the jar.',
            type: 'satoshis',
            value: 3000n,
        },
        dustLimit: {
            name: 'Dust limit',
            description: 'Minimum value of the saver refund/change output.',
            type: 'satoshis',
            value: 546n,
        },
    },

    variables: {
        saverKey: {
            name: 'Saver key',
            description: 'The key that authorizes deposits, release and refund.',
            type: 'private_key',
        },
        jarId: {
            name: 'Jar id',
            description: 'A random 32-byte salt that makes this jar address unique.',
            type: 'bytes',
        },
        jarSatoshis: {
            name: 'Jar balance',
            description: 'The current number of satoshis held by the jar.',
            type: 'satoshis',
        },
        depositedSatoshis: {
            name: 'Deposit amount',
            description: 'The number of satoshis to add to the jar.',
            type: 'satoshis',
        },
        targetSatoshis: {
            name: 'Target',
            description: 'The number of satoshis the jar must hold before it can be released to the merchant.',
            type: 'satoshis',
        },
        merchantLockingScript: {
            name: 'Merchant',
            description: 'The locking script that receives the target when the jar is released.',
            type: 'locking_script',
        },
        saverLockingScript: {
            name: 'Saver destination',
            description: 'The locking script that receives refunds and any amount above the target.',
            type: 'locking_script',
        },
        feeSatoshis: {
            name: 'Miner fee',
            description: 'The miner fee taken from the jar on release or refund. At least 2000 sats is recommended.',
            type: 'satoshis',
        },
    },

    icons: [
        { name: 'jar', hash: '0000000000000000000000' },
        { name: 'saver', hash: '0000000000000000000000' },
        { name: 'deposit', hash: '0000000000000000000000' },
        { name: 'release', hash: '0000000000000000000000' },
        { name: 'refund', hash: '0000000000000000000000' },
        { name: 'merchant', hash: '0000000000000000000000' },
    ],
};
