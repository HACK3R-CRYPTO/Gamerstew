// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title PerkShop
 * @dev In-game perks paid in G$ across GameArena's casual modes: saves,
 *      retries and cosmetics. Ranked play never touches this shop, so ranked
 *      stays pure skill. Every purchase splits G$ in one transaction:
 *        ubiBps      -> GoodCollective UBI pool   (default 85%)
 *        treasuryBps -> GameArena treasury        (default 15%)
 *      The contract never holds G$; funds route straight from the buyer.
 *
 *      Perks are either:
 *        - consumable (saves/retries): one purchase = one use, granted to the
 *          player off-chain by the game backend; can be re-bought.
 *        - cosmetic: a one-time unlock recorded on-chain (owned forever).
 *
 *      Default perks (G$ amounts use 18 decimals; all tunable via setPerk):
 *        1  Rhythm Rush  · Save          (consumable)     30 G$
 *        2  Rhythm Rush  · Neon Trail    (cosmetic)      300 G$
 *        3  Stack Tower  · Save          (consumable)     30 G$
 *        4  Stack Tower  · Crystal Blocks (cosmetic)     250 G$
 *        5  Simon Memory · Retry         (consumable)     20 G$
 *        6  Challenge AI · Rematch       (consumable)     15 G$
 *
 *      New perks can be added later via setPerk(); no upgrade needed.
 */
contract PerkShop is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ── Constants ────────────────────────────────────────────────────────────
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // ── State ────────────────────────────────────────────────────────────────
    IERC20  public immutable gToken;         // GoodDollar G$ on Celo
    address public ubiPool;                  // GoodCollective UBI pool
    address public treasury;                 // GameArena treasury

    uint256 public ubiBps      = 8_500;      // 85% to UBI
    uint256 public treasuryBps = 1_500;      // 15% to treasury

    struct Perk {
        uint256 price;     // G$ cost, 18 decimals (0 = disabled)
        bool    cosmetic;  // true = one-time on-chain unlock, false = consumable
    }

    mapping(uint16 => Perk) public perks;                             // perkId => Perk
    mapping(address => mapping(uint16 => bool)) public ownedCosmetic; // player => perkId => owned
    mapping(address => uint256) public perksBought;                  // per-player consumable count (analytics)
    mapping(address => uint256) public playerUbiContributed;         // per-player UBI portion only
    uint256 public totalCommunityContribution;                       // aggregate UBI portion

    // ── Events ───────────────────────────────────────────────────────────────
    event PerkPurchased(
        address indexed player,
        uint16  indexed perkId,
        bool    cosmetic,
        uint256 totalPaid,
        uint256 ubiAmount,
        uint256 treasuryAmount
    );
    event PerkConfigured(uint16 indexed perkId, uint256 price, bool cosmetic);
    event UbiPoolChanged(address indexed oldPool, address indexed newPool);
    event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury);
    event SplitChanged(uint256 oldUbiBps, uint256 newUbiBps, uint256 oldTreasuryBps, uint256 newTreasuryBps);

    // ── Constructor ──────────────────────────────────────────────────────────
    constructor(address _gToken, address _ubiPool, address _treasury) {
        require(_gToken   != address(0), "G$ address zero");
        require(_ubiPool  != address(0), "UBI pool zero");
        require(_treasury != address(0), "Treasury zero");
        gToken   = IERC20(_gToken);
        ubiPool  = _ubiPool;
        treasury = _treasury;

        _setPerk(1,  30 ether, false); // Rhythm Rush  · Save
        _setPerk(2, 300 ether, true);  // Rhythm Rush  · Neon Trail (cosmetic)
        _setPerk(3,  30 ether, false); // Stack Tower  · Save
        _setPerk(4, 250 ether, true);  // Stack Tower  · Crystal Blocks (cosmetic)
        _setPerk(5,  20 ether, false); // Simon Memory · Retry
        _setPerk(6,  15 ether, false); // Challenge AI · Rematch
    }

    // ── Core ─────────────────────────────────────────────────────────────────
    /**
     * @notice Buy a perk. Splits G$ between the UBI pool and treasury. For
     *         cosmetics the unlock is recorded on-chain; consumables just emit
     *         the purchase for the game backend to grant one use.
     * @param perkId Perk ID (must have a configured price).
     */
    function buyPerk(uint16 perkId) external nonReentrant whenNotPaused {
        Perk memory p = perks[perkId];
        require(p.price > 0, "Perk disabled");
        if (p.cosmetic) {
            require(!ownedCosmetic[msg.sender][perkId], "Already owned");
        }

        // Treasury portion first; UBI takes the remainder so any rounding
        // always favors UBI, never the platform.
        uint256 treasuryAmount = (p.price * treasuryBps) / BPS_DENOMINATOR;
        uint256 ubiAmount      = p.price - treasuryAmount;

        gToken.safeTransferFrom(msg.sender, ubiPool, ubiAmount);
        if (treasuryAmount > 0) {
            gToken.safeTransferFrom(msg.sender, treasury, treasuryAmount);
        }

        if (p.cosmetic) {
            ownedCosmetic[msg.sender][perkId] = true;
        } else {
            perksBought[msg.sender] += 1;
        }
        playerUbiContributed[msg.sender] += ubiAmount;
        totalCommunityContribution       += ubiAmount;

        emit PerkPurchased(msg.sender, perkId, p.cosmetic, p.price, ubiAmount, treasuryAmount);
    }

    // ── Views ────────────────────────────────────────────────────────────────
    function ownsCosmetic(address player, uint16 perkId) external view returns (bool) {
        return ownedCosmetic[player][perkId];
    }

    function perkPrice(uint16 perkId) external view returns (uint256) {
        return perks[perkId].price;
    }

    // ── Admin ────────────────────────────────────────────────────────────────
    function _setPerk(uint16 perkId, uint256 price, bool cosmetic) internal {
        perks[perkId] = Perk(price, cosmetic);
        emit PerkConfigured(perkId, price, cosmetic);
    }

    /**
     * @notice Configure or disable a perk. Price > 0 enables, 0 disables.
     */
    function setPerk(uint16 perkId, uint256 price, bool cosmetic) external onlyOwner {
        _setPerk(perkId, price, cosmetic);
    }

    function setUbiPool(address newPool) external onlyOwner {
        require(newPool != address(0), "Zero address");
        emit UbiPoolChanged(ubiPool, newPool);
        ubiPool = newPool;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Zero address");
        emit TreasuryChanged(treasury, newTreasury);
        treasury = newTreasury;
    }

    /**
     * @notice Update the UBI/treasury split. Both in basis points; must sum to 10000.
     */
    function setSplit(uint256 newUbiBps, uint256 newTreasuryBps) external onlyOwner {
        require(newUbiBps + newTreasuryBps == BPS_DENOMINATOR, "Must sum to 10000");
        emit SplitChanged(ubiBps, newUbiBps, treasuryBps, newTreasuryBps);
        ubiBps      = newUbiBps;
        treasuryBps = newTreasuryBps;
    }

    function pause()   external onlyOwner { _pause();   }
    function unpause() external onlyOwner { _unpause(); }

    /**
     * @notice Recover stray ERC20s sent here by mistake. G$ is excluded so the
     *         owner can never divert UBI flow.
     */
    function recoverToken(IERC20 token, address to, uint256 amount) external onlyOwner {
        require(address(token) != address(gToken), "Cannot recover G$");
        require(to != address(0), "Zero address");
        token.safeTransfer(to, amount);
    }
}
