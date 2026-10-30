# AUDIO governance burn upgrade and incident burn proposals

Two separate proposals: first add an amount-based governance burn function to the existing AUDIO token proxy, then use it to burn the specified balance at the incident address. No token pause is required.

Implementation and tests: [OpenAudio eth-contracts PR 3](https://github.com/OpenAudio/eth-contracts/pull/3).

## Proposal 1 Enable governance burns

**Name:** Enable governance controlled AUDIO burns

**Description:** Upgrade the AUDIO token proxy to the reviewed AudiusTokenV2 implementation. The upgrade adds governanceBurn(address,uint256), allowing the Governance contract to burn an explicitly specified amount of AUDIO from any address without that address granting allowance. It reduces the holder balance and total supply by the same amount and emits the standard ERC20 Transfer event to the zero address. This grants governance an ongoing arbitrary holder burn capability. The upgrade itself does not burn tokens.

### Minimal protocol change

Add `contracts/erc20/AudiusTokenV2.sol`, inheriting the original `AudiusToken` unchanged. Add one external function:

```solidity
function governanceBurn(address account, uint256 amount) external {
    _requireIsInitialized();
    require(
        msg.sender == AudiusTokenProxyAdmin(address(this)).getAudiusProxyAdminAddress(),
        "AudiusToken: Only callable by Governance"
    );
    _burn(account, amount);
}
```

The interface reads the proxy's existing admin getter. On mainnet that admin is the Governance contract. Minters, pausers, token holders, and the guardian calling the token directly have no burn authority. Guardian actions must execute through Governance. If governance changes the token proxy admin, burn authority follows the new admin, just as upgrade authority does.

There are no new storage fields, initializer calls, roles, or changes to existing methods. `amount` is an integer in base units, with 18 decimals per AUDIO. The inherited ERC20 burn operation rejects the zero address and insufficient balances; zero amounts follow the existing ERC20 behavior. Like the original burn functions, governanceBurn remains callable while paused.

### Dashboard fields

| Field | Value |
| --- | --- |
| Target registry key | `Token` |
| Encoded registry key | `0x546f6b656e000000000000000000000000000000000000000000000000000000` |
| Target proxy | `0x18aAA7115705e8be94bfFEBDE57Af9BFc265B998` |
| Call value | `0` wei |
| Function signature | `upgradeTo(address)` |
| Function argument | Deployed and verified `AudiusTokenV2` implementation address |
| Argument calldata | ABI-encoded implementation address, without the function selector |

**Deployment dependency:** the implementation address and its encoded argument must be filled after deployment and runtime bytecode verification. Do not use the current implementation address as the upgrade argument. No new token proxy or reinitialization is needed.

## Proposal 2 Burn AUDIO at the incident address

**Name:** Burn AUDIO at the Binance incident address

**Description:** Burn 27409671117810725934467774 base units of AUDIO, equal to 27409671.117810725934467774 AUDIO, from 0xA97bF7836F8A08F9Ed91D41453D371493FAE8d10 through governanceBurn(address,uint256). Reduce total supply by the same amount. This is the address nominated for the reported Binance incident. This proposal depends on the governance burn implementation upgrade having executed first.

### Dashboard fields

| Field | Value |
| --- | --- |
| Target registry key | `Token` |
| Encoded registry key | `0x546f6b656e000000000000000000000000000000000000000000000000000000` |
| Target proxy | `0x18aAA7115705e8be94bfFEBDE57Af9BFc265B998` |
| Call value | `0` wei |
| Function signature | `governanceBurn(address,uint256)` |
| `account` argument | `0xA97bF7836F8A08F9Ed91D41453D371493FAE8d10` |
| `amount` argument | `27409671117810725934467774` |

If the dashboard accepts raw argument calldata, use this **without a function selector**:

```text
0x000000000000000000000000a97bf7836f8a08f9ed91d41453d371493fae8d1000000000000000000000000000000000000000000016ac393fa7ab4f8dca0abe
```

Governance prepends selector `0xa89ae7d0` itself. If the dashboard instead displays typed function arguments, enter the address and base-unit amount above and let it encode them. Do not enter the human-readable decimal AUDIO quantity in the uint256 field.

The amount equals the wallet's full balance at Ethereum block **26302886**, hash `0x0fe40da238a80f6c2b6069136ec9063cffbf4c14c1724d2fe77ad6e2a3c70a3e`, October 29, 2026 at 8:29:35 PM PDT. At that block the wallet granted governance zero allowance. Refresh the balance before submission: with an amount-based method, any additional deposits remain, and a balance below the voted amount causes execution to revert. A failed proposal must be replaced with a new proposal; it is not automatically retried. This proposal does not freeze transfers, follow tokens to other addresses, or reimburse victims.

## Submission and execution

Attach the confirmed incident attribution and AUDIO transfer transaction evidence to the burn proposal before submission. The balance snapshot establishes holdings, not provenance. [Public incident reporting](https://atlasum.net/blog/binance-hot-wallet-hack-october-2026) identifies this destination; primary incident confirmation and the AUDIO transaction trail remain to be attached.

The Governance contract is `0x4DEcA517D6817B6510798b7328F2314d3003AbAC`. Submit and execute the upgrade proposal first, verify the proxy implementation, then submit the burn proposal with a refreshed amount. At the snapshot, each vote has a 21,510 block voting period, a 7,170 block execution delay, and a 5 percent stake quorum; Yes weight must exceed No weight. Two sequential proposals take roughly eight days assuming 12 second blocks. Recheck parameters and proposer eligibility before submitting. The guardian can execute either action directly through Governance if its signers authorize that separate emergency route.

After the burn, verify the proposal outcome and receipt, the standard Transfer event from the target to the zero address, and equal reductions in target balance and total supply. A zero balance is expected only if the execution-time balance equals the voted amount.

## Tests and review

The PR includes proxy upgrade tests, authorization and amount boundary tests, state preservation and existing token behavior checks, and an integration test that executes the upgrade and burn through two normal governance votes.

Verified results: **294 passing, zero failing**, with one pre-existing skipped `TODO - Upgrade token` test. All 12 new token tests and the new voted upgrade-and-burn integration test ran and passed. The compiler storage and ABI checks, pinned mainnet-fork test, and lint for the changed code also passed; the governance test file retains its existing unused-variable warnings.

The fork test also checks the 2022 initializer recovery: `initialized` and `initializing` remain at slot 3, and all four inherited initializer signatures reject outsiders, the guardian directly, and Governance after the upgrade. The storage checker explicitly rejects builds missing the repository's OpenZeppelin initializer patch. Install dependencies with the `patch-package` postinstall enabled and verify the deployed runtime against that patched build before proposing the upgrade.

Compile and test using the repository's pinned Node 16 toolchain:

```sh
npm run truffle:compile-all
node scripts/test-audius-token-v2.js
node scripts/test-audius-token-v2.js --fork
```

The verification script checks exact compiler storage layouts and preservation of the original ABI. With `--fork`, it runs only inside an isolated Ganache fork pinned to mainnet block 26302886, using the existing mainnet proxy and Governance contracts. It seeds a permit nonce and allowance before upgrading, compares sampled balances and raw storage, tests unauthorized and over-balance reverts, burns the incident amount, checks the supply reduction and event, and exercises partial burns and existing permit and transferFrom behavior. `AUDIO_FORK_RPC` can specify an Ethereum archive RPC. No transaction is sent to that upstream RPC and no user private key is used.

For the Truffle regression suite, use at least 44 funded accounts so both 40-delegator stress tests execute correctly. For example, start this local chain in another terminal:

```sh
./node_modules/.bin/ganache --server.host 127.0.0.1 --server.port 8546 --chain.chainId 1337 --wallet.totalAccounts 50 --wallet.defaultBalance 1000000 --logging.quiet
```

Then run:

```sh
NODE_OPTIONS=--max-old-space-size=8192 ./node_modules/.bin/truffle test test/*.test.js --network development --compile-none --migrate-none
```

The new tests are in `test/audiusTokenV2.test.js` and `test/governance.test.js`.

Implementation deployment, governance submission, and burn execution are separate actions; none is performed by preparing this PR.
