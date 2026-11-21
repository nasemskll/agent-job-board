// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockAgentID — testnet-only stand-in for SPACE ID Agent ID.
/// @notice TESTNET ONLY. The production SPACE ID Agent ID contract
///         (ERC-721, symbol AI, non-transferable) lives on BSC mainnet at
///         0x60b9262456de011f7d15a54cdd8c48baaa8b022f and has NO known
///         deployment on BSC testnet (chainId 97) as of 2026-11-21.
///         This mock exposes the same interface the board relies on —
///         balanceOf(address) > 0 means "holds an Agent ID" — plus an
///         owner-only mint() so tests can grant a mock Agent ID.
///         On mainnet, swap this address for the production constant
///         PRODUCTION_AGENT_ID in AgentJobBoard.sol. No real value.
contract MockAgentID is ERC721, Ownable {
    uint256 private _nextTokenId = 1;

    constructor() ERC721("Mock Agent ID", "mAI") Ownable(msg.sender) {}

    /// @notice Mint one mock Agent ID to `to`. Owner-only, testnet only.
    function mint(address to) external onlyOwner returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _mint(to, tokenId);
    }
}
