// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title  DuelEscrow
 * @author GameArena
 * @notice On-chain escrow for G$ "duel rooms". A creator opens a room (a friend
 *         duel, an open room, or a sponsored prize pool), funding a stake and/or
 *         a seeded prize and choosing the game, capacity, deadline, visibility,
 *         gating and fee. Others join before the deadline; everyone plays a run
 *         on the existing engine. The backend validator submits the final
 *         scoreboard and the contract derives the winner ON-CHAIN and pays out:
 *
 *             winner  : pot - fee
 *             treasury: pot * feeBps / 10000   (platform revenue; per-room)
 *
 *         Sponsored community pools set feeBps = 0 (winner takes the FULL prize)
 *         and are private (join-code / allowlist), so they are unlisted and only
 *         the invited community can enter. Stake-vs-stake duels set a fee that
 *         routes to the treasury.
 *
 * @dev    Entry gating (per room, mix and match):
 *           - join-code : keccak of a secret carried in the share link.
 *           - allowlist : the creator/owner adds the exact wallets that may join
 *                         (e.g. the community's voted + verified list).
 *         Winner is derived from the validator's scoreboard (highest score;
 *         ties -> earliest entrant), so the validator cannot hand-pick a winner.
 *
 *         Trustless exits so funds are never trapped:
 *           - refundUnfilled : nobody joined -> creator refunded (anyone calls).
 *           - refundAll      : validator escape hatch after the deadline.
 *           - forceRefund    : anyone, after deadline + grace, if a contested
 *                              room was never resolved (validator-vanished).
 *
 *         Token assumption: gToken is a standard non-fee-on-transfer ERC20 (G$).
 *         Pausable gates only room creation/joining; resolve + all refunds stay
 *         open so a pause can never trap funds. Capacity is bounded.
 */
contract DuelEscrow is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ─────────────────────────────────────────────────────────
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant MAX_FEE_BPS     = 2_000;   // hard ceiling: 20%
    uint16 public constant MAX_CAPACITY    = 256;     // bounds refund/scan loops

    // ─── Types ─────────────────────────────────────────────────────────────
    enum Status { Open, Resolved, Refunded }

    struct Room {
        address   creator;
        uint256   stake;        // per-participant entry (0 = free entry)
        uint256   seed;         // creator-seeded prize on top of stakes
        uint256   targetScore;  // creator's advertised run (display only)
        uint8     gameType;     // 0 rhythm · 1 simon · 2 stack · 3 challenge-ai
        uint16    capacity;     // max participants, 2..MAX_CAPACITY
        uint16    feeBps;       // treasury fee (0 for sponsored pools)
        bool      useAllowlist; // if true, only allowlisted wallets may join
        Status    status;
        uint64    createdAt;
        uint64    deadline;
        bytes32   joinCodeHash; // 0 = public (listed); else private, code-gated
        address[] players;
    }

    // Input struct for createRoom — a single param avoids stack-too-deep (and
    // lets `forge coverage` run without --ir-minimum).
    struct RoomParams {
        uint8   gameType;
        uint256 stake;
        uint256 seed;
        uint16  feeBps;
        uint16  capacity;
        uint64  deadline;
        bytes32 joinCodeHash;
        bool    useAllowlist;
        uint256 targetScore;
    }

    struct PermitData {
        uint256 value;
        uint256 deadline;
        uint8   v;
        bytes32 r;
        bytes32 s;
    }

    // ─── Storage ───────────────────────────────────────────────────────────
    IERC20  public immutable gToken;    // GoodDollar G$
    address public treasury;            // per-room fee recipient (platform revenue)
    address public validator;           // may submit scoreboards

    uint64 public minWindow       = 5 minutes;
    uint64 public maxWindow       = 30 days;
    uint64 public forceRefundGrace = 2 days; // after deadline, contested rooms self-refund

    uint256 public roomCount;
    mapping(uint256 => Room) private _rooms;
    mapping(uint256 => mapping(address => bool)) public joined;
    mapping(uint256 => mapping(address => bool)) public allowlisted;
    mapping(address => uint256[]) private _playerRooms;

    // ─── Events ────────────────────────────────────────────────────────────
    event RoomCreated(uint256 indexed id, address indexed creator, uint8 gameType, uint256 stake, uint256 seed, uint16 feeBps, uint16 capacity, uint64 deadline, bool isPrivate, bool useAllowlist, uint256 targetScore);
    event RoomJoined(uint256 indexed id, address indexed player, uint256 playerCount);
    event RoomResolved(uint256 indexed id, address indexed winner, uint256 winningScore, uint256 payout, uint256 fee, uint256 playerCount);
    event RoomRefunded(uint256 indexed id, uint256 playerCount, uint256 stakeEach, uint256 seed);
    event AllowlistUpdated(uint256 indexed id, address indexed wallet, bool allowed);
    event ValidatorUpdated(address indexed validator);
    event TreasuryUpdated(address indexed treasury);
    event WindowBoundsUpdated(uint64 minWindow, uint64 maxWindow);
    event ForceRefundGraceUpdated(uint64 grace);

    // ─── Errors ────────────────────────────────────────────────────────────
    error ZeroAddress();
    error NoValue();
    error BadCapacity();
    error FeeTooHigh();
    error DeadlineTooSoon();
    error DeadlineTooFar();
    error NotOpen();
    error RoomClosed();
    error AlreadyJoined();
    error RoomFull();
    error BadJoinCode();
    error NotAllowlisted();
    error NotValidator();
    error NotCreatorOrOwner();
    error NotEnoughPlayers();
    error StillLive();
    error ScoreLengthMismatch();
    error NotContested();
    error BadBounds();

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor(address gToken_, address treasury_, address validator_) {
        if (gToken_ == address(0) || treasury_ == address(0) || validator_ == address(0)) revert ZeroAddress();
        gToken    = IERC20(gToken_);
        treasury  = treasury_;
        validator = validator_;
    }

    // ─── Create ───────────────────────────────────────────────────────────────

    /// @notice Open a room. Caller must have approved `stake + seed` of G$.
    function createRoom(RoomParams calldata p) external whenNotPaused nonReentrant returns (uint256 id) {
        return _createRoom(p);
    }

    /// @notice Open a room with an EIP-2612 permit (gasless-friendly; the permit
    ///         must cover `stake + seed`).
    function createRoomWithPermit(RoomParams calldata p, PermitData calldata permit)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 id)
    {
        _tryPermit(msg.sender, permit);
        return _createRoom(p);
    }

    function _createRoom(RoomParams calldata p) internal returns (uint256 id) {
        if (p.stake == 0 && p.seed == 0) revert NoValue();
        if (p.capacity < 2 || p.capacity > MAX_CAPACITY) revert BadCapacity();
        if (p.feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        if (p.deadline < block.timestamp + minWindow) revert DeadlineTooSoon();
        if (p.deadline > block.timestamp + maxWindow) revert DeadlineTooFar();

        id = ++roomCount;
        Room storage room = _rooms[id];
        room.creator      = msg.sender;
        room.stake        = p.stake;
        room.seed         = p.seed;
        room.targetScore  = p.targetScore;
        room.gameType     = p.gameType;
        room.capacity     = p.capacity;
        room.feeBps       = p.feeBps;
        room.useAllowlist = p.useAllowlist;
        room.status       = Status.Open;
        room.createdAt    = uint64(block.timestamp);
        room.deadline     = p.deadline;
        room.joinCodeHash = p.joinCodeHash;
        room.players.push(msg.sender);
        joined[id][msg.sender] = true;
        _playerRooms[msg.sender].push(id);

        emit RoomCreated(id, msg.sender, p.gameType, p.stake, p.seed, p.feeBps, p.capacity, p.deadline, p.joinCodeHash != bytes32(0), p.useAllowlist, p.targetScore);

        gToken.safeTransferFrom(msg.sender, address(this), p.stake + p.seed);
    }

    // ─── Allowlist (creator or owner) ───────────────────────────────────────────

    /// @notice Add wallets that may join an allowlist-gated room (e.g. the
    ///         community's voted + verified list). Creator or owner, while Open.
    function addToAllowlist(uint256 id, address[] calldata wallets) external {
        Room storage room = _rooms[id];
        if (msg.sender != room.creator && msg.sender != owner()) revert NotCreatorOrOwner();
        if (room.status != Status.Open) revert NotOpen();
        for (uint256 i = 0; i < wallets.length; ++i) {
            allowlisted[id][wallets[i]] = true;
            emit AllowlistUpdated(id, wallets[i], true);
        }
    }

    function removeFromAllowlist(uint256 id, address wallet) external {
        Room storage room = _rooms[id];
        if (msg.sender != room.creator && msg.sender != owner()) revert NotCreatorOrOwner();
        allowlisted[id][wallet] = false;
        emit AllowlistUpdated(id, wallet, false);
    }

    // ─── Join ─────────────────────────────────────────────────────────────────

    /// @notice Join a room, matching its stake. For a code-gated room, `code`
    ///         must be the plaintext behind its join-code (carried in the link).
    function joinRoom(uint256 id, string calldata code) external whenNotPaused nonReentrant {
        _joinRoom(id, code);
    }

    /// @notice Join with an EIP-2612 permit covering the stake (gasless-friendly).
    function joinRoomWithPermit(uint256 id, string calldata code, PermitData calldata permit)
        external
        whenNotPaused
        nonReentrant
    {
        _tryPermit(msg.sender, permit);
        _joinRoom(id, code);
    }

    function _joinRoom(uint256 id, string calldata code) internal {
        Room storage room = _rooms[id];
        if (room.status != Status.Open) revert NotOpen();
        if (block.timestamp > room.deadline) revert RoomClosed();
        if (joined[id][msg.sender]) revert AlreadyJoined();
        if (room.players.length >= room.capacity) revert RoomFull();
        if (room.useAllowlist && !allowlisted[id][msg.sender]) revert NotAllowlisted();
        if (room.joinCodeHash != bytes32(0) && keccak256(bytes(code)) != room.joinCodeHash) revert BadJoinCode();

        room.players.push(msg.sender);
        joined[id][msg.sender] = true;
        _playerRooms[msg.sender].push(id);
        emit RoomJoined(id, msg.sender, room.players.length);

        if (room.stake > 0) gToken.safeTransferFrom(msg.sender, address(this), room.stake);
    }

    // ─── Resolve ──────────────────────────────────────────────────────────────

    /// @notice Validator submits the final scoreboard aligned to the room's
    ///         players (index-for-index). Winner = highest score (ties ->
    ///         earliest entrant). Callable once the room is full or past its
    ///         deadline. Winner takes pot - fee; fee routes to the treasury.
    function resolveRoom(uint256 id, uint256[] calldata scores) external nonReentrant {
        if (msg.sender != validator) revert NotValidator();
        Room storage room = _rooms[id];
        if (room.status != Status.Open) revert NotOpen();
        uint256 n = room.players.length;
        if (n < 2) revert NotEnoughPlayers();
        if (block.timestamp <= room.deadline && n != room.capacity) revert StillLive();
        if (scores.length != n) revert ScoreLengthMismatch();

        uint256 bestIdx;
        uint256 bestScore = scores[0];
        for (uint256 i = 1; i < n; ++i) {
            if (scores[i] > bestScore) {
                bestScore = scores[i];
                bestIdx = i;
            }
        }
        address winner = room.players[bestIdx];

        room.status = Status.Resolved;
        uint256 roomPot = room.seed + room.stake * n;
        uint256 fee = (roomPot * room.feeBps) / BPS_DENOMINATOR;
        uint256 payout = roomPot - fee;
        emit RoomResolved(id, winner, bestScore, payout, fee, n);

        if (fee > 0) gToken.safeTransfer(treasury, fee);
        gToken.safeTransfer(winner, payout);
    }

    // ─── Refunds ────────────────────────────────────────────────────────────

    /// @notice Trustless: a room nobody contested (only the creator) past its
    ///         deadline refunds the creator. Anyone may call.
    function refundUnfilled(uint256 id) external nonReentrant {
        Room storage room = _rooms[id];
        if (room.status != Status.Open) revert NotOpen();
        if (block.timestamp <= room.deadline) revert StillLive();
        if (room.players.length >= 2) revert NotContested();
        _refund(id, room);
    }

    /// @notice Validator escape hatch: a contested room with no valid score
    ///         returns every stake, and the seed to its sponsor.
    function refundAll(uint256 id) external nonReentrant {
        if (msg.sender != validator) revert NotValidator();
        Room storage room = _rooms[id];
        if (room.status != Status.Open) revert NotOpen();
        if (block.timestamp <= room.deadline) revert StillLive();
        _refund(id, room);
    }

    /// @notice Trustless backstop: anyone can refund a contested room that was
    ///         never resolved, once `deadline + forceRefundGrace` has passed.
    ///         Guarantees no downtime can trap funds.
    function forceRefund(uint256 id) external nonReentrant {
        Room storage room = _rooms[id];
        if (room.status != Status.Open) revert NotOpen();
        if (block.timestamp <= uint256(room.deadline) + forceRefundGrace) revert StillLive();
        _refund(id, room);
    }

    function _refund(uint256 id, Room storage room) internal {
        room.status = Status.Refunded;
        uint256 stakeEach = room.stake;
        uint256 seed = room.seed;
        uint256 n = room.players.length;
        emit RoomRefunded(id, n, stakeEach, seed);

        if (stakeEach > 0) {
            for (uint256 i = 0; i < n; ++i) {
                gToken.safeTransfer(room.players[i], stakeEach);
            }
        }
        if (seed > 0) gToken.safeTransfer(room.creator, seed);
    }

    // ─── Permit helper ──────────────────────────────────────────────────────
    /// @dev Permit may revert if already used (e.g. front-run); the subsequent
    ///      transferFrom then relies on the existing allowance, so we swallow it.
    function _tryPermit(address owner_, PermitData calldata p) internal {
        try IERC20Permit(address(gToken)).permit(owner_, address(this), p.value, p.deadline, p.v, p.r, p.s) {} catch {}
    }

    // ─── Owner config ─────────────────────────────────────────────────────────
    function setValidator(address v) external onlyOwner {
        if (v == address(0)) revert ZeroAddress();
        validator = v;
        emit ValidatorUpdated(v);
    }

    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
        emit TreasuryUpdated(t);
    }

    function setWindowBounds(uint64 minW, uint64 maxW) external onlyOwner {
        if (minW == 0 || maxW < minW) revert BadBounds();
        minWindow = minW;
        maxWindow = maxW;
        emit WindowBoundsUpdated(minW, maxW);
    }

    function setForceRefundGrace(uint64 grace) external onlyOwner {
        if (grace == 0) revert BadBounds();
        forceRefundGrace = grace;
        emit ForceRefundGraceUpdated(grace);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ─── Views ────────────────────────────────────────────────────────────────
    function getRoom(uint256 id) external view returns (Room memory) { return _rooms[id]; }
    function getPlayers(uint256 id) external view returns (address[] memory) { return _rooms[id].players; }
    function playerCount(uint256 id) external view returns (uint256) { return _rooms[id].players.length; }
    function getPlayerRooms(address player) external view returns (uint256[] memory) { return _playerRooms[player]; }

    /// @notice Total pot currently escrowed for a room (seed + all stakes).
    function pot(uint256 id) external view returns (uint256) {
        Room storage room = _rooms[id];
        return room.seed + room.stake * room.players.length;
    }

    /// @notice Whether resolveRoom can be called now.
    function isResolvable(uint256 id) external view returns (bool) {
        Room storage room = _rooms[id];
        if (room.status != Status.Open) return false;
        if (room.players.length < 2) return false;
        return block.timestamp > room.deadline || room.players.length == room.capacity;
    }
}
