// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GamePass v3
 * @dev Soulbound NFT game pass for GameArena.
 *      One per wallet. Stores username + scores on-chain.
 *
 *      Score storage:
 *      - weeklyBest[season][player][gameType] — resets every week automatically
 *      - bestScore[player][gameType]          — all-time best, never resets
 *      - currentSeason() = block.timestamp / 7 days (no admin needed)
 *
 *      Security:
 *      - recordScoreSigned: backend pays gas, player's EIP-712 sig proves they authorised it
 *      - recordScoreWithBackendSig: player pays gas, backend's EIP-712 sig proves backend approved it
 *      - nonces / scoreNonces: each signature is single-use — no replay attacks
 *      - adminSetScore: owner can correct hacker-inflated scores (per season)
 *      - migrate: one-time bulk import from old contract into current season
 */
contract GamePass is ERC721, Ownable {
    uint256 public totalSupply;

    mapping(address => string)  public usernameOf;
    mapping(string  => bool)    private _usernameTaken;
    mapping(address => bool)    public  hasMinted;

    // ── Score tracking ───────────────────────────────────────────────────────
    address public scoreValidator;
    uint256 public totalGamesPlayed;
    mapping(address => uint256) public gamesPlayed;

    // All-time best — never resets
    mapping(address => mapping(uint8 => uint256)) public bestScore;

    // Weekly best — auto-resets every season (week)
    // weeklyBest[season][player][gameType]
    mapping(uint256 => mapping(address => mapping(uint8 => uint256))) public weeklyBest;

    // ── Season ───────────────────────────────────────────────────────────────

    /// @notice Returns the current season number (week since Unix epoch).
    ///         Increments automatically every 7 days — no admin needed.
    function currentSeason() public view returns (uint256) {
        return block.timestamp / 7 days;
    }

    // ── EIP-712 ──────────────────────────────────────────────────────────────
    mapping(address => uint256) public nonces;       // for recordScoreSigned (player signs)
    mapping(address => uint256) public scoreNonces;  // for recordScoreWithBackendSig (backend signs)

    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant SCORE_TYPEHASH = keccak256(
        "RecordScore(address player,uint8 gameType,uint256 score,uint256 nonce)"
    );
    bytes32 private constant BACKEND_APPROVAL_TYPEHASH = keccak256(
        "BackendApproval(address player,uint8 gameType,uint256 score,uint256 nonce)"
    );
    bytes32 public immutable DOMAIN_SEPARATOR;

    // ── Migration ────────────────────────────────────────────────────────────
    bool public migrationDone = false;

    // ── Events ───────────────────────────────────────────────────────────────
    event PassMinted(address indexed player, uint256 indexed tokenId, string username);
    event UsernameChanged(address indexed player, string oldName, string newName);
    event ScoreRecorded(address indexed player, uint8 indexed gameType, uint256 score, uint256 indexed season, uint256 totalGames);

    constructor() ERC721("GameArena Pass", "GAPASS") {
        _transferOwnership(msg.sender);
        scoreValidator = msg.sender;

        DOMAIN_SEPARATOR = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("GameArena Pass"),
            keccak256("3"),
            block.chainid,
            address(this)
        ));
    }

    // ── Mint ─────────────────────────────────────────────────────────────────

    function mint(string calldata username) external {
        require(!hasMinted[msg.sender], "Already minted");
        require(_validUsername(username), "Invalid username (3-16 chars, a-z 0-9 _)");
        require(!_usernameTaken[_lower(username)], "Username taken");

        totalSupply++;
        uint256 tokenId = totalSupply;

        hasMinted[msg.sender]            = true;
        usernameOf[msg.sender]           = username;
        _usernameTaken[_lower(username)] = true;

        _safeMint(msg.sender, tokenId);
        emit PassMinted(msg.sender, tokenId, username);
    }

    // ── Username ─────────────────────────────────────────────────────────────

    function changeUsername(string calldata newName) external {
        require(hasMinted[msg.sender], "No pass");
        require(_validUsername(newName), "Invalid username");
        require(!_usernameTaken[_lower(newName)], "Username taken");

        string memory oldName = usernameOf[msg.sender];
        _usernameTaken[_lower(oldName)] = false;
        _usernameTaken[_lower(newName)] = true;
        usernameOf[msg.sender]          = newName;

        emit UsernameChanged(msg.sender, oldName, newName);
    }

    function getUsername(address player) external view returns (string memory) {
        return usernameOf[player];
    }

    function isUsernameAvailable(string calldata username) external view returns (bool) {
        return _validUsername(username) && !_usernameTaken[_lower(username)];
    }

    // ── Score recording ──────────────────────────────────────────────────────

    /**
     * @notice Simple score recording — backend calls directly.
     *         Kept for backwards compatibility during migration.
     */
    function recordScore(address player, uint8 gameType, uint256 score) external {
        require(msg.sender == scoreValidator, "Not authorised");
        require(hasMinted[player], "No game pass");
        _saveScore(player, gameType, score);
    }

    /**
     * @notice Secure score recording with player's EIP-712 signature.
     *         Backend submits and pays gas. ecrecover proves the player
     *         authorised this exact score — cannot be faked without their
     *         private key.
     */
    function recordScoreSigned(
        address player,
        uint8   gameType,
        uint256 score,
        uint256 nonce,
        bytes calldata signature
    ) external {
        require(msg.sender == scoreValidator, "Not authorised");
        require(hasMinted[player], "No game pass");
        require(nonce == nonces[player], "Invalid nonce");

        bytes32 structHash = keccak256(abi.encode(
            SCORE_TYPEHASH,
            player,
            gameType,
            score,
            nonce
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address signer  = _recover(digest, signature);

        require(signer == player, "Invalid player signature");

        nonces[player]++;
        _saveScore(player, gameType, score);
    }

    /**
     * @notice Player submits their own score and pays gas.
     *         Backend signs the approved score as a voucher — player passes
     *         that voucher to this function. ecrecover verifies the backend
     *         approved this exact score. Shows under the player's address on Celoscan.
     */
    function recordScoreWithBackendSig(
        uint8   gameType,
        uint256 score,
        uint256 nonce,
        bytes calldata backendSignature
    ) external {
        require(hasMinted[msg.sender], "No game pass");
        require(nonce == scoreNonces[msg.sender], "Invalid nonce");

        bytes32 structHash = keccak256(abi.encode(
            BACKEND_APPROVAL_TYPEHASH,
            msg.sender,
            gameType,
            score,
            nonce
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address signer  = _recover(digest, backendSignature);

        require(signer == scoreValidator, "Backend did not approve this score");

        scoreNonces[msg.sender]++;
        _saveScore(msg.sender, gameType, score);
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    function setScoreValidator(address _validator) external onlyOwner {
        require(_validator != address(0), "Zero address");
        scoreValidator = _validator;
    }

    /**
     * @notice Correct a hacker-inflated score for a specific season. Owner only.
     *         Pass season = currentSeason() to correct the live leaderboard.
     *         All-time best is only updated if the corrected score is higher.
     */
    function adminSetScore(address player, uint8 gameType, uint256 score, uint256 season) external onlyOwner {
        weeklyBest[season][player][gameType] = score;
        if (score > bestScore[player][gameType]) {
            bestScore[player][gameType] = score;
        }
    }

    // ── Migration (one-time) ─────────────────────────────────────────────────

    /**
     * @notice Bulk import players from old contract into current season.
     *         Old scores land in weeklyBest[currentSeason()] and bestScore.
     *         gamesPlayed is estimated: 1 per non-zero score (real per-player
     *         counts were not tracked on the old contract).
     */
    function migrate(
        address[] calldata players,
        string[]  calldata usernames,
        uint256[] calldata rhythmScores,
        uint256[] calldata simonScores
    ) external onlyOwner {
        require(!migrationDone, "Migration already finalized");
        require(
            players.length == usernames.length &&
            players.length == rhythmScores.length &&
            players.length == simonScores.length,
            "Array length mismatch"
        );

        uint256 season = currentSeason();

        for (uint256 i = 0; i < players.length; i++) {
            address player = players[i];
            if (hasMinted[player]) continue;

            totalSupply++;
            uint256 tokenId = totalSupply;

            hasMinted[player]                    = true;
            usernameOf[player]                   = usernames[i];
            _usernameTaken[_lower(usernames[i])] = true;

            // All-time best
            bestScore[player][0] = rhythmScores[i];
            bestScore[player][1] = simonScores[i];

            // Current season (so they appear on the live weekly leaderboard)
            weeklyBest[season][player][0] = rhythmScores[i];
            weeklyBest[season][player][1] = simonScores[i];

            // Estimate games played — real counts not available from old contract
            uint256 games = (rhythmScores[i] > 0 ? 1 : 0) + (simonScores[i] > 0 ? 1 : 0);
            gamesPlayed[player]  = games;
            totalGamesPlayed    += games;

            _safeMint(player, tokenId);
            emit PassMinted(player, tokenId, usernames[i]);
        }
    }

    function finalizeMigration() external onlyOwner {
        migrationDone = true;
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    function _saveScore(address player, uint8 gameType, uint256 score) internal {
        uint256 season = currentSeason();

        totalGamesPlayed++;
        gamesPlayed[player]++;

        // Weekly best — resets automatically each season
        if (score > weeklyBest[season][player][gameType]) {
            weeklyBest[season][player][gameType] = score;
        }

        // All-time best — never resets
        if (score > bestScore[player][gameType]) {
            bestScore[player][gameType] = score;
        }

        emit ScoreRecorded(player, gameType, score, season, totalGamesPlayed);
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "Invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8   v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        return ecrecover(digest, v, r, s);
    }

    function _validUsername(string calldata name) internal pure returns (bool) {
        bytes memory b = bytes(name);
        if (b.length < 3 || b.length > 16) return false;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            bool ok = (c >= 0x30 && c <= 0x39) ||
                      (c >= 0x41 && c <= 0x5A) ||
                      (c >= 0x61 && c <= 0x7A) ||
                      c == 0x5F;
            if (!ok) return false;
        }
        return true;
    }

    function _lower(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] >= 0x41 && b[i] <= 0x5A) b[i] = bytes1(uint8(b[i]) + 32);
        }
        return string(b);
    }

    // Soulbound — no transfers
    function _beforeTokenTransfer(address from, address to, uint256, uint256) internal pure override {
        require(from == address(0) || to == address(0), "Soulbound: non-transferable");
    }
}
