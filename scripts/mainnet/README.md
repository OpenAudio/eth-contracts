# ClaimsManager incident response

These scripts default to a dry run and refuse non-mainnet RPCs.

## Initializer provenance

The active mainnet ClaimsManager implementation was deployed during the July
2022 governance recovery. Its initializer uses two padding slots so the
initialization flags live in slot 3 and requires the existing proxy admin to be
the caller.

The repository-wide OpenZeppelin patch reproduces the production padding and
proxy-admin caller check. `AudiusAdminUpgradeabilityProxy` temporarily stores
the deployer as proxy admin while its constructor delegate-calls initialization,
then stores the requested final admin before construction completes. This keeps
fresh deployment atomic while making the shared initializer match production.

`ClaimsManagerV2` inherits the repository's existing `InitializableV2` wrapper
over that patched OpenZeppelin contract.

Compile with the repository's pinned Node 16 toolchain:

```sh
npm run truffle:compile-all
```

Set `ETH_LIVE_NETWORK` to a mainnet HTTPS RPC URL. Set
`ETH_WALLET_PRIVATE_KEY` only when adding `--execute`.

## 1. Deploy the implementation

Use Audius Deployer `0xde21d46753633a177223faa6e56e8f6cd24cca04`:

```sh
node scripts/mainnet/deploy-claims-manager-v2.js
node scripts/mainnet/deploy-claims-manager-v2.js --execute
```

## 2. Submit the full-balance slash proposal

Use staked proposer `0x683A3C882e1DCD0A3012E2D45A47A9e8de8868d7`:

```sh
node scripts/mainnet/propose-full-offender-slash.js
node scripts/mainnet/propose-full-offender-slash.js --execute
```

The script reads the live balance and pending withdrawal, requires both to equal
`1956663379000963316690207` base units, simulates the exact slash from the
Governance address, and checks that voting plus execution delay fits before the
withdrawal expiry with a default 1,000-block safety buffer.

## 3. Submit the ClaimsManager upgrade proposal

Use the same staked proposer. Pass the deployed implementation address:

```sh
node scripts/mainnet/propose-claims-manager-v2-upgrade.js 0xIMPLEMENTATION
node scripts/mainnet/propose-claims-manager-v2-upgrade.js 0xIMPLEMENTATION --execute
```

The script requires the address's runtime bytecode to exactly match the locally
compiled `ClaimsManagerV2` artifact before it can submit a proposal.
