// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title Sigline
/// @notice Append-only Sigline feed events for Base and Base Sepolia.
/// @dev The contract does not custody native tokens or ERC-20 tokens.
contract Sigline is Ownable2Step, Pausable {
    uint256 public constant MAX_POST_BYTES = 560;
    uint256 public constant MAX_NICK_BYTES = 64;
    uint256 public constant MAX_URL_BYTES = 512;

    struct Profile {
        string nick;
        string twtUrl;
        uint64 updatedAt;
    }

    mapping(address account => uint256 count) private _postCounts;
    mapping(address account => Profile profile) private _profiles;

    event PostPosted(
        address indexed author, uint256 indexed index, uint64 indexed createdAt, bytes32 contentHash, string text
    );
    event ProfileUpdated(address indexed account, string nick, string twtUrl, uint64 updatedAt);
    event ProfileCleared(address indexed account);

    error EmptyPost();
    error PostTooLong(uint256 length, uint256 maxLength);
    error EmptyNick();
    error NickTooLong(uint256 length, uint256 maxLength);
    error UrlTooLong(uint256 length, uint256 maxLength);
    error NativeTokenNotAccepted();
    error OwnershipRenounceDisabled();

    constructor(address initialOwner) Ownable(initialOwner) {}

    function post(string calldata text) external whenNotPaused returns (uint256 index, bytes32 contentHash) {
        uint256 textLength = bytes(text).length;
        if (textLength == 0) {
            revert EmptyPost();
        }
        if (textLength > MAX_POST_BYTES) {
            revert PostTooLong(textLength, MAX_POST_BYTES);
        }

        index = _postCounts[msg.sender];
        unchecked {
            _postCounts[msg.sender] = index + 1;
        }

        uint64 createdAt = _timestamp();
        contentHash = keccak256(abi.encode(block.chainid, address(this), msg.sender, index, createdAt, text));

        emit PostPosted(msg.sender, index, createdAt, contentHash, text);
    }

    function setProfile(string calldata nick, string calldata twtUrl) external whenNotPaused {
        uint256 nickLength = bytes(nick).length;
        if (nickLength == 0) {
            revert EmptyNick();
        }
        if (nickLength > MAX_NICK_BYTES) {
            revert NickTooLong(nickLength, MAX_NICK_BYTES);
        }

        uint256 urlLength = bytes(twtUrl).length;
        if (urlLength > MAX_URL_BYTES) {
            revert UrlTooLong(urlLength, MAX_URL_BYTES);
        }

        uint64 updatedAt = _timestamp();
        _profiles[msg.sender] = Profile({nick: nick, twtUrl: twtUrl, updatedAt: updatedAt});
        emit ProfileUpdated(msg.sender, nick, twtUrl, updatedAt);
    }

    function clearProfile() external whenNotPaused {
        delete _profiles[msg.sender];
        emit ProfileCleared(msg.sender);
    }

    function postCount(address account) external view returns (uint256) {
        return _postCounts[account];
    }

    function profile(address account) external view returns (Profile memory) {
        return _profiles[account];
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function renounceOwnership() public view override onlyOwner {
        revert OwnershipRenounceDisabled();
    }

    receive() external payable {
        revert NativeTokenNotAccepted();
    }

    fallback() external payable {
        revert NativeTokenNotAccepted();
    }

    function _timestamp() private view returns (uint64) {
        return uint64(block.timestamp);
    }
}
