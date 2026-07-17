pragma solidity ^0.5.0;

import "../ClaimsManager.sol";
import "../DelegateManagerV2.sol";


contract SameBlockClaimCaller {
    function initiateAndClaimTwice(
        address _claimsManager,
        address _delegateManager,
        address _serviceProvider
    ) external {
        ClaimsManager(_claimsManager).initiateRound();
        DelegateManagerV2(_delegateManager).claimRewards(_serviceProvider);
        DelegateManagerV2(_delegateManager).claimRewards(_serviceProvider);
    }
}
