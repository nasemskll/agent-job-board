// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC — testnet-only stand-in for real USDC (6 decimals, like USDC).
/// @notice TESTNET ONLY. On mainnet this contract is replaced by the real USDC
///         token contract. The deployer mints an initial supply to itself and
///         distributes it to test wallets. No real value.
contract MockUSDC is ERC20 {
    uint8 private constant _DECIMALS = 6;

    constructor() ERC20("Mock USDC", "mUSDC") {
        // 1,000,000 mUSDC to the deployer for test distribution.
        _mint(msg.sender, 1_000_000 * 10 ** _DECIMALS);
    }

    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }
}
