// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {L2Gateway7683} from "../src/L2Gateway7683.sol";
import {Forwarder} from "../src/Forwarder.sol";

contract Config is Script {
    function run() external {
        address l2GatewayAddress = vm.envOr("L2_GATEWAY_ADDRESS", address(0));
        address forwarderAddress = vm.envOr("FORWARDER_ADDRESS", address(0));
        bytes32 aztecGateway7683 = vm.envBytes32("AZTEC_GATEWAY_7683");
        bool configureForwarder = vm.envOr("CONFIGURE_FORWARDER", false);
        bool configureL2Gateway = vm.envOr("CONFIGURE_L2_GATEWAY", false);

        config(l2GatewayAddress, forwarderAddress, aztecGateway7683, configureForwarder, configureL2Gateway);
    }

    function run(
        address l2GatewayAddress, 
        address forwarderAddress, 
        bytes32 aztecGateway7683,
        bool configureForwarder,
        bool configureL2Gateway
    ) external {
        config(l2GatewayAddress, forwarderAddress, aztecGateway7683, configureForwarder, configureL2Gateway);
    }

    function config(
        address l2GatewayAddress, 
        address forwarderAddress, 
        bytes32 aztecGateway7683,
        bool configureForwarder,
        bool configureL2Gateway
    ) internal {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        // Set Aztec Gateway on Forwarder
        if (configureForwarder && forwarderAddress != address(0)) {
            console.log("Setting Aztec Gateway on Forwarder...");
            Forwarder(forwarderAddress).setAztecGateway7683(aztecGateway7683);
        }

        // Set Aztec Gateway on L2Gateway7683
        if (configureL2Gateway && l2GatewayAddress != address(0)) {
            console.log("Setting Aztec Gateway on L2Gateway7683...");
            L2Gateway7683(l2GatewayAddress).setAztecGateway7683(aztecGateway7683);
            
            // Set Forwarder on L2Gateway7683
            if (forwarderAddress != address(0)) {
                console.log("Setting Forwarder on L2Gateway7683...");
                L2Gateway7683(l2GatewayAddress).setForwarder(forwarderAddress);
            }
        }

        vm.stopBroadcast();
    }
}
