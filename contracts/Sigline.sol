// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title Sigline
/// @notice Append-only Sigline feed events for Base and Base Sepolia.
/// @dev The contract only accepts native tokens through buyImagePass().
contract Sigline is Ownable2Step, Pausable, EIP712 {
    uint256 public constant MAX_POST_BYTES = 140;
    uint256 public constant MAX_IMAGE_URI_BYTES = 256;
    uint256 public constant MAX_NICK_BYTES = 64;
    uint256 public constant MAX_URL_BYTES = 512;
    uint256 public constant IMAGE_PASS_FEE = 0.01 ether;
    uint8 public constant REF_KIND_NONE = 0;
    uint8 public constant REF_KIND_REPLY = 1;
    uint8 public constant REF_KIND_ECHO = 2;
    bytes32 public constant POST_TYPEHASH = keccak256(
        "SiglinePost(address author,uint256 index,uint64 createdAt,string text,string imageUri,bytes32 imageHash,bytes32 refHash,uint8 refKind)"
    );

    address public immutable treasury;

    struct Profile {
        string nick;
        string twtUrl;
        uint64 updatedAt;
    }

    struct Line {
        bytes32 contentHash;
        uint64 createdAt;
        bytes32 imageHash;
        bytes32 refHash;
        uint8 refKind;
    }

    struct PostInput {
        string text;
        string imageUri;
        bytes32 imageHash;
        bytes32 refHash;
        uint8 refKind;
    }

    mapping(address account => uint256 count) private _postCounts;
    mapping(address account => mapping(uint256 index => Line line)) private _lines;
    mapping(address account => Profile profile) private _profiles;
    mapping(address account => bool enabled) public imagePasses;

    event PostPosted(
        address indexed author,
        uint256 indexed index,
        bytes32 indexed refHash,
        uint64 createdAt,
        bytes32 contentHash,
        string text,
        string imageUri,
        bytes32 imageHash,
        uint8 refKind
    );
    event ImagePassPurchased(address indexed account, uint256 amount);
    event TreasurySwept(address indexed treasury, uint256 amount);
    event ProfileUpdated(address indexed account, string nick, string twtUrl, uint64 updatedAt);
    event ProfileCleared(address indexed account);

    error EmptyPost();
    error PostTooLong(uint256 length, uint256 maxLength);
    error ImageUriTooLong(uint256 length, uint256 maxLength);
    error ImageHashRequired();
    error ImageUriRequired();
    error ImagePassRequired();
    error ImagePassAlreadyPurchased();
    error IncorrectImagePassFee(uint256 value, uint256 required);
    error ReferenceHashRequired();
    error ReferenceHashUnexpected();
    error InvalidReferenceKind();
    error EmptyNick();
    error NickTooLong(uint256 length, uint256 maxLength);
    error UrlTooLong(uint256 length, uint256 maxLength);
    error InvalidTreasury();
    error NoFeesToSweep();
    error NativeTokenNotAccepted();
    error OwnershipRenounceDisabled();

    constructor(address initialOwner) Ownable(initialOwner) EIP712("Sigline", "1") {
        if (initialOwner == address(0)) {
            revert InvalidTreasury();
        }
        treasury = initialOwner;
    }

    function post(string calldata text, string calldata imageUri, bytes32 imageHash)
        external
        whenNotPaused
        returns (uint256 index, bytes32 contentHash)
    {
        return _post(text, imageUri, imageHash, bytes32(0), REF_KIND_NONE);
    }

    function postWithReference(
        string calldata text,
        string calldata imageUri,
        bytes32 imageHash,
        bytes32 refHash,
        uint8 refKind
    ) external whenNotPaused returns (uint256 index, bytes32 contentHash) {
        return _post(text, imageUri, imageHash, refHash, refKind);
    }

    function buyImagePass() external payable whenNotPaused {
        if (imagePasses[msg.sender]) {
            revert ImagePassAlreadyPurchased();
        }
        if (msg.value != IMAGE_PASS_FEE) {
            revert IncorrectImagePassFee(msg.value, IMAGE_PASS_FEE);
        }
        imagePasses[msg.sender] = true;
        emit ImagePassPurchased(msg.sender, msg.value);
    }

    function sweepFees() external {
        uint256 amount = address(this).balance;
        if (amount < 1 wei) {
            revert NoFeesToSweep();
        }
        emit TreasurySwept(treasury, amount);
        Address.sendValue(payable(treasury), amount);
    }

    function _post(string calldata text, string calldata imageUri, bytes32 imageHash, bytes32 refHash, uint8 refKind)
        private
        returns (uint256 index, bytes32 contentHash)
    {
        PostInput memory input =
            PostInput({text: text, imageUri: imageUri, imageHash: imageHash, refHash: refHash, refKind: refKind});
        _validatePost(input);

        index = _postCounts[msg.sender];
        unchecked {
            _postCounts[msg.sender] = index + 1;
        }

        uint64 createdAt = _timestamp();
        contentHash = _contentHash(index, createdAt, input);
        _lines[msg.sender][index] = Line({
            contentHash: contentHash,
            createdAt: createdAt,
            imageHash: input.imageHash,
            refHash: input.refHash,
            refKind: input.refKind
        });

        _emitPostPosted(index, createdAt, contentHash, input);
    }

    function _validatePost(PostInput memory input) private view {
        uint256 textLength = bytes(input.text).length;
        uint256 imageUriLength = bytes(input.imageUri).length;
        if (textLength == 0 && imageUriLength == 0 && input.refKind == REF_KIND_NONE) {
            revert EmptyPost();
        }
        if (textLength > MAX_POST_BYTES) {
            revert PostTooLong(textLength, MAX_POST_BYTES);
        }
        if (imageUriLength > MAX_IMAGE_URI_BYTES) {
            revert ImageUriTooLong(imageUriLength, MAX_IMAGE_URI_BYTES);
        }
        if (imageUriLength > 0 && input.imageHash == bytes32(0)) {
            revert ImageHashRequired();
        }
        if (imageUriLength == 0 && input.imageHash != bytes32(0)) {
            revert ImageUriRequired();
        }
        if (imageUriLength > 0 && !imagePasses[msg.sender]) {
            revert ImagePassRequired();
        }
        if (input.refKind == REF_KIND_NONE && input.refHash != bytes32(0)) {
            revert ReferenceHashUnexpected();
        }
        if (input.refKind != REF_KIND_NONE && input.refHash == bytes32(0)) {
            revert ReferenceHashRequired();
        }
        if (input.refKind > REF_KIND_ECHO) {
            revert InvalidReferenceKind();
        }
    }

    function _contentHash(uint256 index, uint64 createdAt, PostInput memory input) private view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                POST_TYPEHASH,
                msg.sender,
                index,
                createdAt,
                keccak256(bytes(input.text)),
                keccak256(bytes(input.imageUri)),
                input.imageHash,
                input.refHash,
                input.refKind
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function _emitPostPosted(uint256 index, uint64 createdAt, bytes32 contentHash, PostInput memory input) private {
        emit PostPosted(
            msg.sender,
            index,
            input.refHash,
            createdAt,
            contentHash,
            input.text,
            input.imageUri,
            input.imageHash,
            input.refKind
        );
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

    function line(address account, uint256 index) external view returns (Line memory) {
        return _lines[account][index];
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
