pragma solidity ^0.5.0;

import "./AudiusToken.sol";


/** Incident-specific outgoing transfer freeze and permissionless burn, without new storage. */
contract AudiusTokenV2 is AudiusToken {
    address public constant BINANCE_INCIDENT_ACCOUNT = 0xA97bF7836F8A08F9Ed91D41453D371493FAE8d10;

    /**
     * @notice Anyone may burn this account's entire current balance, including later deposits.
     * @dev No allowance is required and the caller receives nothing. Like existing burns,
     *      this works while paused. An empty balance produces a zero-value Transfer event.
     */
    function burnBinanceIncidentBalance() external {
        _requireIsInitialized();
        _burn(BINANCE_INCIDENT_ACCOUNT, balanceOf(BINANCE_INCIDENT_ACCOUNT));
    }

    /** @dev Covers transfer and transferFrom, regardless of how an allowance was granted. */
    function _transfer(address sender, address recipient, uint256 amount) internal {
        require(sender != BINANCE_INCIDENT_ACCOUNT, "AudiusToken: Incident account frozen");
        super._transfer(sender, recipient, amount);
    }
}
