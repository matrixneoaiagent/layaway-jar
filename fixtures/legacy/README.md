# Pre-kickoff prototype artifacts

These files are the serialized artifacts from the pre-kickoff prototype. They
are kept for disclosure and comparison, not for reuse with the final template.

- `pre-kickoff.template.json` — serialized prototype template,
  id `cc1642c92847c561e55dac1c330d5c08f477af91054588878c8c664aec5bb839`.
- `createJar-invitation.json`, `deposit-invitation.json`,
  `release-invitation.json`, `refund-invitation.json` — serialized invitations
  for the prototype's Chipnet transactions.

The final template (`../layaway-jar.template.json`) has a different identifier
(`bc076569ef069e2141b74f21382d50c7ba552ef8182d0076b4ded899c0089a6e`) because it
adds the `jarId` salt and the explicit `feeSatoshis` model. Old invitations will
not resolve against the final template.

The prototype transactions are listed in the root README. No mnemonic, private
key or WIF is present in any of these files.
