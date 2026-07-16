// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {HabitatRegistry} from "../src/HabitatRegistry.sol";

/**
 * @notice Deploy HabitatRegistry to Celo Mainnet
 *
 * Usage:
 *   forge script script/DeployHabitatRegistry.s.sol \
 *     --rpc-url https://forno.celo.org \
 *     --broadcast \
 *     --verify \
 *     --etherscan-api-key $CELOSCAN_API_KEY \
 *     --account <your-cast-wallet-name>
 *
 * Required env vars (set in .env or shell):
 *   GOOD_COLLECTIVE_ADDRESS  — GoodCollective UBI Pool (85% donation recipient)
 *   GAMEARENA_TREASURY       — GameArena treasury (15% platform recipient)
 *
 * If either env var is missing, the deployer address is used as fallback.
 * This is safe for local testing but MUST be set explicitly for mainnet.
 */
contract DeployHabitatRegistry is Script {
    // GoodDollar G$ on Celo Mainnet
    address constant G_TOKEN = 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A;

    // Default UBI pool if env not set (matches the address used elsewhere)
    address constant DEFAULT_UBI_POOL = 0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1;

    // GameArena treasury — the wallet that receives the platform's 15% share.
    address constant DEFAULT_TREASURY = 0xc1cFA63135eA2fB5AB795cF10e4c79F4DD03c3f6;

    // Foundry's default script sender. Guarding against it stops a repeat of the
    // bug where an unset GAMEARENA_TREASURY routed funds to an unowned address.
    address constant FOUNDRY_DEFAULT_SENDER = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;

    function run() external returns (HabitatRegistry) {
        // GoodCollective UBI Pool — defaults to the public GoodCollective address
        address ubiPool = vm.envOr("GOOD_COLLECTIVE_ADDRESS", DEFAULT_UBI_POOL);

        // Treasury — real wallet by default; overridable via env for a multisig.
        address treasury = vm.envOr("GAMEARENA_TREASURY", DEFAULT_TREASURY);

        require(treasury != address(0), "Treasury zero");
        require(treasury != FOUNDRY_DEFAULT_SENDER, "Treasury is the Foundry placeholder - set GAMEARENA_TREASURY");

        vm.startBroadcast();

        HabitatRegistry registry = new HabitatRegistry(
            G_TOKEN,
            ubiPool,
            treasury
        );

        vm.stopBroadcast();

        console.log("HabitatRegistry deployed at:", address(registry));
        console.log("G$ Token:                   ", G_TOKEN);
        console.log("UBI Pool (85%):             ", ubiPool);
        console.log("Treasury (15%):             ", treasury);
        console.log("");
        console.log("Default tier costs:");
        console.log("  Tier 6  Celestial Arena:        300 G$");
        console.log("  Tier 7  Mystic Garden:        1,000 G$");
        console.log("  Tier 8  Astral Realm:         3,000 G$");
        console.log("  Tier 9  Cosmic Throne:       10,000 G$");
        console.log("  Tier 10 Eternal Sanctuary:   30,000 G$");
        console.log("");
        console.log("Next steps:");
        console.log("  1. Set NEXT_PUBLIC_HABITAT_REGISTRY=", address(registry), "in frontend/.env");
        console.log("  2. Set HABITAT_REGISTRY_ADDRESS=", address(registry), "in games-backend/.env");
        console.log("  3. Verify treasury and UBI pool addresses match expectations");
        console.log("  4. (Optional) Add new tiers later via setTierCost(tier, cost)");

        return registry;
    }
}
