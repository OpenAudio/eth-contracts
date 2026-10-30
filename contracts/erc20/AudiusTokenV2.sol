pragma solidity ^0.5.0;

import "./AudiusToken.sol";


interface AudiusTokenProxyAdmin {
    function getAudiusProxyAdminAddress() external view returns (address);
}


/** AUDIO upgrade adding governance-only burns without new storage. */
contract AudiusTokenV2 is AudiusToken {
    /**
     * @notice Burn an amount from an account without allowance.
     * @dev Only the token proxy admin (Governance) may call this function.
     *      Reads the existing proxy admin through the proxy's own getter.
     *      Like the existing burn functions, this is callable while paused.
     * @param account - account whose tokens will be burned
     * @param amount - amount to burn in token base units
     */
    function governanceBurn(address account, uint256 amount) external {
        _requireIsInitialized();
        require(
            msg.sender == AudiusTokenProxyAdmin(address(this)).getAudiusProxyAdminAddress(),
            "AudiusToken: Only callable by Governance"
        );
        _burn(account, amount);
    }
}
