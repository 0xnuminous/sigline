// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Sigline} from "../contracts/Sigline.sol";

interface Vm {
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData, address emitter) external;

    function expectRevert() external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
}

contract SiglineActor {
    function post(Sigline registry, string calldata text) external returns (uint256, bytes32) {
        return registry.post(text, "", bytes32(0));
    }

    function setProfile(Sigline registry, string calldata nick, string calldata twtUrl) external {
        registry.setProfile(nick, twtUrl);
    }

    function pause(Sigline registry) external {
        registry.pause();
    }

    function acceptOwnership(Sigline registry) external {
        registry.acceptOwnership();
    }
}

contract SiglineTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    Sigline private registry;
    SiglineActor private actor;

    event PostPosted(
        address indexed author,
        uint256 indexed index,
        uint64 indexed createdAt,
        bytes32 contentHash,
        string text,
        string imageUri,
        bytes32 imageHash
    );
    event ProfileUpdated(address indexed account, string nick, string twtUrl, uint64 updatedAt);
    event ProfileCleared(address indexed account);

    function setUp() public {
        registry = new Sigline(address(this));
        actor = new SiglineActor();
    }

    function testPostIncrementsOnlyCaller() public {
        string memory text = "hello from base";
        uint64 createdAt = uint64(block.timestamp);
        bytes32 expectedHash = keccak256(
            abi.encode(block.chainid, address(registry), address(this), uint256(0), createdAt, text, "", bytes32(0))
        );

        vm.expectEmit(true, true, true, true, address(registry));
        emit PostPosted(address(this), 0, createdAt, expectedHash, text, "", bytes32(0));

        (uint256 firstIndex, bytes32 firstHash) = registry.post(text, "", bytes32(0));
        assert(firstIndex == 0);
        assert(firstHash == expectedHash);
        assert(registry.postCount(address(this)) == 1);
        Sigline.Line memory firstLine = registry.line(address(this), firstIndex);
        assert(firstLine.contentHash == expectedHash);
        assert(firstLine.createdAt == createdAt);
        assert(firstLine.imageHash == bytes32(0));

        (uint256 actorIndex,) = actor.post(registry, "hello from actor");
        assert(actorIndex == 0);
        assert(registry.postCount(address(actor)) == 1);
        assert(registry.postCount(address(this)) == 1);
    }

    function testRejectsEmptyPost() public {
        vm.expectRevert(Sigline.EmptyPost.selector);
        registry.post("", "", bytes32(0));
    }

    function testRejectsTooLongPost() public {
        bytes memory text = new bytes(registry.MAX_POST_BYTES() + 1);
        for (uint256 i = 0; i < text.length; i++) {
            text[i] = "x";
        }

        vm.expectRevert(abi.encodeWithSelector(Sigline.PostTooLong.selector, text.length, registry.MAX_POST_BYTES()));
        registry.post(string(text), "", bytes32(0));
    }

    function testPostCanIncludeImageUriAndHash() public {
        string memory text = "image";
        string memory imageUri = "ipfs://bafkreic6encph7qzqg3qg6xv4vl23s7lux7dxry4g6e5fli7dgc7alnlti";
        bytes32 imageHash = sha256("image-bytes");
        uint64 createdAt = uint64(block.timestamp);
        bytes32 expectedHash = keccak256(
            abi.encode(
                block.chainid, address(registry), address(this), uint256(0), createdAt, text, imageUri, imageHash
            )
        );

        vm.expectEmit(true, true, true, true, address(registry));
        emit PostPosted(address(this), 0, createdAt, expectedHash, text, imageUri, imageHash);

        (uint256 index, bytes32 contentHash) = registry.post(text, imageUri, imageHash);
        assert(index == 0);
        assert(contentHash == expectedHash);
        Sigline.Line memory line = registry.line(address(this), index);
        assert(line.contentHash == expectedHash);
        assert(line.createdAt == createdAt);
        assert(line.imageHash == imageHash);
    }

    function testMissingLinePointerIsEmpty() public view {
        Sigline.Line memory line = registry.line(address(this), 999);
        assert(line.contentHash == bytes32(0));
        assert(line.createdAt == 0);
        assert(line.imageHash == bytes32(0));
    }

    function testRejectsImageWithoutHash() public {
        vm.expectRevert(Sigline.ImageHashRequired.selector);
        registry.post("image", "ipfs://cid", bytes32(0));
    }

    function testRejectsImageHashWithoutUri() public {
        bytes32 imageHash = sha256("image-bytes");
        vm.expectRevert(Sigline.ImageUriRequired.selector);
        registry.post("image", "", imageHash);
    }

    function testRejectsTooLongImageUri() public {
        string memory uri =
            "ipfs://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        bytes32 imageHash = sha256("image-bytes");

        vm.expectRevert(
            abi.encodeWithSelector(Sigline.ImageUriTooLong.selector, bytes(uri).length, registry.MAX_IMAGE_URI_BYTES())
        );
        registry.post("image", uri, imageHash);
    }

    function testProfileIsOwnedBySender() public {
        vm.expectEmit(true, false, false, true, address(registry));
        emit ProfileUpdated(address(this), "alice", "https://example.org/alice.txt", uint64(block.timestamp));

        registry.setProfile("alice", "https://example.org/alice.txt");
        Sigline.Profile memory profile = registry.profile(address(this));
        assert(_same(profile.nick, "alice"));
        assert(_same(profile.twtUrl, "https://example.org/alice.txt"));
        assert(profile.updatedAt > 0);

        actor.setProfile(registry, "bob", "https://example.org/bob.txt");
        Sigline.Profile memory actorProfile = registry.profile(address(actor));
        assert(_same(actorProfile.nick, "bob"));
        assert(_same(actorProfile.twtUrl, "https://example.org/bob.txt"));
    }

    function testRejectsInvalidProfile() public {
        vm.expectRevert(Sigline.EmptyNick.selector);
        registry.setProfile("", "https://example.org/alice.txt");

        bytes memory nick = new bytes(registry.MAX_NICK_BYTES() + 1);
        for (uint256 i = 0; i < nick.length; i++) {
            nick[i] = "x";
        }

        vm.expectRevert(abi.encodeWithSelector(Sigline.NickTooLong.selector, nick.length, registry.MAX_NICK_BYTES()));
        registry.setProfile(string(nick), "");
    }

    function testRejectsTooLongProfileUrl() public {
        bytes memory url = new bytes(registry.MAX_URL_BYTES() + 1);
        for (uint256 i = 0; i < url.length; i++) {
            url[i] = "x";
        }

        vm.expectRevert(abi.encodeWithSelector(Sigline.UrlTooLong.selector, url.length, registry.MAX_URL_BYTES()));
        registry.setProfile("alice", string(url));
    }

    function testClearProfile() public {
        registry.setProfile("alice", "https://example.org/alice.txt");

        vm.expectEmit(true, false, false, true, address(registry));
        emit ProfileCleared(address(this));

        registry.clearProfile();

        Sigline.Profile memory profile = registry.profile(address(this));
        assert(_same(profile.nick, ""));
        assert(_same(profile.twtUrl, ""));
        assert(profile.updatedAt == 0);
    }

    function testPauseBlocksWrites() public {
        registry.pause();
        assert(registry.paused());

        vm.expectRevert();
        registry.post("paused", "", bytes32(0));

        vm.expectRevert();
        registry.setProfile("alice", "");

        registry.unpause();
        registry.post("unpaused", "", bytes32(0));
        assert(registry.postCount(address(this)) == 1);
    }

    function testNonOwnerCannotPause() public {
        try actor.pause(registry) {
            assert(false);
        } catch (bytes memory) {
            assert(true);
        }
    }

    function testOwnershipTransferIsTwoStep() public {
        registry.transferOwnership(address(actor));
        assert(registry.owner() == address(this));
        assert(registry.pendingOwner() == address(actor));

        actor.acceptOwnership(registry);
        assert(registry.owner() == address(actor));
    }

    function testOwnerCannotRenounceOwnership() public {
        vm.expectRevert(Sigline.OwnershipRenounceDisabled.selector);
        registry.renounceOwnership();
        assert(registry.owner() == address(this));
    }

    function testRejectsNativeTokenTransfers() public {
        (bool success,) = address(registry).call{value: 1 wei}("");
        assert(!success);

        (bool fallbackSuccess,) = address(registry).call{value: 1 wei}(hex"1234");
        assert(!fallbackSuccess);
    }

    function _same(string memory left, string memory right) private pure returns (bool) {
        return keccak256(bytes(left)) == keccak256(bytes(right));
    }
}
