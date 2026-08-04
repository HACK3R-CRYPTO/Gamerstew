// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {PerkShop} from "../src/PerkShop.sol";
import {HabitatRegistry} from "../src/HabitatRegistry.sol";

/**
 * @notice Raise PerkShop perk prices AND HabitatRegistry tier costs so G$ carries
 *         real value (Rael feedback). Owner-only.
 *
 *         These prices MUST match the frontend exactly:
 *           - perks    -> frontend/lib/perks.ts    (priceG$)
 *           - habitats -> frontend/lib/habitats.ts (costG$)
 *         A purchase signs an EIP-2612 permit for the on-chain price, so any
 *         mismatch reverts the buy. Ship this tx and the frontend together.
 *
 * Safe sequence (no broken-shop window):
 *   1. shop.pause() + registry.pause()   (optional but clean)
 *   2. run THIS script
 *   3. deploy the frontend with matching prices
 *   4. shop.unpause() + registry.unpause()
 *
 * Usage:
 *   forge script script/SetPerkPrices.s.sol \
 *     --rpc-url https://forno.celo.org \
 *     --broadcast \
 *     --private-key $PRIVATE_KEY   # the OWNER key for both contracts
 */
contract SetPerkPrices is Script {
    // Deployed on Celo Mainnet.
    address constant PERK_SHOP        = 0xe451Ab21587e6Fd540522495CbaE62dD0f207Ef5;
    address constant HABITAT_REGISTRY = 0x8888FEb43ac1833c683D0474204aa55A55BD010F;

    function run() external {
        PerkShop shop = PerkShop(PERK_SHOP);
        HabitatRegistry reg = HabitatRegistry(HABITAT_REGISTRY);

        vm.startBroadcast();

        // ── Perks · setPerk(perkId, priceG$ [18 dec], cosmetic) ──────────────
        // Floor is now 50 G$ (no more near-free items).
        shop.setPerk(6,  50 ether, false); // Challenge AI · Match Pack (+5)    2 -> 50
        shop.setPerk(5,  50 ether, false); // Simon Memory · Retry             20 -> 50
        shop.setPerk(1, 100 ether, false); // Rhythm Rush  · Save your run     30 -> 100
        shop.setPerk(3, 100 ether, false); // Stack Tower  · Save your run     30 -> 100
        shop.setPerk(4, 500 ether, true);  // Stack Tower  · Crystal Blocks   250 -> 500
        shop.setPerk(2, 750 ether, true);  // Rhythm Rush  · Neon Trail       300 -> 750

        // ── Habitats · setTierCost(tier, costG$ [18 dec]) · ~+50% ────────────
        reg.setTierCost(6,     500 ether); //   300 -> 500
        reg.setTierCost(7,   1_500 ether); // 1,000 -> 1,500
        reg.setTierCost(8,   5_000 ether); // 3,000 -> 5,000
        reg.setTierCost(9,  15_000 ether); //10,000 -> 15,000
        reg.setTierCost(10, 50_000 ether); //30,000 -> 50,000

        vm.stopBroadcast();
        console.log("Prices updated. PerkShop:", PERK_SHOP);
        console.log("HabitatRegistry:", HABITAT_REGISTRY);
    }
}
