// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "forge-std/Test.sol";
import {DuelEscrow} from "../src/DuelEscrow.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract MockG is ERC20Permit {
    constructor() ERC20("GoodDollar", "G$") ERC20Permit("GoodDollar") {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

contract DuelEscrowTest is Test {
    DuelEscrow escrow;
    MockG g;

    address ubi = makeAddr("ubi");
    address validator = makeAddr("validator");
    address owner = address(this);

    address alice; uint256 alicePk;
    address bob;   uint256 bobPk;
    address carol; uint256 carolPk;
    address dave;  uint256 davePk; // fresh, no pre-approval (permit tests)

    uint256 constant STAKE = 100e18;
    bytes32 constant OPEN = bytes32(0);
    bytes32 constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    function setUp() public {
        (alice, alicePk) = makeAddrAndKey("alice");
        (bob, bobPk)     = makeAddrAndKey("bob");
        (carol, carolPk) = makeAddrAndKey("carol");
        (dave, davePk)   = makeAddrAndKey("dave");

        g = new MockG();
        escrow = new DuelEscrow(address(g), ubi, validator);

        address[3] memory who = [alice, bob, carol];
        for (uint256 i = 0; i < who.length; i++) {
            g.mint(who[i], 1000e18);
            vm.prank(who[i]);
            g.approve(address(escrow), type(uint256).max);
        }
        g.mint(dave, 1000e18); // NOTE: dave does NOT approve (permit path only)
    }

    // ── helpers ──────────────────────────────────────────────────────────────
    function _duel() internal returns (uint256 id) {
        vm.prank(alice);
        id = escrow.createRoom(1, STAKE, 0, 2, uint64(block.timestamp + 24 hours), OPEN, 500);
    }

    function _scores2(uint256 a, uint256 b) internal pure returns (uint256[] memory s) {
        s = new uint256[](2); s[0] = a; s[1] = b;
    }

    function _permitSig(uint256 pk, address holder, uint256 value, uint256 deadline)
        internal view returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, holder, address(escrow), value, g.nonces(holder), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", g.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    // ── Constructor ────────────────────────────────────────────────────────────
    function test_Constructor_RejectsZeroAddresses() public {
        vm.expectRevert(DuelEscrow.ZeroAddress.selector);
        new DuelEscrow(address(0), ubi, validator);
        vm.expectRevert(DuelEscrow.ZeroAddress.selector);
        new DuelEscrow(address(g), address(0), validator);
        vm.expectRevert(DuelEscrow.ZeroAddress.selector);
        new DuelEscrow(address(g), ubi, address(0));
    }

    // ── createRoom · validation branches ────────────────────────────────────────
    function test_Create_RejectsNoValue() public {
        vm.prank(alice);
        vm.expectRevert(DuelEscrow.NoValue.selector);
        escrow.createRoom(0, 0, 0, 2, uint64(block.timestamp + 1 hours), OPEN, 0);
    }
    function test_Create_RejectsCapacityTooLow() public {
        vm.prank(alice);
        vm.expectRevert(DuelEscrow.BadCapacity.selector);
        escrow.createRoom(0, STAKE, 0, 1, uint64(block.timestamp + 1 hours), OPEN, 0);
    }
    function test_Create_RejectsCapacityTooHigh() public {
        vm.prank(alice);
        vm.expectRevert(DuelEscrow.BadCapacity.selector);
        escrow.createRoom(0, STAKE, 0, 257, uint64(block.timestamp + 1 hours), OPEN, 0);
    }
    function test_Create_RejectsDeadlineTooSoon() public {
        vm.prank(alice);
        vm.expectRevert(DuelEscrow.DeadlineTooSoon.selector);
        escrow.createRoom(0, STAKE, 0, 2, uint64(block.timestamp + 10), OPEN, 0);
    }
    function test_Create_RejectsDeadlineTooFar() public {
        vm.prank(alice);
        vm.expectRevert(DuelEscrow.DeadlineTooFar.selector);
        escrow.createRoom(0, STAKE, 0, 2, uint64(block.timestamp + 31 days), OPEN, 0);
    }
    function test_Create_PublicStake() public {
        uint256 id = _duel();
        assertEq(g.balanceOf(address(escrow)), STAKE);
        DuelEscrow.Room memory room = escrow.getRoom(id);
        assertEq(room.creator, alice);
        assertEq(room.joinCodeHash, bytes32(0));
        assertEq(escrow.playerCount(id), 1);
    }
    function test_Create_PrivateMarked() public {
        bytes32 h = keccak256(bytes("code"));
        vm.prank(alice);
        uint256 id = escrow.createRoom(0, STAKE, 0, 2, uint64(block.timestamp + 1 hours), h, 0);
        assertTrue(escrow.getRoom(id).joinCodeHash != bytes32(0));
    }

    // ── join · guards + code ─────────────────────────────────────────────────────
    function test_Join_PublicNoCode() public {
        uint256 id = _duel();
        vm.prank(bob); escrow.joinRoom(id, "");
        assertEq(escrow.playerCount(id), 2);
    }
    function test_Join_PrivateGoodCode() public {
        vm.prank(alice);
        uint256 id = escrow.createRoom(1, STAKE, 0, 2, uint64(block.timestamp + 1 hours), keccak256(bytes("s3cret")), 500);
        vm.prank(bob); escrow.joinRoom(id, "s3cret");
        assertEq(escrow.playerCount(id), 2);
    }
    function test_Join_PrivateBadCode() public {
        vm.prank(alice);
        uint256 id = escrow.createRoom(1, STAKE, 0, 2, uint64(block.timestamp + 1 hours), keccak256(bytes("s3cret")), 500);
        vm.prank(bob);
        vm.expectRevert(DuelEscrow.BadJoinCode.selector);
        escrow.joinRoom(id, "wrong");
    }
    function test_Join_RevertsNotOpen() public {
        uint256 id = _duel();
        vm.prank(bob); escrow.joinRoom(id, "");
        vm.prank(validator); escrow.resolveRoom(id, _scores2(1, 2));
        vm.prank(carol);
        vm.expectRevert(DuelEscrow.NotOpen.selector);
        escrow.joinRoom(id, "");
    }
    function test_Join_RevertsClosed() public {
        uint256 id = _duel();
        vm.warp(block.timestamp + 25 hours);
        vm.prank(bob);
        vm.expectRevert(DuelEscrow.RoomClosed.selector);
        escrow.joinRoom(id, "");
    }
    function test_Join_RevertsAlreadyJoined() public {
        uint256 id = _duel();
        vm.prank(bob); escrow.joinRoom(id, "");
        vm.prank(bob);
        vm.expectRevert(DuelEscrow.AlreadyJoined.selector);
        escrow.joinRoom(id, "");
    }
    function test_Join_RevertsFull() public {
        uint256 id = _duel();
        vm.prank(bob); escrow.joinRoom(id, "");
        vm.prank(carol);
        vm.expectRevert(DuelEscrow.RoomFull.selector);
        escrow.joinRoom(id, "");
    }
    function test_Join_FreeEntryTransfersNothing() public {
        vm.prank(alice);
        uint256 id = escrow.createRoom(0, 0, 300e18, 3, uint64(block.timestamp + 1 hours), OPEN, 0);
        vm.prank(bob); escrow.joinRoom(id, "");
        assertEq(g.balanceOf(bob), 1000e18); // paid nothing
    }

    // ── resolve · winner derivation + payout ─────────────────────────────────────
    function test_Resolve_HighestWins_8020() public {
        uint256 id = _duel();
        vm.prank(bob); escrow.joinRoom(id, "");
        vm.prank(validator); escrow.resolveRoom(id, _scores2(400, 900)); // bob higher
        uint256 potv = STAKE * 2;
        uint256 ubiCut = potv * 2000 / 10000;
        assertEq(g.balanceOf(ubi), ubiCut);
        assertEq(g.balanceOf(bob), 900e18 + (potv - ubiCut));
    }
    function test_Resolve_TieGoesToEarliestEntrant() public {
        uint256 id = _duel();
        vm.prank(bob); escrow.joinRoom(id, "");
        vm.prank(validator); escrow.resolveRoom(id, _scores2(500, 500)); // tie -> alice (idx 0)
        uint256 potv = STAKE * 2;
        uint256 ubiCut = potv * 2000 / 10000;
        assertEq(g.balanceOf(alice), 900e18 + (potv - ubiCut));
    }
    function test_Resolve_SeededPrizeInPot() public {
        uint256 seed = 500e18;
        vm.prank(alice);
        uint256 id = escrow.createRoom(1, STAKE, seed, 2, uint64(block.timestamp + 1 hours), OPEN, 500);
        vm.prank(bob); escrow.joinRoom(id, "");
        vm.prank(validator); escrow.resolveRoom(id, _scores2(1, 2));
        uint256 potv = seed + STAKE * 2;
        uint256 ubiCut = potv * 2000 / 10000;
        assertEq(g.balanceOf(bob), 900e18 + (potv - ubiCut));
    }
    function test_Resolve_FreeEntryPrizeOnly() public {
        uint256 seed = 300e18;
        vm.prank(alice);
        uint256 id = escrow.createRoom(0, 0, seed, 3, uint64(block.timestamp + 1 hours), OPEN, 0);
        vm.prank(bob);   escrow.joinRoom(id, "");
        vm.prank(carol); escrow.joinRoom(id, ""); // full 3/3
        uint256[] memory s = new uint256[](3); s[0] = 1; s[1] = 5; s[2] = 9;
        vm.prank(validator); escrow.resolveRoom(id, s);
        uint256 ubiCut = seed * 2000 / 10000;
        assertEq(g.balanceOf(carol), 1000e18 + (seed - ubiCut));
    }
    function test_Resolve_ZeroUbiBps_NoCut() public {
        escrow.setUbiBps(0);
        uint256 id = _duel();
        vm.prank(bob); escrow.joinRoom(id, "");
        vm.prank(validator); escrow.resolveRoom(id, _scores2(1, 2));
        assertEq(g.balanceOf(ubi), 0);
        assertEq(g.balanceOf(bob), 900e18 + STAKE * 2);
    }
    function test_Resolve_FullBeforeDeadline() public {
        uint256 id = _duel(); // cap 2
        vm.prank(bob); escrow.joinRoom(id, ""); // now full, before deadline
        assertTrue(escrow.isResolvable(id));
        vm.prank(validator); escrow.resolveRoom(id, _scores2(1, 2));
    }
    function test_Resolve_AfterDeadlineNotFull() public {
        vm.prank(alice);
        uint256 id = escrow.createRoom(1, STAKE, 0, 3, uint64(block.timestamp + 1 hours), OPEN, 0);
        vm.prank(bob); escrow.joinRoom(id, ""); // 2/3
        assertTrue(!escrow.isResolvable(id));
        vm.warp(block.timestamp + 2 hours);
        assertTrue(escrow.isResolvable(id));
        vm.prank(validator); escrow.resolveRoom(id, _scores2(9, 1)); // alice wins
        assertEq(uint8(escrow.getRoom(id).status), uint8(DuelEscrow.Status.Resolved));
    }
    function test_Resolve_RevertsNotValidator() public {
        uint256 id = _duel();
        vm.prank(bob); escrow.joinRoom(id, "");
        vm.prank(bob);
        vm.expectRevert(DuelEscrow.NotValidator.selector);
        escrow.resolveRoom(id, _scores2(1, 2));
    }
    function test_Resolve_RevertsNotOpen() public {
        uint256 id = _duel();
        vm.prank(bob); escrow.joinRoom(id, "");
        vm.prank(validator); escrow.resolveRoom(id, _scores2(1, 2));
        vm.prank(validator);
        vm.expectRevert(DuelEscrow.NotOpen.selector);
        escrow.resolveRoom(id, _scores2(1, 2));
    }
    function test_Resolve_RevertsNotEnoughPlayers() public {
        uint256 id = _duel();
        vm.warp(block.timestamp + 25 hours);
        uint256[] memory s = new uint256[](1); s[0] = 1;
        vm.prank(validator);
        vm.expectRevert(DuelEscrow.NotEnoughPlayers.selector);
        escrow.resolveRoom(id, s);
    }
    function test_Resolve_RevertsStillLive() public {
        vm.prank(alice);
        uint256 id = escrow.createRoom(1, STAKE, 0, 3, uint64(block.timestamp + 1 hours), OPEN, 0);
        vm.prank(bob); escrow.joinRoom(id, ""); // 2/3, before deadline
        vm.prank(validator);
        vm.expectRevert(DuelEscrow.StillLive.selector);
        escrow.resolveRoom(id, _scores2(1, 2));
    }
    function test_Resolve_RevertsScoreLengthMismatch() public {
        uint256 id = _duel();
        vm.prank(bob); escrow.joinRoom(id, "");
        uint256[] memory s = new uint256[](3); // wrong length
        vm.prank(validator);
        vm.expectRevert(DuelEscrow.ScoreLengthMismatch.selector);
        escrow.resolveRoom(id, s);
    }

    // ── refunds ─────────────────────────────────────────────────────────────────
    function test_RefundUnfilled_StakeAndSeedBack() public {
        uint256 seed = 200e18;
        vm.prank(alice);
        uint256 id = escrow.createRoom(1, STAKE, seed, 2, uint64(block.timestamp + 1 hours), OPEN, 0);
        vm.warp(block.timestamp + 2 hours);
        escrow.refundUnfilled(id);
        assertEq(g.balanceOf(alice), 1000e18);
        assertEq(g.balanceOf(address(escrow)), 0);
    }
    function test_RefundUnfilled_FreeRoomSeedBack() public {
        vm.prank(alice);
        uint256 id = escrow.createRoom(0, 0, 250e18, 2, uint64(block.timestamp + 1 hours), OPEN, 0);
        vm.warp(block.timestamp + 2 hours);
        escrow.refundUnfilled(id); // stake 0 -> loop skipped, seed back
        assertEq(g.balanceOf(alice), 1000e18);
    }
    function test_RefundUnfilled_RevertsNotOpen() public {
        uint256 id = _duel();
        vm.prank(bob); escrow.joinRoom(id, "");
        vm.prank(validator); escrow.resolveRoom(id, _scores2(1, 2));
        vm.expectRevert(DuelEscrow.NotOpen.selector);
        escrow.refundUnfilled(id);
    }
    function test_RefundUnfilled_RevertsStillLive() public {
        uint256 id = _duel();
        vm.expectRevert(DuelEscrow.StillLive.selector);
        escrow.refundUnfilled(id);
    }
    function test_RefundUnfilled_RevertsContested() public {
        uint256 id = _duel();
        vm.prank(bob); escrow.joinRoom(id, "");
        vm.warp(block.timestamp + 25 hours);
        vm.expectRevert(DuelEscrow.NotContested.selector);
        escrow.refundUnfilled(id);
    }
    function test_RefundAll_ReturnsEverything() public {
        vm.prank(alice);
        uint256 id = escrow.createRoom(1, STAKE, 0, 3, uint64(block.timestamp + 1 hours), OPEN, 0);
        vm.prank(bob);   escrow.joinRoom(id, "");
        vm.prank(carol); escrow.joinRoom(id, "");
        vm.warp(block.timestamp + 2 hours);
        vm.prank(validator); escrow.refundAll(id);
        assertEq(g.balanceOf(alice), 1000e18);
        assertEq(g.balanceOf(bob), 1000e18);
        assertEq(g.balanceOf(carol), 1000e18);
    }
    function test_RefundAll_RevertsNotValidator() public {
        uint256 id = _duel();
        vm.prank(bob); escrow.joinRoom(id, "");
        vm.warp(block.timestamp + 25 hours);
        vm.expectRevert(DuelEscrow.NotValidator.selector);
        escrow.refundAll(id);
    }
    function test_RefundAll_RevertsNotOpen() public {
        uint256 id = _duel();
        vm.prank(bob); escrow.joinRoom(id, "");
        vm.prank(validator); escrow.resolveRoom(id, _scores2(1, 2));
        vm.warp(block.timestamp + 25 hours);
        vm.prank(validator);
        vm.expectRevert(DuelEscrow.NotOpen.selector);
        escrow.refundAll(id);
    }
    function test_RefundAll_RevertsStillLive() public {
        uint256 id = _duel();
        vm.prank(bob); escrow.joinRoom(id, "");
        vm.prank(validator);
        vm.expectRevert(DuelEscrow.StillLive.selector);
        escrow.refundAll(id);
    }

    // ── permit paths ─────────────────────────────────────────────────────────────
    function test_CreateWithPermit_NoPriorApproval() public {
        uint256 pd = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(davePk, dave, STAKE, pd);
        vm.prank(dave);
        uint256 id = escrow.createRoomWithPermit(1, STAKE, 0, 2, uint64(block.timestamp + 1 hours), OPEN, 500, STAKE, pd, v, r, s);
        assertEq(escrow.getRoom(id).creator, dave);
        assertEq(g.balanceOf(address(escrow)), STAKE);
    }
    function test_CreateWithPermit_SwallowsBadPermitWhenApproved() public {
        // dave approves manually, then sends a junk permit (expired) -> permit
        // reverts, catch swallows it, transferFrom uses the allowance.
        vm.prank(dave); g.approve(address(escrow), type(uint256).max);
        vm.prank(dave);
        uint256 id = escrow.createRoomWithPermit(1, STAKE, 0, 2, uint64(block.timestamp + 1 hours), OPEN, 500, STAKE, 1 /*past deadline*/, 27, bytes32(0), bytes32(0));
        assertEq(escrow.getRoom(id).creator, dave);
    }
    function test_JoinWithPermit() public {
        uint256 id = _duel();
        uint256 pd = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(davePk, dave, STAKE, pd);
        vm.prank(dave);
        escrow.joinRoomWithPermit(id, "", STAKE, pd, v, r, s);
        assertEq(escrow.playerCount(id), 2);
    }

    // ── pausable ──────────────────────────────────────────────────────────────────
    function test_Pause_BlocksCreateAndJoin() public {
        uint256 id = _duel();
        escrow.pause();
        vm.prank(bob);
        vm.expectRevert(bytes("Pausable: paused"));
        escrow.joinRoom(id, "");
        vm.prank(alice);
        vm.expectRevert(bytes("Pausable: paused"));
        escrow.createRoom(1, STAKE, 0, 2, uint64(block.timestamp + 1 hours), OPEN, 0);
    }
    function test_Unpause_Restores() public {
        escrow.pause();
        escrow.unpause();
        _duel(); // works again
    }
    function test_Pause_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Ownable: caller is not the owner"));
        escrow.pause();
    }
    function test_RefundStillWorksWhilePaused() public {
        uint256 id = _duel();
        escrow.pause();
        vm.warp(block.timestamp + 25 hours);
        escrow.refundUnfilled(id); // not gated by whenNotPaused
        assertEq(g.balanceOf(alice), 1000e18);
    }

    // ── config setters ─────────────────────────────────────────────────────────────
    function test_SetValidator() public {
        escrow.setValidator(bob);
        assertEq(escrow.validator(), bob);
    }
    function test_SetValidator_RejectsZero() public {
        vm.expectRevert(DuelEscrow.ZeroAddress.selector);
        escrow.setValidator(address(0));
    }
    function test_SetUbiPool() public {
        escrow.setUbiPool(bob);
        assertEq(escrow.ubiPool(), bob);
    }
    function test_SetUbiPool_RejectsZero() public {
        vm.expectRevert(DuelEscrow.ZeroAddress.selector);
        escrow.setUbiPool(address(0));
    }
    function test_SetUbiBps() public {
        escrow.setUbiBps(3000);
        assertEq(escrow.ubiBps(), 3000);
    }
    function test_SetUbiBps_RejectsTooHigh() public {
        vm.expectRevert(DuelEscrow.UbiTooHigh.selector);
        escrow.setUbiBps(5001);
    }
    function test_SetWindowBounds() public {
        escrow.setWindowBounds(1 hours, 60 days);
        assertEq(escrow.minWindow(), 1 hours);
        assertEq(escrow.maxWindow(), 60 days);
    }
    function test_SetWindowBounds_RejectsZeroMin() public {
        vm.expectRevert(DuelEscrow.BadBounds.selector);
        escrow.setWindowBounds(0, 1 days);
    }
    function test_SetWindowBounds_RejectsMaxBelowMin() public {
        vm.expectRevert(DuelEscrow.BadBounds.selector);
        escrow.setWindowBounds(2 days, 1 days);
    }
    function test_Setters_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Ownable: caller is not the owner"));
        escrow.setValidator(bob);
    }

    // ── views ───────────────────────────────────────────────────────────────────────
    function test_Views() public {
        uint256 id = _duel();
        vm.prank(bob); escrow.joinRoom(id, "");
        assertEq(escrow.getPlayers(id).length, 2);
        assertEq(escrow.getPlayerRooms(alice)[0], id);
        assertEq(escrow.getPlayerRooms(bob)[0], id);
        assertEq(escrow.pot(id), STAKE * 2);
    }
    function test_IsResolvable_FalseWhenResolved() public {
        uint256 id = _duel();
        vm.prank(bob); escrow.joinRoom(id, "");
        vm.prank(validator); escrow.resolveRoom(id, _scores2(1, 2));
        assertTrue(!escrow.isResolvable(id));
    }
    function test_IsResolvable_FalseWhenSolo() public {
        uint256 id = _duel();
        vm.warp(block.timestamp + 25 hours);
        assertTrue(!escrow.isResolvable(id)); // only 1 player
    }
}
