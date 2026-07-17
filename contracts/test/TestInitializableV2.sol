pragma solidity ^0.5.0;

import "../InitializableV2.sol";


/**
 * @dev Allows test-only implementations to be initialized without a proxy.
 *      Production implementations must initialize through an Audius proxy.
 */
contract TestInitializableV2 is InitializableV2 {
    constructor() public {
        // solium-disable-next-line security/no-inline-assembly
        assembly { sstore(0, caller) }
    }
}
