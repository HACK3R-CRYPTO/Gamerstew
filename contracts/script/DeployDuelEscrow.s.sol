// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {DuelEscrow} from "../src/DuelEscrow.sol";

/**
 * @notice Deploy DuelEscrow (G$ score duel rooms).
 *
 * Usage (Celo mainnet):
 *   forge script script/DeployDuelEscrow.s.sol \
 *     --rpc-url https://forno.celo.org \
 *     --broadcast \
 *     --verify \
 *     --etherscan-api-key $CELOSCAN_API_KEY \
 *     --account <your-cast-wallet-name>
 *
 * Env vars:
 *   G_TOKEN_ADDRESS   — G$ token (defaults to Celo mainnet G$ below; set this to
 *                       deploy against a testnet/mock token)
 *   TREASURY_ADDRESS  — recipient of the per-room fee (defaults to deployer)
 *   BACKEND_VALIDATOR — address that submits scoreboards (defaults to deployer)
 */
contract DeployDuelEscrow is Script {
    // GoodDollar G$ on Celo mainnet.
    address constant G_TOKEN_DEFAULT = 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A;

    function run() external returns (DuelEscrow) {
        address gToken    = vm.envOr("G_TOKEN_ADDRESS", G_TOKEN_DEFAULT);
        address treasury  = vm.envOr("TREASURY_ADDRESS", msg.sender);
        address validator = vm.envOr("BACKEND_VALIDATOR", msg.sender);

        vm.startBroadcast();
        DuelEscrow escrow = new DuelEscrow(gToken, treasury, validator);
        vm.stopBroadcast();

        console.log("DuelEscrow deployed at:", address(escrow));
        console.log("  gToken   :", gToken);
        console.log("  treasury :", treasury);
        console.log("  validator:", validator);
        return escrow;
    }
}
