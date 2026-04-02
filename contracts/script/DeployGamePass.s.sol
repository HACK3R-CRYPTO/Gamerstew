// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/GamePass.sol";

contract DeployGamePass is Script {
    function run() external returns (GamePass) {
        vm.startBroadcast();
        GamePass pass = new GamePass();
        vm.stopBroadcast();

        console.log("GamePass deployed at:", address(pass));
        console.log("Owner:", pass.owner());
        return pass;
    }
}
