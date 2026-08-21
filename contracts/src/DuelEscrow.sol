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
 * @notice Peer-to-peer G$ "duel rooms". A player opens a room, funding a stake
 *         and/or a seeded prize, and sets the game, capacity, deadline and
 *         visibility. Others join before the deadline; everyone plays a run on
 *         the existing game engine. The backend validator submits the final
 *         scoreboard and the contract derives the winner ON-CHAIN (highest
 *         score; ties resolve to the earliest entrant), then splits the pot:
 *
 *             winner: (10000 - ubiBps)/10000 of the pot   (default 80%)
 *             UBI pool: ubiBps/10000 of the pot           (default 20%)
 *
 *         Room shapes fall out of three dials:
 *           - visibility  : public (listed) vs private (join-code gated)
 *           - entry stake : > 0 (players pay in) vs 0 (free entry)
 *           - seeded prize: > 0 (sponsored) vs 0
 *         => friend duel (cap 2, stake), open room (cap N, stake), sponsored
 *            challenge (free entry, seeded prize), boosted room (stake + seed).
 *
 * @dev    Trust model: the validator is trusted to submit truthful scores
 *         (the same server-authoritative anti-cheat that gates every score in
 *         the app). It cannot name an arbitrary winner — the contract computes
 *         the winner from the submitted scores. The pot is fully funded by the
 *         participants and the sponsor; the contract holds no treasury.
 *
 *         Token assumption: `gToken` is a standard, non-fee-on-transfer,
 *         non-rebasing ERC20 (GoodDollar G$). Stakes are accounted at face
 *         value; a fee-on-transfer token would break equal-stake accounting.
 *
 *         Safety: `Pausable` gates room creation and joining only. Resolving
 *         and refunding are always available so funds can never be trapped by
 *         a pause. Capacity is bounded so refund/scan loops are gas-bounded.
 */
contract DuelEscrow is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ─────────────────────────────────────────────────────────
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant MAX_UBI_BPS     = 5_000;   // hard ceiling: 50%
    uint16 public constant MAX_CAPACITY    = 256;     // bounds refund/scan loops

    // ─── Types ─────────────────────────────────────────────────────────────
    enum Status { Open, Resolved, Refunded }

    struct Room {
        address   creator;      // opened the room; always players[0]
        uint256   stake;        // per-participant entry (0 = free entry)
        uint256   seed;         // creator-seeded prize on top of stakes (0 = none)
        uint256   targetScore;  // creator's advertised run (display only)
        uint8     gameType;     // 0 rhythm · 1 simon · 2 stack · 3 challenge-ai
        uint16    capacity;     // max participants, 2..MAX_CAPACITY
        Status    status;
        uint64    createdAt;
        uint64    deadline;     // join + play close here
        bytes32   joinCodeHash; // 0 = public (listed); else private, code-gated
        address[] players;      // everyone in the room, in join order
    }

    // ─── Storage ───────────────────────────────────────────────────────────
    IERC20  public immutable gToken;    // GoodDollar G$
    address public ubiPool;             // UBI cut recipient
    address public validator;           // may submit scoreboards

    uint16 public ubiBps    = 2_000;    // 20.00%
    uint64 public minWindow = 5 minutes;
    uint64 public maxWindow = 30 days;

    uint256 public roomCount;
    mapping(uint256 => Room) private _rooms;
    mapping(uint256 => mapping(address => bool)) public joined;
    mapping(address => uint256[]) private _playerRooms;

    // ─── Events ────────────────────────────────────────────────────────────
    event RoomCreated(uint256 indexed id, address indexed creator, uint8 gameType, uint256 stake, uint256 seed, uint16 capacity, uint64 deadline, bool isPrivate, uint256 targetScore);
    event RoomJoined(uint256 indexed id, address indexed player, uint256 playerCount);
    event RoomResolved(uint256 indexed id, address indexed winner, uint256 winningScore, uint256 payout, uint256 ubiCut, uint256 playerCount);
    event RoomRefunded(uint256 indexed id, uint256 playerCount, uint256 stakeEach, uint256 seed);
    event ValidatorUpdated(address indexed validator);
    event UbiPoolUpdated(address indexed ubiPool);
    event UbiBpsUpdated(uint16 ubiBps);
    event WindowBoundsUpdated(uint64 minWindow, uint64 maxWindow);

    // ─── Errors ────────────────────────────────────────────────────────────
    error ZeroAddress();
    error NoValue();
    error BadCapacity();
    error DeadlineTooSoon();
    error DeadlineTooFar();
    error NotOpen();
    error RoomClosed();
    error AlreadyJoined();
    error RoomFull();
    error BadJoinCode();
    error NotValidator();
    error NotEnoughPlayers();
    error StillLive();
    error ScoreLengthMismatch();
    error NotContested();
    error BadBounds();
    error UbiTooHigh();

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor(address gToken_, address ubiPool_, address validator_) {
        if (gToken_ == address(0) || ubiPool_ == address(0) || validator_ == address(0)) revert ZeroAddress();
        gToken    = IERC20(gToken_);
        ubiPool   = ubiPool_;
        validator = validator_;
    }

    // ─── Create ───────────────────────────────────────────────────────────────

    /// @notice Open a room. Caller must have approved `stake + seed` of G$.
    /// @param gameType     0 rhythm · 1 simon · 2 stack · 3 challenge-ai
    /// @param stake        per-participant entry (0 = free entry)
    /// @param seed         creator-seeded prize on top of stakes
    /// @param capacity     max participants, 2..MAX_CAPACITY
    /// @param deadline     unix time the room closes (minWindow..maxWindow out)
    /// @param joinCodeHash keccak256 of the private join code, or 0 for public
    /// @param targetScore  the creator's advertised run (display only)
    function createRoom(
        uint8   gameType,
        uint256 stake,
        uint256 seed,
        uint16  capacity,
        uint64  deadline,
        bytes32 joinCodeHash,
        uint256 targetScore
    ) external whenNotPaused nonReentrant returns (uint256 id) {
        return _createRoom(gameType, stake, seed, capacity, deadline, joinCodeHash, targetScore);
    }

    /// @notice Open a room with an EIP-2612 permit, so the caller needs no prior
    ///         approve tx (gasless-friendly). The permit must cover `stake + seed`.
    function createRoomWithPermit(
        uint8   gameType,
        uint256 stake,
        uint256 seed,
        uint16  capacity,
        uint64  deadline,
        bytes32 joinCodeHash,
        uint256 targetScore,
        uint256 permitValue,
        uint256 permitDeadline,
        uint8 v, bytes32 r, bytes32 s
    ) external whenNotPaused nonReentrant returns (uint256 id) {
        _tryPermit(msg.sender, permitValue, permitDeadline, v, r, s);
        return _createRoom(gameType, stake, seed, capacity, deadline, joinCodeHash, targetScore);
    }

    function _createRoom(
        uint8   gameType,
        uint256 stake,
        uint256 seed,
        uint16  capacity,
        uint64  deadline,
        bytes32 joinCodeHash,
        uint256 targetScore
    ) internal returns (uint256 id) {
        if (stake == 0 && seed == 0) revert NoValue();
        if (capacity < 2 || capacity > MAX_CAPACITY) revert BadCapacity();
        if (deadline < block.timestamp + minWindow) revert DeadlineTooSoon();
        if (deadline > block.timestamp + maxWindow) revert DeadlineTooFar();

        // Effects
        id = ++roomCount;
        Room storage room = _rooms[id];
        room.creator      = msg.sender;
        room.stake        = stake;
        room.seed         = seed;
        room.targetScore  = targetScore;
        room.gameType     = gameType;
        room.capacity     = capacity;
        room.status       = Status.Open;
        room.createdAt    = uint64(block.timestamp);
        room.deadline     = deadline;
        room.joinCodeHash = joinCodeHash;
        room.players.push(msg.sender);
        joined[id][msg.sender] = true;
        _playerRooms[msg.sender].push(id);

        emit RoomCreated(id, msg.sender, gameType, stake, seed, capacity, deadline, joinCodeHash != bytes32(0), targetScore);

        // Interaction (guaranteed > 0 by the NoValue check)
        gToken.safeTransferFrom(msg.sender, address(this), stake + seed);
    }

    // ─── Join ─────────────────────────────────────────────────────────────────

    /// @notice Join a room, matching its stake. For a private room, `code` must
    ///         be the plaintext behind its `joinCodeHash` (carried in the link).
    function joinRoom(uint256 id, string calldata code) external whenNotPaused nonReentrant {
        _joinRoom(id, code);
    }

    /// @notice Join with an EIP-2612 permit covering the stake (gasless-friendly).
    function joinRoomWithPermit(
        uint256 id,
        string calldata code,
        uint256 permitValue,
        uint256 permitDeadline,
        uint8 v, bytes32 r, bytes32 s
    ) external whenNotPaused nonReentrant {
        _tryPermit(msg.sender, permitValue, permitDeadline, v, r, s);
        _joinRoom(id, code);
    }

    function _joinRoom(uint256 id, string calldata code) internal {
        Room storage room = _rooms[id];
        if (room.status != Status.Open) revert NotOpen();
        if (block.timestamp > room.deadline) revert RoomClosed();
        if (joined[id][msg.sender]) revert AlreadyJoined();
        if (room.players.length >= room.capacity) revert RoomFull();
        if (room.joinCodeHash != bytes32(0) && keccak256(bytes(code)) != room.joinCodeHash) revert BadJoinCode();

        // Effects
        room.players.push(msg.sender);
        joined[id][msg.sender] = true;
        _playerRooms[msg.sender].push(id);
        emit RoomJoined(id, msg.sender, room.players.length);

        // Interaction
        if (room.stake > 0) gToken.safeTransferFrom(msg.sender, address(this), room.stake);
    }

    // ─── Resolve ──────────────────────────────────────────────────────────────

    /// @notice Validator submits the final scoreboard aligned to the room's
    ///         players (index-for-index). The contract derives the winner
    ///         (highest score; ties -> earliest entrant) and pays out. Callable
    ///         once the room is full or past its deadline.
    function resolveRoom(uint256 id, uint256[] calldata scores) external nonReentrant {
        if (msg.sender != validator) revert NotValidator();
        Room storage room = _rooms[id];
        if (room.status != Status.Open) revert NotOpen();
        uint256 n = room.players.length;
        if (n < 2) revert NotEnoughPlayers();
        if (block.timestamp <= room.deadline && n != room.capacity) revert StillLive();
        if (scores.length != n) revert ScoreLengthMismatch();

        // Winner = highest score; a tie keeps the earliest entrant (lower index),
        // so the creator's run is the one everyone must strictly beat.
        uint256 bestIdx;
        uint256 bestScore = scores[0];
        for (uint256 i = 1; i < n; ++i) {
            if (scores[i] > bestScore) {
                bestScore = scores[i];
                bestIdx = i;
            }
        }
        address winner = room.players[bestIdx];

        // Effects
        room.status = Status.Resolved;
        uint256 roomPot = room.seed + room.stake * n;
        uint256 ubiCut = (roomPot * ubiBps) / BPS_DENOMINATOR;
        uint256 payout = roomPot - ubiCut;
        emit RoomResolved(id, winner, bestScore, payout, ubiCut, n);

        // Interactions
        if (ubiCut > 0) gToken.safeTransfer(ubiPool, ubiCut);
        gToken.safeTransfer(winner, payout);
    }

    // ─── Refunds ────────────────────────────────────────────────────────────

    /// @notice Trustless: a room nobody contested (only the creator) past its
    ///         deadline refunds the creator their stake + seed. Anyone may call.
    function refundUnfilled(uint256 id) external nonReentrant {
        Room storage room = _rooms[id];
        if (room.status != Status.Open) revert NotOpen();
        if (block.timestamp <= room.deadline) revert StillLive();
        if (room.players.length >= 2) revert NotContested();
        _refund(id, room);
    }

    /// @notice Validator escape hatch: a contested room where no valid score was
    ///         posted returns every stake, and the seed to its sponsor.
    function refundAll(uint256 id) external nonReentrant {
        if (msg.sender != validator) revert NotValidator();
        Room storage room = _rooms[id];
        if (room.status != Status.Open) revert NotOpen();
        if (block.timestamp <= room.deadline) revert StillLive();
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
        // Seed goes back to its sponsor (the creator, players[0]).
        if (seed > 0) gToken.safeTransfer(room.creator, seed);
    }

    // ─── Permit helper ──────────────────────────────────────────────────────
    /// @dev Permit may revert if it was already used (e.g. front-run); in that
    ///      case the subsequent transferFrom relies on the existing allowance,
    ///      so we swallow the permit failure rather than blocking the action.
    function _tryPermit(address owner, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) internal {
        try IERC20Permit(address(gToken)).permit(owner, address(this), value, deadline, v, r, s) {} catch {}
    }

    // ─── Owner config ─────────────────────────────────────────────────────────
    function setValidator(address v) external onlyOwner {
        if (v == address(0)) revert ZeroAddress();
        validator = v;
        emit ValidatorUpdated(v);
    }

    function setUbiPool(address p) external onlyOwner {
        if (p == address(0)) revert ZeroAddress();
        ubiPool = p;
        emit UbiPoolUpdated(p);
    }

    function setUbiBps(uint16 b) external onlyOwner {
        if (b > MAX_UBI_BPS) revert UbiTooHigh();
        ubiBps = b;
        emit UbiBpsUpdated(b);
    }

    function setWindowBounds(uint64 minW, uint64 maxW) external onlyOwner {
        if (minW == 0 || maxW < minW) revert BadBounds();
        minWindow = minW;
        maxWindow = maxW;
        emit WindowBoundsUpdated(minW, maxW);
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

    /// @notice Whether resolveRoom can be called now (open, >=2 players, full or past deadline).
    function isResolvable(uint256 id) external view returns (bool) {
        Room storage room = _rooms[id];
        if (room.status != Status.Open) return false;
        if (room.players.length < 2) return false;
        return block.timestamp > room.deadline || room.players.length == room.capacity;
    }
}
