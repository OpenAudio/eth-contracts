# Targeted AUDIO freeze and permissionless burn

One governance proposal upgrades the AUDIO proxy. Execution immediately prevents outgoing transfers from `0xA97bF7836F8A08F9Ed91D41453D371493FAE8d10`. Anyone can subsequently burn its entire current balance. No second governance proposal or activation transaction is needed to freeze it. Merging the GitHub PR does not change onchain behavior.

## Minimal protocol change

`AudiusTokenV2` inherits the existing `AudiusToken` unchanged and adds:

- A constant incident address, with no configurable list or setter.
- An internal `_transfer` override rejecting this sender. Both `transfer` and `transferFrom` use it, so existing allowances and allowances created by `approve`, allowance adjustments, or `permit` cannot move its AUDIO out.
- `burnBinanceIncidentBalance()`, callable by anyone without allowance, burning only that constant address's execution-time balance. The caller cannot select a different holder or amount and receives nothing.

There are no new storage fields, roles, initializer calls, dependencies, or single-use flags. Burns reduce balance and supply equally and emit the inherited `Transfer(account, address(0), amount)` event. They work while paused, matching existing burn behavior. Calling on an empty balance succeeds with a zero-value event. Later deposits remain frozen and can be burned by another call.

This deliberately freezes outgoing AUDIO balances only. Incoming transfers and authorized minting remain possible, so sending AUDIO to this address exposes it to burning. Approvals, permits and voluntary burns are still allowed; approvals cannot bypass the transfer check. The address can still act as a spender for other holders who authorize it. This is not a ban on all Ethereum activity and does not recover AUDIO already moved elsewhere. Governance can remove the freeze with another implementation upgrade; rollback cannot restore burned tokens.

## Governance proposal

**Name:** Freeze and enable burning of AUDIO at the Binance incident address

**Description:** Upgrade the AUDIO token proxy to AudiusTokenV2. Once the upgrade executes, outgoing AUDIO transfers from 0xA97bF7836F8A08F9Ed91D41453D371493FAE8d10 revert, including transferFrom using existing or new allowances. Anyone may then call burnBinanceIncidentBalance() to destroy this address's entire current AUDIO balance without allowance or payment to the caller. Later deposits can be burned again. Other holders retain their existing transfer behavior. This is a fixed-address change with no new storage or initializer. The upgrade activates the freeze; burning requires a separate permissionless transaction, not a second proposal. Incident attribution and transaction evidence must accompany the submitted proposal.

| Field | Value |
| --- | --- |
| Target registry key | `Token` |
| Encoded registry key | `0x546f6b656e000000000000000000000000000000000000000000000000000000` |
| Target proxy | `0x18aAA7115705e8be94bfFEBDE57Af9BFc265B998` |
| Call value | `0` wei |
| Function signature | `upgradeTo(address)` |
| `_newImplementation` argument | **PENDING: deployed and verified AudiusTokenV2 implementation address** |
| Argument calldata without selector | **PENDING: ABI-encoded implementation address after deployment** |

Governance (`0x4DEcA517D6817B6510798b7328F2314d3003AbAC`) executes `upgradeTo(address)` against the existing Token registry entry. Deploy and verify the implementation first, then fill the pending implementation address and its ABI-encoded argument. Governance prepends the selector itself. Do not initialize the proxy again.

After proposal execution, verify the proxy's implementation address and that simulated outgoing `transfer` and `transferFrom` calls from the incident balance revert with `AudiusToken: Incident account frozen`. The balance is not automatically destroyed by the upgrade.

## Permissionless burn transaction after upgrade

Any caller may submit this direct transaction to the AUDIO proxy; it does not go through a new governance vote:

| Field | Value |
| --- | --- |
| To | `0x18aAA7115705e8be94bfFEBDE57Af9BFc265B998` |
| Value | `0` wei |
| Function | `burnBinanceIncidentBalance()` |
| Arguments | None |
| Transaction data | `0xf82c1b29` |

The burn uses the live balance, not a snapshot amount. Verify the receipt's `Transfer` event to the zero address and matching balance/supply reductions. Any subsequent deposits can be burned again using the same call.

## Upgrade and initializer safety

Keep the repository's `@openzeppelin/upgrades` patch applied via the normal `patch-package` postinstall. It preserves the Audius recovery layout: proxy admin at slot 0; OpenZeppelin `initialized` and `initializing` at slot 3, offsets 0 and 1. Neither this implementation nor its upgrade introduces an initializer. The verification script compares all 26 compiler storage entries, pins those recovery slots, preserves the old ABI, and checks new selectors against proxy selectors. Deploy from this patched build and verify its runtime bytecode before submitting the proposal.

## Validation

Verified on the replacement branch: **293 passing, zero failing, one pre-existing skipped test** (`TODO - Upgrade token`). All 11 focused token tests and the new single-vote governance integration test passed. The pinned mainnet fork, compiler storage/ABI/selector checks, compilation, changed-code lint and whitespace checks passed. Governance tests retain four existing unused-variable lint warnings.

The regression tests cover immediate direct and delegated transfer rejection, pre-upgrade and new allowances, full-balance and repeat burns, incoming transfers/mints after burning, empty burns, pause/unpause, supply and event accounting, no caller reward, ordinary transfers and signed permits for other holders, all inherited reinitializers, and rollback/re-upgrade. A governance integration test executes one voted upgrade and burns from an unrelated account afterward.

The isolated mainnet-fork test uses block **26302886** with the actual token proxy and Governance contract. At that block the incident address holds **27409671117810725934467774** base units. This snapshot establishes holdings, not incident attribution. The fork checks upgrade state preservation, all four inherited initializers against outsider/guardian/Governance callers, existing/new allowance freeze enforcement, permissionless burn accounting, empty repeats and later-deposit burns. The upstream RPC receives reads only; all deployments and transactions occur on the local fork.

Run with dependencies installed and a local Ganache chain (chain ID 1337, at least 50 funded accounts for the full repository suite). The token test impersonates the fixed address using Ganache-only RPC methods; no incident private key is needed.

```sh
npm run truffle:compile-all
node scripts/test-audius-token-v2.js
node scripts/test-audius-token-v2.js --fork
# development defaults to localhost:8546; use --config for another local port
NODE_OPTIONS=--max-old-space-size=8192 npx truffle test test/*.test.js --network development --compile-none --migrate-none
```

Additional compatibility validation passed: **281 existing protocol tests**, with one pre-existing skip, using verified V2 runtime bytecode in 186 shared token fixtures. After an incident-sized burn, all **17 staking, 15 claims and four bridge tests** passed; the staking run uses the corrected integer assertion. The voted upgrade/burn integration test also passed with explicit checks that existing staking collateral, total recorded stake and both active stakers' positions remain unchanged across the burn.

The existing protocol scenarios can also run with V2 in every shared token fixture. This separate test configuration verifies the implementation runtime bytecode and excludes the dedicated upgrade tests, which require a V1 starting fixture and run under the normal configuration above:

```sh
NODE_OPTIONS=--max-old-space-size=8192 npx truffle test test/*.test.js --network development --config scripts/truffle-audius-token-v2.js --compile-none --migrate-none
AUDIO_TEST_BURN=1 NODE_OPTIONS=--max-old-space-size=8192 npx truffle test test/staking.test.js test/claimsManager.test.js test/wormholeClient.test.js --network development --config scripts/truffle-audius-token-v2.js --compile-none --migrate-none
```

`AUDIO_TEST_PORT` overrides the local development port. The second command transfers the incident snapshot amount to the target and burns it in each fixture before exercising staking, claims and bridge behavior. The staking slashing assertion uses exact integer arithmetic so it also checks supplies that cannot be represented exactly by a JavaScript Number.

`AUDIO_FORK_RPC` may override the script's default archive RPC. Test results and the reviewed commit are recorded in the PR. No implementation has been deployed and no live governance proposal or burn transaction has been submitted by this work.
