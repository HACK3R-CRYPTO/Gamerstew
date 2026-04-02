// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title SoloWager
 * @dev Players wager G$ on their solo game score (Rhythm Rush or Simon Memory).
 *      The backend validates the score and calls resolveWager().
 *      Win payout: 1.8x the wager. 2% platform fee goes to GoodCollective UBI pool.
 *      The contract owner seeds the treasury to cover winner payouts.
 */
contract SoloWager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Types ────────────────────────────────────────────────────────────────
    enum GameType  { RhythmRush, SimonMemory }
    enum WagerStatus { Pending, Won, Lost, Cancelled }

    struct Wager {
        uint256    id;
        address    player;
        uint256    amount;        // G$ deposited
        GameType   gameType;
        WagerStatus status;
        uint256    createdAt;
        uint256    score;         // filled in on resolution
    }

    // ── State ────────────────────────────────────────────────────────────────
    IERC20  public immutable gToken;          // GoodDollar G$ on Celo
    address public goodCollective;            // 2% fee recipient (GoodCollective UBI Pool)
    address public backendValidator;          // only this address can resolve wagers

    uint256 public wagerCounter;
    uint256 public platformFeePercent = 2;    // 2% to GoodCollective
    uint256 public payoutMultiplier  = 130;  // 130 = 1.3x payout (divide by 100)

    // Score thresholds to WIN for each game type
    uint256 public rhythmWinThreshold = 350;  // score ≥ 350 in Rhythm Rush
    uint256 public simonWinThreshold  = 7;    // sequences ≥ 7 in Simon Memory

    mapping(uint256 => Wager)            public wagers;
    mapping(address => uint256[])        public playerWagers;

    // ── User registry (on-chain, only grows) ────────────────────────────────
    mapping(address => bool)             public registeredUser;
    uint256 public totalUsers;

    // ── Events ───────────────────────────────────────────────────────────────
    event WagerCreated(uint256 indexed wagerId, address indexed player, uint256 amount, GameType gameType);
    event WagerResolved(uint256 indexed wagerId, address indexed player, bool won, uint256 payout);
    event TreasuryFunded(address indexed funder, uint256 amount);
    event SeasonPrizesDistributed(uint256 indexed season, address[3] rhythmWinners, address[3] simonWinners, uint256 totalPot);

    // ── Constructor ──────────────────────────────────────────────────────────
    constructor(address _gToken, address _goodCollective, address _backendValidator) {
        _transferOwnership(msg.sender);
        gToken           = IERC20(_gToken);
        goodCollective   = _goodCollective;
        backendValidator = _backendValidator;
    }

    // ── Player: create wager ─────────────────────────────────────────────────
    /**
     * @notice Step 1: player approves G$, then calls this to lock their wager.
     * @param amount   G$ amount (18 decimals)
     * @param gameType 0 = RhythmRush, 1 = SimonMemory
     */
    function createWager(uint256 amount, GameType gameType) external nonReentrant returns (uint256 wagerId) {
        require(amount > 0, "Wager must be > 0");

        // Register new user on-chain
        if (!registeredUser[msg.sender]) {
            registeredUser[msg.sender] = true;
            totalUsers++;
        }

        gToken.safeTransferFrom(msg.sender, address(this), amount);

        wagerId = ++wagerCounter;
        wagers[wagerId] = Wager({
            id:        wagerId,
            player:    msg.sender,
            amount:    amount,
            gameType:  gameType,
            status:    WagerStatus.Pending,
            createdAt: block.timestamp,
            score:     0
        });
        playerWagers[msg.sender].push(wagerId);

        emit WagerCreated(wagerId, msg.sender, amount, gameType);
    }

    // ── Backend: resolve wager ────────────────────────────────────────────────
    /**
     * @notice Called by backendValidator after validating the player's score.
     * @param wagerId   the wager to resolve
     * @param score     the validated score (Rhythm Rush points OR Simon sequences)
     */
    function resolveWager(uint256 wagerId, uint256 score) external nonReentrant {
        require(msg.sender == backendValidator, "Not authorised");

        Wager storage w = wagers[wagerId];
        require(w.status == WagerStatus.Pending, "Already resolved");

        w.score  = score;
        uint256 threshold = w.gameType == GameType.RhythmRush ? rhythmWinThreshold : simonWinThreshold;
        bool won = score >= threshold;

        if (won) {
            // Gross payout = multiplier * wager. Platform takes 2% of that.
            uint256 gross      = (w.amount * payoutMultiplier) / 100;
            uint256 fee        = (gross * platformFeePercent) / 100;
            uint256 netPayout  = gross - fee;

            w.status = WagerStatus.Won;

            // Pay fee to GoodCollective (may fail gracefully if contract has no balance)
            if (fee > 0 && gToken.balanceOf(address(this)) >= gross) {
                gToken.safeTransfer(goodCollective, fee);
                gToken.safeTransfer(w.player, netPayout);
                emit WagerResolved(wagerId, w.player, true, netPayout);
            } else {
                // Treasury too low — refund wager only, no profit
                gToken.safeTransfer(w.player, w.amount);
                emit WagerResolved(wagerId, w.player, true, w.amount);
            }
        } else {
            // Player loses — wager stays in treasury
            w.status = WagerStatus.Lost;
            // Send 2% of lost wager to GoodCollective
            uint256 fee = (w.amount * platformFeePercent) / 100;
            if (fee > 0) gToken.safeTransfer(goodCollective, fee);

            emit WagerResolved(wagerId, w.player, false, 0);
        }
    }

    // ── Owner: distribute season prizes ──────────────────────────────────────
    /**
     * @notice At the end of each season, distribute 10% of the treasury to
     *         the top 3 players of each game (60% / 30% / 10% split per game).
     *         Called by the backend validator after sealing the season.
     *         GoodCollective already received 2% on every wager — this comes
     *         from the treasury (losing wagers) and does not reduce that fee.
     * @param seasonId      the season number being closed
     * @param rhythmWinners [1st, 2nd, 3rd] of Rhythm Rush — use address(0) if < 3 players
     * @param simonWinners  [1st, 2nd, 3rd] of Simon Memory
     */
    function distributeSeasonPrizes(
        uint256        seasonId,
        address[3] calldata rhythmWinners,
        address[3] calldata simonWinners
    ) external nonReentrant {
        require(msg.sender == backendValidator || msg.sender == owner(), "Not authorised");

        uint256 balance = gToken.balanceOf(address(this));
        require(balance > 0, "Empty treasury");

        // 10% of treasury split equally between the two games
        uint256 totalPot   = (balance * 10) / 100;
        uint256 gamePot    = totalPot / 2; // 5% per game

        _payWinners(rhythmWinners, gamePot);
        _payWinners(simonWinners,  gamePot);

        emit SeasonPrizesDistributed(seasonId, rhythmWinners, simonWinners, totalPot);
    }

    function _payWinners(address[3] calldata winners, uint256 pot) internal {
        uint256 first  = (pot * 60) / 100;
        uint256 second = (pot * 30) / 100;
        uint256 third  = pot - first - second;

        if (winners[0] != address(0)) gToken.safeTransfer(winners[0], first);
        if (winners[1] != address(0)) gToken.safeTransfer(winners[1], second);
        if (winners[2] != address(0)) gToken.safeTransfer(winners[2], third);
    }

    // ── Owner: cancel a stuck wager (safety hatch) ────────────────────────────
    function cancelWager(uint256 wagerId) external onlyOwner {
        Wager storage w = wagers[wagerId];
        require(w.status == WagerStatus.Pending, "Not pending");
        w.status = WagerStatus.Cancelled;
        gToken.safeTransfer(w.player, w.amount);
    }

    // ── Owner: fund treasury ──────────────────────────────────────────────────
    function fundTreasury(uint256 amount) external onlyOwner {
        gToken.safeTransferFrom(msg.sender, address(this), amount);
        emit TreasuryFunded(msg.sender, amount);
    }

    // ── Owner: withdraw developer earnings from treasury ──────────────────────
    /**
     * @notice Withdraw G$ from the treasury to the owner wallet.
     *         The treasury surplus (losing wagers minus prize payouts) is the
     *         platform's revenue. Leave enough to cover active pending wagers.
     * @param amount G$ amount to withdraw (18 decimals). Use type(uint256).max
     *               to withdraw the entire balance.
     */
    function withdrawTreasury(uint256 amount) external onlyOwner nonReentrant {
        uint256 balance = gToken.balanceOf(address(this));
        uint256 toSend  = amount == type(uint256).max ? balance : amount;
        require(toSend <= balance, "Insufficient treasury");
        gToken.safeTransfer(msg.sender, toSend);
        emit TreasuryWithdrawn(msg.sender, toSend);
    }

    event TreasuryWithdrawn(address indexed owner, uint256 amount);

    // ── Owner: config ─────────────────────────────────────────────────────────
    function setThresholds(uint256 rhythm, uint256 simon) external onlyOwner {
        rhythmWinThreshold = rhythm;
        simonWinThreshold  = simon;
    }

    function setBackendValidator(address _validator) external onlyOwner {
        backendValidator = _validator;
    }

    function setGoodCollective(address _gc) external onlyOwner {
        goodCollective = _gc;
    }

    function setPayoutMultiplier(uint256 _multiplier) external onlyOwner {
        require(_multiplier >= 100 && _multiplier <= 300, "Must be 100-300 (1x-3x)");
        payoutMultiplier = _multiplier;
    }

    // ── Views ─────────────────────────────────────────────────────────────────
    function treasuryBalance() external view returns (uint256) {
        return gToken.balanceOf(address(this));
    }

    function getPlayerWagers(address player) external view returns (uint256[] memory) {
        return playerWagers[player];
    }
}
