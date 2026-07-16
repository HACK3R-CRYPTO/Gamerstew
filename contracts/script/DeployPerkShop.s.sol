// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {PerkShop} from "../src/PerkShop.sol";

/**
 * @notice Deploy PerkShop to Celo Mainnet.
 *
 * Usage:
 *   forge script script/DeployPerkShop.s.sol \
 *     --rpc-url https://forno.celo.org \
 *     --broadcast --verify \
 *     --etherscan-api-key $CELOSCAN_API_KEY \
 *     --private-key $PRIVATE_KEY
 *
 * Constructor recipients (same as HabitatRegistry):
 *   ubiPool  — GoodCollective UBI pool (20% of every perk sale)
 *   treasury — GameArena treasury      (80%)
 */
contract DeployPerkShop is Script {
    // GoodDollar G$ on Celo Mainnet
    address constant G_TOKEN = 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A;

    // GoodCollective UBI pool — same one HabitatRegistry routes to.
    address constant DEFAULT_UBI_POOL = 0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1;

    // GameArena treasury — the wallet that receives the platform's share.
    address constant DEFAULT_TREASURY = 0xc1cFA63135eA2fB5AB795cF10e4c79F4DD03c3f6;

    // Foundry's default script sender. A prior deploy left GAMEARENA_TREASURY
    // unset and silently routed the treasury cut here — an address nobody holds
    // a key for, so the funds were unrecoverable. The guard below makes that a
    // hard revert instead of a silent loss.
    address constant FOUNDRY_DEFAULT_SENDER = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;

    function run() external returns (PerkShop) {
        address ubiPool  = vm.envOr("GOOD_COLLECTIVE_ADDRESS", DEFAULT_UBI_POOL);
        address treasury = vm.envOr("GAMEARENA_TREASURY", DEFAULT_TREASURY);

        require(treasury != address(0), "Treasury zero");
        require(treasury != FOUNDRY_DEFAULT_SENDER, "Treasury is the Foundry placeholder - set GAMEARENA_TREASURY");

        vm.startBroadcast();
        PerkShop shop = new PerkShop(G_TOKEN, ubiPool, treasury);
        vm.stopBroadcast();

        console.log("PerkShop deployed at:", address(shop));
        console.log("G$ Token:            ", G_TOKEN);
        console.log("UBI Pool (20%):      ", ubiPool);
        console.log("Treasury (80%):      ", treasury);
        console.log("");
        console.log("Default perks:");
        console.log("  1 Rhythm Rush  Save          30 G$  (consumable)");
        console.log("  2 Rhythm Rush  Neon Trail   300 G$  (cosmetic)");
        console.log("  3 Stack Tower  Save          30 G$  (consumable)");
        console.log("  4 Stack Tower  Retry         20 G$  (consumable)");
        console.log("  5 Simon Memory Retry         20 G$  (consumable)");
        console.log("  6 Challenge AI Rematch       15 G$  (consumable)");
        console.log("");
        console.log("Next: set NEXT_PUBLIC_PERK_SHOP in frontend/.env + PERK_SHOP_ADDRESS in games-backend/.env");

        return shop;
    }
}
