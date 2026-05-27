// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Sigline} from "../contracts/Sigline.sol";

interface Vm {
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData, address emitter) external;

    function expectRevert() external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function deal(address account, uint256 newBalance) external;
}

contract SiglineActor {
    function post(Sigline registry, string calldata text) external returns (uint256, bytes32) {
        return registry.post(text, "", bytes32(0));
    }

    function buyImagePass(Sigline registry) external payable {
        registry.buyImagePass{value: msg.value}();
    }

    function sweepFees(Sigline registry) external {
        registry.sweepFees();
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
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant SIGLINE_NAME_HASH = keccak256("Sigline");
    bytes32 private constant SIGLINE_VERSION_HASH = keccak256("1");
    bytes32 private constant POST_TYPEHASH = keccak256(
        "SiglinePost(address author,uint256 index,uint64 createdAt,string text,string imageUri,bytes32 imageHash,bytes32 refHash,uint8 refKind)"
    );

    Sigline private registry;
    SiglineActor private actor;

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
    event ProfileUpdated(address indexed account, string nick, string twtUrl, uint64 updatedAt);
    event ProfileCleared(address indexed account);
    event ImagePassPurchased(address indexed account, uint256 amount);
    event TreasurySwept(address indexed treasury, uint256 amount);

    function setUp() public {
        registry = new Sigline(address(this));
        actor = new SiglineActor();
    }

    function testPostIncrementsOnlyCaller() public {
        string memory text = "hello from base";
        uint64 createdAt = uint64(block.timestamp);
        bytes32 expectedHash = _expectedContentHash(
            address(this), 0, createdAt, text, "", bytes32(0), bytes32(0), registry.REF_KIND_NONE()
        );

        vm.expectEmit(true, true, true, true, address(registry));
        emit PostPosted(
            address(this), 0, bytes32(0), createdAt, expectedHash, text, "", bytes32(0), registry.REF_KIND_NONE()
        );

        (uint256 firstIndex, bytes32 firstHash) = registry.post(text, "", bytes32(0));
        assert(firstIndex == 0);
        assert(firstHash == expectedHash);
        assert(registry.postCount(address(this)) == 1);
        Sigline.Line memory firstLine = registry.line(address(this), firstIndex);
        assert(firstLine.contentHash == expectedHash);
        assert(firstLine.createdAt == createdAt);
        assert(firstLine.imageHash == bytes32(0));
        assert(firstLine.refHash == bytes32(0));
        assert(firstLine.refKind == registry.REF_KIND_NONE());

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
        registry.buyImagePass{value: registry.IMAGE_PASS_FEE()}();
        bytes32 expectedHash = _expectedContentHash(
            address(this), 0, createdAt, text, imageUri, imageHash, bytes32(0), registry.REF_KIND_NONE()
        );

        vm.expectEmit(true, true, true, true, address(registry));
        emit PostPosted(
            address(this), 0, bytes32(0), createdAt, expectedHash, text, imageUri, imageHash, registry.REF_KIND_NONE()
        );

        (uint256 index, bytes32 contentHash) = registry.post(text, imageUri, imageHash);
        assert(index == 0);
        assert(contentHash == expectedHash);
        Sigline.Line memory line = registry.line(address(this), index);
        assert(line.contentHash == expectedHash);
        assert(line.createdAt == createdAt);
        assert(line.imageHash == imageHash);
        assert(line.refHash == bytes32(0));
        assert(line.refKind == registry.REF_KIND_NONE());
    }

    function testImagePassGatesImagePosts() public {
        string memory imageUri = "ipfs://bafkreic6encph7qzqg3qg6xv4vl23s7lux7dxry4g6e5fli7dgc7alnlti";
        bytes32 imageHash = sha256("image-bytes");
        uint256 fee = registry.IMAGE_PASS_FEE();

        vm.expectRevert(Sigline.ImagePassRequired.selector);
        registry.post("image", imageUri, imageHash);

        vm.expectRevert(abi.encodeWithSelector(Sigline.IncorrectImagePassFee.selector, fee - 1, fee));
        registry.buyImagePass{value: fee - 1}();

        vm.expectEmit(true, false, false, true, address(registry));
        emit ImagePassPurchased(address(this), fee);
        registry.buyImagePass{value: fee}();
        assert(registry.imagePasses(address(this)));

        vm.expectRevert(Sigline.ImagePassAlreadyPurchased.selector);
        registry.buyImagePass{value: fee}();

        (uint256 index,) = registry.post("image", imageUri, imageHash);
        assert(index == 0);
    }

    function testPostCanReferenceAnotherLine() public {
        string memory text = "reply";
        bytes32 refHash = sha256("parent-line");
        uint8 refKind = registry.REF_KIND_REPLY();
        uint64 createdAt = uint64(block.timestamp);
        bytes32 expectedHash = _expectedContentHash(address(this), 0, createdAt, text, "", bytes32(0), refHash, refKind);

        vm.expectEmit(true, true, true, true, address(registry));
        emit PostPosted(address(this), 0, refHash, createdAt, expectedHash, text, "", bytes32(0), refKind);

        (uint256 index, bytes32 contentHash) = registry.postWithReference(text, "", bytes32(0), refHash, refKind);
        assert(index == 0);
        assert(contentHash == expectedHash);
        Sigline.Line memory line = registry.line(address(this), index);
        assert(line.contentHash == expectedHash);
        assert(line.createdAt == createdAt);
        assert(line.imageHash == bytes32(0));
        assert(line.refHash == refHash);
        assert(line.refKind == refKind);
    }

    function testEip712DomainIsIntrospectable() public view {
        (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        ) = registry.eip712Domain();

        assert(fields == hex"0f");
        assert(_same(name, "Sigline"));
        assert(_same(version, "1"));
        assert(chainId == block.chainid);
        assert(verifyingContract == address(registry));
        assert(salt == bytes32(0));
        assert(extensions.length == 0);
        assert(registry.POST_TYPEHASH() == POST_TYPEHASH);
    }

    function testReferenceOnlyEchoIsValid() public {
        bytes32 refHash = sha256("parent-line");

        (uint256 index,) = registry.postWithReference("", "", bytes32(0), refHash, registry.REF_KIND_ECHO());

        Sigline.Line memory line = registry.line(address(this), index);
        assert(line.refHash == refHash);
        assert(line.refKind == registry.REF_KIND_ECHO());
    }

    function testMissingLinePointerIsEmpty() public view {
        Sigline.Line memory line = registry.line(address(this), 999);
        assert(line.contentHash == bytes32(0));
        assert(line.createdAt == 0);
        assert(line.imageHash == bytes32(0));
        assert(line.refHash == bytes32(0));
        assert(line.refKind == registry.REF_KIND_NONE());
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

    function testRejectsInvalidReference() public {
        bytes32 refHash = sha256("parent-line");
        uint8 refKindNone = registry.REF_KIND_NONE();
        uint8 refKindReply = registry.REF_KIND_REPLY();

        vm.expectRevert(Sigline.ReferenceHashUnexpected.selector);
        registry.postWithReference("reply", "", bytes32(0), refHash, refKindNone);

        vm.expectRevert(Sigline.ReferenceHashRequired.selector);
        registry.postWithReference("reply", "", bytes32(0), bytes32(0), refKindReply);

        vm.expectRevert(Sigline.InvalidReferenceKind.selector);
        registry.postWithReference("reply", "", bytes32(0), refHash, 3);
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
        assert(registry.treasury() == address(this));
        registry.transferOwnership(address(actor));
        assert(registry.owner() == address(this));
        assert(registry.pendingOwner() == address(actor));

        actor.acceptOwnership(registry);
        assert(registry.owner() == address(actor));
        assert(registry.treasury() == address(this));
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

    function testAnyoneCanSweepFeesOnlyToTreasury() public {
        uint256 fee = registry.IMAGE_PASS_FEE();
        uint256 balanceBefore = address(this).balance;

        vm.expectRevert(Sigline.NoFeesToSweep.selector);
        registry.sweepFees();

        registry.buyImagePass{value: fee}();
        assert(address(registry).balance == fee);

        vm.expectEmit(true, false, false, true, address(registry));
        emit TreasurySwept(address(this), fee);
        actor.sweepFees(registry);

        assert(address(registry).balance == 0);
        assert(address(this).balance == balanceBefore);
    }

    receive() external payable {}

    function _same(string memory left, string memory right) private pure returns (bool) {
        return keccak256(bytes(left)) == keccak256(bytes(right));
    }

    function _expectedContentHash(
        address author,
        uint256 index,
        uint64 createdAt,
        string memory text,
        string memory imageUri,
        bytes32 imageHash,
        bytes32 refHash,
        uint8 refKind
    ) private view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH, SIGLINE_NAME_HASH, SIGLINE_VERSION_HASH, block.chainid, address(registry)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                POST_TYPEHASH,
                author,
                index,
                createdAt,
                keccak256(bytes(text)),
                keccak256(bytes(imageUri)),
                imageHash,
                refHash,
                refKind
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }
}
