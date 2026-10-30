pragma solidity ^0.5.0;

import "./AudiusToken.sol";


interface IncidentBurnProxyAdmin {
    function getAudiusProxyAdminAddress() external view returns (address);
}


contract AudiusTokenV2 is AudiusToken {
    address public constant BINANCE_INCIDENT_ACCOUNT = 0xA97bF7836F8A08F9Ed91D41453D371493FAE8d10;

    // Preserve this appended slot in future upgrades.
    bool public binanceIncidentBurnExecuted;

    event BinanceIncidentBurn(address indexed account, uint256 amount);

    /**
     * @notice Burn the incident account's current balance once.
     * @dev Also callable by the guardian through Governance, including while paused.
     */
    function burnBinanceIncidentBalance() external {
        _requireIsInitialized();
        require(
            msg.sender == IncidentBurnProxyAdmin(address(this)).getAudiusProxyAdminAddress(),
            "AudiusToken: Only callable by Governance"
        );
        require(!binanceIncidentBurnExecuted, "AudiusToken: Incident burn already executed");
        uint256 amount = balanceOf(BINANCE_INCIDENT_ACCOUNT);
        require(amount > 0, "AudiusToken: Incident balance is zero");
        binanceIncidentBurnExecuted = true;
        _burn(BINANCE_INCIDENT_ACCOUNT, amount);
        emit BinanceIncidentBurn(BINANCE_INCIDENT_ACCOUNT, amount);
    }
}
