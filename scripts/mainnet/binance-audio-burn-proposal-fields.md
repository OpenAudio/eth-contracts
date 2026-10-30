# AUDIO incident freeze governance proposal fields

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
