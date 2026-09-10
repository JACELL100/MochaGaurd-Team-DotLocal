// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MochaAnchor
/// @notice Tamper-evidence for MochaGuard risk decisions. Once a day the Merkle root of the
///         full decision log is anchored here. Only hashes touch the chain: no user data.
contract MochaAnchor {
    struct Anchor {
        uint256 day;      // yyyymmdd
        uint256 count;    // number of decisions under the root
        uint256 blockNo;  // block in which the root was anchored
    }

    address public immutable owner;
    mapping(bytes32 => bool) public roots;          // merkleRoot => exists
    mapping(bytes32 => Anchor) public anchors;      // merkleRoot => metadata
    bytes32[] public history;                       // every anchored root, in order

    event Anchored(bytes32 indexed root, uint256 indexed day, uint256 count);

    error OnlyOwner();
    error AlreadyAnchored();

    constructor() {
        owner = msg.sender;
    }

    function anchor(bytes32 root, uint256 day, uint256 count) external {
        if (msg.sender != owner) revert OnlyOwner();
        if (roots[root]) revert AlreadyAnchored();
        roots[root] = true;
        anchors[root] = Anchor({day: day, count: count, blockNo: block.number});
        history.push(root);
        emit Anchored(root, day, count);
    }

    function anchorCount() external view returns (uint256) {
        return history.length;
    }

    /// @notice Sorted-pair Merkle verification. Free `view` call: anyone can check a decision.
    function verify(bytes32 root, bytes32 leaf, bytes32[] calldata proof) external view returns (bool) {
        if (!roots[root]) return false;
        bytes32 h = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 p = proof[i];
            h = h < p ? keccak256(abi.encodePacked(h, p)) : keccak256(abi.encodePacked(p, h));
        }
        return h == root;
    }
}
