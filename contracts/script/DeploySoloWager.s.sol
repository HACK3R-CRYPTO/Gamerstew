// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {SoloWager} from "../src/SoloWager.sol";

/**
 * @notice Deploy SoloWager to Celo Mainnet
 *
 * Usage:
 *   forge script script/DeploySoloWager.s.sol \
 *     --rpc-url https://forno.celo.org \
 *     --broadcast \
 *     --verify \
 *     --etherscan-api-key $CELOSCAN_API_KEY \
 *     --account <your-cast-wallet-name>
 *
 * Required env vars (set in .env or shell):
 *   GOOD_COLLECTIVE_ADDRESS  — GoodCollective UBI Pool (2% fee recipient)
 *   BACKEND_VALIDATOR        — address that calls resolveWager()
 */
contract DeploySoloWager is Script {
    // GoodDollar G$ on Celo Mainnet
    address constant G_TOKEN = 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A;

    function run() external returns (SoloWager) {
        // Use env vars if set, otherwise deployer wallet handles both roles for testing
        address backendValidator = vm.envOr("BACKEND_VALIDATOR", msg.sender);

        // GoodCollective UBI Pool — set GOOD_COLLECTIVE_ADDRESS in env for mainnet
        // Defaults to deployer for local testing (update before mainnet)
        address goodCollective = vm.envOr("GOOD_COLLECTIVE_ADDRESS", msg.sender);

        vm.startBroadcast();

        SoloWager wager = new SoloWager(
            G_TOKEN,
            goodCollective,
            backendValidator
        );

        vm.stopBroadcast();

        console.log("SoloWager deployed at:", address(wager));
        console.log("G$ Token:             ", G_TOKEN);
        console.log("GoodCollective:        ", goodCollective);
        console.log("Backend validator:     ", backendValidator);
        console.log("");
        console.log("Next steps:");
        console.log("  1. Set VITE_SOLO_WAGER_ADDRESS=", address(wager), "in frontend/.env");
        console.log("  2. Set SOLO_WAGER_ADDRESS=", address(wager), "in games-backend/.env");
        console.log("  3. Fund the treasury: call fundTreasury() with enough G$ to cover payouts");

        return wager;
    }
}
