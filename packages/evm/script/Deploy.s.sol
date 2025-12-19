// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {L2Gateway7683} from "../src/L2Gateway7683.sol";
import {Forwarder} from "../src/Forwarder.sol";
import {TestToken} from "../src/TestToken.sol";

contract Deploy is Script {
    function run() external {
        address permit2 = vm.envOr("PERMIT2", address(0));
        address aztecInbox = vm.envOr("AZTEC_INBOX", address(0));
        address aztecOutbox = vm.envOr("AZTEC_OUTBOX", address(0));
        address anchorStateRegistry = vm.envOr("ANCHOR_STATE_REGISTRY", address(0));
        bytes32 aztecGateway7683 = vm.envOr("AZTEC_GATEWAY_7683", bytes32(0));
        bool deployTestToken = vm.envOr("DEPLOY_TEST_TOKEN", false);
        bool deployL2Gateway = vm.envOr("DEPLOY_L2_GATEWAY", true);
        bool deployForwarder = vm.envOr("DEPLOY_FORWARDER", true);
        address l2GatewayAddress = vm.envOr("L2_GATEWAY_ADDRESS", address(0));

        deploy(permit2, aztecInbox, aztecOutbox, anchorStateRegistry, aztecGateway7683, deployTestToken, deployL2Gateway, deployForwarder, l2GatewayAddress);
    }

    function run(
        address permit2,
        address aztecInbox,
        address aztecOutbox,
        address anchorStateRegistry,
        bytes32 aztecGateway7683,
        bool deployTestToken,
        bool deployL2Gateway,
        bool deployForwarder,
        address l2GatewayAddress
    ) external {
        deploy(permit2, aztecInbox, aztecOutbox, anchorStateRegistry, aztecGateway7683, deployTestToken, deployL2Gateway, deployForwarder, l2GatewayAddress);
    }

    function deploy(
        address permit2,
        address aztecInbox,
        address aztecOutbox,
        address anchorStateRegistry,
        bytes32 aztecGateway7683,
        bool deployTestToken,
        bool deployL2Gateway,
        bool deployForwarder,
        address l2GatewayAddress
    ) internal {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        TestToken token;
        // Deploy TestToken
        if (deployTestToken) {
            token = new TestToken("Test Token", "TEST", 18, 1000000 * 10**18);
        }

        L2Gateway7683 gateway;
        if (deployL2Gateway) {
            // Deploy L2Gateway7683
            gateway = new L2Gateway7683(permit2);
        } else {
            gateway = L2Gateway7683(l2GatewayAddress);
        }

        Forwarder forwarder;
        if (deployForwarder) {
            require(address(gateway) != address(0), "L2Gateway address required for Forwarder");
            // Deploy Forwarder
            forwarder = new Forwarder(
                address(gateway),
                aztecInbox,
                aztecOutbox,
                anchorStateRegistry
            );
        }

        // Set forwarder in gateway if both deployed in this run
        if (deployL2Gateway && deployForwarder) {
            gateway.setForwarder(address(forwarder));
        }

        // Set Aztec Gateway if provided
        if (aztecGateway7683 != bytes32(0)) {
            if (deployL2Gateway) {
                gateway.setAztecGateway7683(aztecGateway7683);
            }
            if (deployForwarder) {
                forwarder.setAztecGateway7683(aztecGateway7683);
            }
        }

        vm.stopBroadcast();

        string memory jsonObj = "deployment_output";
        
        if (address(gateway) != address(0)) {
            console.log("L2Gateway7683 deployed at:", address(gateway));
            vm.serializeAddress(jsonObj, "L2Gateway7683", address(gateway));
        }
        
        if (address(forwarder) != address(0)) {
            console.log("Forwarder deployed at:", address(forwarder));
            string memory finalJson = vm.serializeAddress(jsonObj, "Forwarder", address(forwarder));
            vm.writeJson(finalJson, "./deployments/deployment.json");
        } else {
             // Write what we have
             string memory finalJson = vm.serializeAddress(jsonObj, "L2Gateway7683", address(gateway)); // Re-serialize to get the string
             vm.writeJson(finalJson, "./deployments/deployment.json");
        }

        if (address(token) != address(0)) {
            console.log("TestToken deployed at:", address(token));
            // We need to read the existing json or just overwrite/append. 
            // vm.writeJson overwrites. 
            // Let's just serialize everything again to be safe.
            vm.serializeAddress(jsonObj, "L2Gateway7683", address(gateway));
            if (address(forwarder) != address(0)) {
                vm.serializeAddress(jsonObj, "Forwarder", address(forwarder));
            }
            string memory finalJson = vm.serializeAddress(jsonObj, "TestToken", address(token));
            vm.writeJson(finalJson, "./deployments/deployment.json");
        }
    }
}
