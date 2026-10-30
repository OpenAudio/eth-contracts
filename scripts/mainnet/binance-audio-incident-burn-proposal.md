# Single-use Binance incident AUDIO burn (draft)

Alternative to PR #3's ongoing arbitrary-holder burn capability. This is a burn, not a freeze or recovery transfer. No deployment, proposal, or on-chain action is performed by this PR.

## Scope

Upgrade the existing AUDIO proxy to `AudiusTokenIncidentBurn`, then call `burnBinanceIncidentBalance()` through Governance. The only target is the constant `0xA97bF7836F8A08F9Ed91D41453D371493FAE8d10`. There are no target or amount parameters and no setter. The function reads the balance when executed and burns the entire balance, reducing total supply by the same amount. It emits Transfer-to-zero and BinanceIncidentBurn(account, amount).

A successful nonzero burn sets the appended `binanceIncidentBurnExecuted` flag. Repeats revert, even after new deposits or rolling back and reinstalling this implementation. An empty balance reverts without setting the flag. A failed voted proposal is not automatically retried: another attempt needs a new proposal or guardian action.

The operation includes incoming deposits present at execution, regardless of provenance. It does not freeze transfers, follow tokens moved elsewhere, reimburse victims, or undo previous transfers. Removing the fixed amount prevents a partial outgoing transfer from invalidating the operation; it does not prevent escape. Confirm incident attribution and attach the actual AUDIO transfer trail with Binance/security responders before submission. The historical balance is not evidence of provenance.

## Authority and execution

The function authenticates the current proxy admin. When Governance is admin, either a passed vote or the guardian acting through `guardianExecuteTransaction` can invoke it. It is NOT vote-enforced. Minters, pausers, holders and the guardian calling the token directly cannot invoke it. Burn authority follows admin changes. Existing upgrade authority can replace this implementation and defeat its restrictions; single-use is not a restriction on future governance upgrades.

The proxy exposes `upgradeTo(address)`, not upgrade-and-call. Ordinary execution uses two proposals:

1. Upgrade: registry key `Token`, value `0`, signature `upgradeTo(address)`, argument the separately deployed and verified implementation address. Do not initialize or reinitialize the proxy.
2. Burn: registry key `Token`, value `0`, signature `burnBinanceIncidentBalance()`, argument calldata `0x` (no arguments and no selector; Governance adds the selector).

An authorized guardian upgrade could instead precede one voted burn proposal. Neither route guarantees the balance remains while waiting. Check live timing and authorities rather than assuming the PR #3 snapshot still applies.

Suggested burn description: "Burn the entire execution-time AUDIO balance of 0xA97bF7836F8A08F9Ed91D41453D371493FAE8d10 once. This includes all deposits present at execution, reduces total supply, and does not reimburse victims. An empty balance reverts; tokens moved elsewhere are unaffected. Requires the reviewed incident-specific implementation upgrade."

## Validation and execution checks

One boolean is appended after inherited storage, with no initializer or edits to the original token. Future implementations must preserve this field and never reuse its slot. The checker verifies the original storage prefix, appended flag, inherited ABI, proxy selector collisions, and the 2022 initializer patch locations. Install dependencies with patch-package enabled and verify deployed bytecode against that patched build.

Run `npm run truffle:compile-all`, then `node scripts/test-audius-token-incident-burn.js`. Optional `--fork` uses isolated Ganache at Ethereum block 26302886; `AUDIO_FORK_RPC` selects an archive RPC. No transactions are sent upstream. The fork checks the real proxy upgrade, initializer rejection, sampled state/permit preservation, burn accounting, and repeat rejection after a later deposit.

For local tests, start Ganache with 50 funded accounts, chainId 1337, port 8546, and `--wallet.unlockedAccounts 0xA97bF7836F8A08F9Ed91D41453D371493FAE8d10`. Local-only impersonation tests outgoing transfers. After compiling, run `truffle test test/*.test.js --network development --compile-none --migrate-none`. Never use production configuration for these tests.

Before execution: independently review implementation bytecode, storage compatibility, incident evidence, live admin/guardian roles and proposal calldata. After execution: verify the flag, burned amount/event, and equal balance/supply reductions. A later implementation rollback does not reverse the burn.
