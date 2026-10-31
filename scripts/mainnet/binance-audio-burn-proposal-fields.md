# AUDIO incident freeze governance proposal fields

**Name:** Freeze and enable burning of AUDIO at the traced Binance incident recipient

**Description:** Upgrade the AUDIO token proxy to AudiusTokenV2. Once the upgrade executes, outgoing AUDIO transfers from 0xCe9d97EE40Aa605aC117c333B5397839cc3fE807 revert, including transferFrom using existing or new allowances. Anyone may then call burnBinanceIncidentBalance() to destroy this address's entire current AUDIO balance without allowance or payment to the caller. Later deposits can be burned again. Other holders retain their existing transfer behavior. This is a fixed-address change with no new storage or initializer. The upgrade activates the freeze; burning requires a separate permissionless transaction, not a second proposal. The recipient received 19,651,690 AUDIO directly from 0xA97bF7836F8A08F9Ed91D41453D371493FAE8d10 in transaction https://etherscan.io/tx/0x719effbd23406a5ddde01cd323bd68b0af483efd2f63f969639b5a2e4b5a1424. This replaces the target used by proposal 163; resolve that proposal to avoid a later obsolete upgrade. Source and review: PENDING replacement PR URL.

| Field | Value |
| --- | --- |
| Target registry key | `Token` |
| Encoded registry key | `0x546f6b656e000000000000000000000000000000000000000000000000000000` |
| Target proxy | `0x18aAA7115705e8be94bfFEBDE57Af9BFc265B998` |
| Call value | `0` wei |
| Function signature | `upgradeTo(address)` |
| `_newImplementation` argument | **PENDING: deployed and verified AudiusTokenV2 implementation address** |
| Argument calldata without selector | **PENDING: ABI-encoded implementation address after deployment** |

The new implementation address must differ from the obsolete deployment `0xF88688434497364A2848fFafceAC35635E9877aB`. Proposal 163 remains a separate onchain action and is not canceled by submitting this replacement.
