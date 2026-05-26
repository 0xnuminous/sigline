// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTwtxt} from "../contracts/BaseTwtxt.sol";

interface Vm {
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData, address emitter) external;

    function expectRevert() external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
}

contract BaseTwtxtActor {
    function post(BaseTwtxt registry, string calldata text) external returns (uint256, bytes32) {
        return registry.post(text);
    }

    function setProfile(BaseTwtxt registry, string calldata nick, string calldata twtUrl) external {
        registry.setProfile(nick, twtUrl);
    }

    function pause(BaseTwtxt registry) external {
        registry.pause();
    }

    function acceptOwnership(BaseTwtxt registry) external {
        registry.acceptOwnership();
    }
}

contract BaseTwtxtTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    BaseTwtxt private registry;
    BaseTwtxtActor private actor;

    event TweetPosted(
        address indexed author, uint256 indexed index, uint64 indexed createdAt, bytes32 contentHash, string text
    );
    event ProfileUpdated(address indexed account, string nick, string twtUrl, uint64 updatedAt);
    event ProfileCleared(address indexed account);

    function setUp() public {
        registry = new BaseTwtxt(address(this));
        actor = new BaseTwtxtActor();
    }

    function testPostIncrementsOnlyCaller() public {
        string memory text = "hello from base";
        uint64 createdAt = uint64(block.timestamp);
        bytes32 expectedHash =
            keccak256(abi.encode(block.chainid, address(registry), address(this), uint256(0), createdAt, text));

        vm.expectEmit(true, true, true, true, address(registry));
        emit TweetPosted(address(this), 0, createdAt, expectedHash, text);

        (uint256 firstIndex, bytes32 firstHash) = registry.post(text);
        assert(firstIndex == 0);
        assert(firstHash == expectedHash);
        assert(registry.postCount(address(this)) == 1);

        (uint256 actorIndex,) = actor.post(registry, "hello from actor");
        assert(actorIndex == 0);
        assert(registry.postCount(address(actor)) == 1);
        assert(registry.postCount(address(this)) == 1);
    }

    function testRejectsEmptyTweet() public {
        vm.expectRevert(BaseTwtxt.EmptyTweet.selector);
        registry.post("");
    }

    function testRejectsTooLongTweet() public {
        bytes memory text = new bytes(registry.MAX_TWEET_BYTES() + 1);
        for (uint256 i = 0; i < text.length; i++) {
            text[i] = "x";
        }

        vm.expectRevert(
            abi.encodeWithSelector(BaseTwtxt.TweetTooLong.selector, text.length, registry.MAX_TWEET_BYTES())
        );
        registry.post(string(text));
    }

    function testProfileIsOwnedBySender() public {
        vm.expectEmit(true, false, false, true, address(registry));
        emit ProfileUpdated(address(this), "alice", "https://example.org/alice.txt", uint64(block.timestamp));

        registry.setProfile("alice", "https://example.org/alice.txt");
        BaseTwtxt.Profile memory profile = registry.profile(address(this));
        assert(_same(profile.nick, "alice"));
        assert(_same(profile.twtUrl, "https://example.org/alice.txt"));
        assert(profile.updatedAt > 0);

        actor.setProfile(registry, "bob", "https://example.org/bob.txt");
        BaseTwtxt.Profile memory actorProfile = registry.profile(address(actor));
        assert(_same(actorProfile.nick, "bob"));
        assert(_same(actorProfile.twtUrl, "https://example.org/bob.txt"));
    }

    function testRejectsInvalidProfile() public {
        vm.expectRevert(BaseTwtxt.EmptyNick.selector);
        registry.setProfile("", "https://example.org/alice.txt");

        bytes memory nick = new bytes(registry.MAX_NICK_BYTES() + 1);
        for (uint256 i = 0; i < nick.length; i++) {
            nick[i] = "x";
        }

        vm.expectRevert(abi.encodeWithSelector(BaseTwtxt.NickTooLong.selector, nick.length, registry.MAX_NICK_BYTES()));
        registry.setProfile(string(nick), "");
    }

    function testRejectsTooLongProfileUrl() public {
        bytes memory url = new bytes(registry.MAX_URL_BYTES() + 1);
        for (uint256 i = 0; i < url.length; i++) {
            url[i] = "x";
        }

        vm.expectRevert(abi.encodeWithSelector(BaseTwtxt.UrlTooLong.selector, url.length, registry.MAX_URL_BYTES()));
        registry.setProfile("alice", string(url));
    }

    function testClearProfile() public {
        registry.setProfile("alice", "https://example.org/alice.txt");

        vm.expectEmit(true, false, false, true, address(registry));
        emit ProfileCleared(address(this));

        registry.clearProfile();

        BaseTwtxt.Profile memory profile = registry.profile(address(this));
        assert(_same(profile.nick, ""));
        assert(_same(profile.twtUrl, ""));
        assert(profile.updatedAt == 0);
    }

    function testPauseBlocksWrites() public {
        registry.pause();
        assert(registry.paused());

        vm.expectRevert();
        registry.post("paused");

        vm.expectRevert();
        registry.setProfile("alice", "");

        registry.unpause();
        registry.post("unpaused");
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
        vm.expectRevert(BaseTwtxt.OwnershipRenounceDisabled.selector);
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
