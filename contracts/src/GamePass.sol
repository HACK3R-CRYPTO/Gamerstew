// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GamePass
 * @dev Free-to-mint NFT that acts as a game pass for GameArena.
 *      One per wallet. Stores a player-chosen username on-chain.
 *      totalSupply() = total registered users (only grows).
 */
contract GamePass is ERC721, Ownable {
    uint256 public totalSupply;

    mapping(address => string) public usernameOf;
    mapping(string  => bool)   private _usernameTaken;
    mapping(address => bool)   public  hasMinted;

    // ── On-chain score tracking ─────────────────────────────────────────────
    address public scoreValidator;           // backend address that submits scores
    uint256 public totalGamesPlayed;
    mapping(address => uint256) public gamesPlayed;
    mapping(address => mapping(uint8 => uint256)) public bestScore; // player => gameType => best

    event PassMinted(address indexed player, uint256 indexed tokenId, string username);
    event UsernameChanged(address indexed player, string oldName, string newName);
    event ScoreRecorded(address indexed player, uint8 indexed gameType, uint256 score, uint256 totalGames);

    constructor() ERC721("GameArena Pass", "GAPASS") {
        _transferOwnership(msg.sender);
        scoreValidator = msg.sender;
    }

    /**
     * @notice Mint your free Game Pass. One per wallet. Username must be unique.
     * @param username Your chosen display name (3-16 chars, alphanumeric + underscore)
     */
    function mint(string calldata username) external {
        require(!hasMinted[msg.sender], "Already minted");
        require(_validUsername(username), "Invalid username (3-16 chars, a-z 0-9 _)");
        require(!_usernameTaken[_lower(username)], "Username taken");

        totalSupply++;
        uint256 tokenId = totalSupply;

        hasMinted[msg.sender] = true;
        usernameOf[msg.sender] = username;
        _usernameTaken[_lower(username)] = true;

        _safeMint(msg.sender, tokenId);
        emit PassMinted(msg.sender, tokenId, username);
    }

    /**
     * @notice Change your username (must still be unique).
     */
    function changeUsername(string calldata newName) external {
        require(hasMinted[msg.sender], "No pass");
        require(_validUsername(newName), "Invalid username");
        require(!_usernameTaken[_lower(newName)], "Username taken");

        string memory oldName = usernameOf[msg.sender];
        _usernameTaken[_lower(oldName)] = false;
        _usernameTaken[_lower(newName)] = true;
        usernameOf[msg.sender] = newName;

        emit UsernameChanged(msg.sender, oldName, newName);
    }

    /**
     * @notice Look up username by address. Returns empty string if not registered.
     */
    function getUsername(address player) external view returns (string memory) {
        return usernameOf[player];
    }

    /**
     * @notice Check if a username is available.
     */
    function isUsernameAvailable(string calldata username) external view returns (bool) {
        return _validUsername(username) && !_usernameTaken[_lower(username)];
    }

    // ── On-chain score recording (called by backend, player pays nothing) ───

    /**
     * @notice Record a game score on-chain. Called by backend after every game.
     * @param player   the player's address
     * @param gameType 0 = RhythmRush, 1 = SimonMemory
     * @param score    the score achieved
     */
    function recordScore(address player, uint8 gameType, uint256 score) external {
        require(msg.sender == scoreValidator, "Not authorised");
        require(hasMinted[player], "No game pass");

        totalGamesPlayed++;
        gamesPlayed[player]++;
        if (score > bestScore[player][gameType]) {
            bestScore[player][gameType] = score;
        }

        emit ScoreRecorded(player, gameType, score, totalGamesPlayed);
    }

    function setScoreValidator(address _validator) external onlyOwner {
        scoreValidator = _validator;
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    function _validUsername(string calldata name) internal pure returns (bool) {
        bytes memory b = bytes(name);
        if (b.length < 3 || b.length > 16) return false;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            bool ok = (c >= 0x30 && c <= 0x39) || // 0-9
                      (c >= 0x41 && c <= 0x5A) || // A-Z
                      (c >= 0x61 && c <= 0x7A) || // a-z
                      c == 0x5F;                   // _
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
