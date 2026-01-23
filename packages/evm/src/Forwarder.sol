// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IOutbox} from "@aztec/contracts/core/interfaces/messagebridge/IOutbox.sol";
import {IInbox, DataStructures} from "@aztec/contracts/core/interfaces/messagebridge/IInbox.sol";
import {DataStructures} from "@aztec/contracts/core/libraries/DataStructures.sol";
import {IAnchorStateRegistry} from "@optimism/contracts/interfaces/dispute/IAnchorStateRegistry.sol";
import {Hash} from "@optimism/contracts/src/dispute/lib/Types.sol";
import {StateValidator} from "./libs/StateValidator.sol";
import {IForwarder} from "./interfaces/IForwarder.sol";

contract Forwarder is IForwarder, Ownable {
    uint256 private constant L2_GATEWAY_FILLED_ORDERS_SLOT = 51;
    uint256 private constant L2_GATEWAY_REFUNDED_ORDERS_SLOT = 52;
    uint256 private constant AZTEC_VERSION = 1647720761;
    bytes32 private constant SETTLE_ORDER_TYPE = sha256(abi.encodePacked("SETTLE_ORDER_TYPE"));
    bytes32 private constant REFUND_ORDER_TYPE = sha256(abi.encodePacked("REFUND_ORDER_TYPE"));
    bytes32 public constant SECRET_HASH = sha256(abi.encodePacked("SECRET"));

    address public immutable L2_GATEWAY;
    address public immutable AZTEC_INBOX;
    address public immutable AZTEC_OUTBOX;
    address public immutable ANCHOR_STATE_REGISTRY;
    bytes32 public AZTEC_GATEWAY_7683;

    mapping(bytes32 => bool) private _settledOrders;
    mapping(bytes32 => bool) private _refundedOrders;

    constructor(address l2Gateway, address aztecInbox, address aztecOutbox, address anchorStateRegistry)
        Ownable(msg.sender)
    {
        L2_GATEWAY = l2Gateway;
        AZTEC_INBOX = aztecInbox;
        AZTEC_OUTBOX = aztecOutbox;
        ANCHOR_STATE_REGISTRY = anchorStateRegistry;
    }

    function forwardRefundToAztec(
        bytes32 orderId,
        bytes calldata originData,
        StateValidator.AccountProofParameters memory accountProofParams
    ) external {
        _checkOrderStorageKey(bytes32(accountProofParams.storageKey), orderId, L2_GATEWAY_REFUNDED_ORDERS_SLOT);
        require(bytes32(accountProofParams.storageValue) == keccak256(originData), InvalidRefundedOrderCommitment());
        bytes memory message = abi.encodePacked(REFUND_ORDER_TYPE, orderId);
        _validateAccountStorageAgainstAnchorRegistryStateRootAndSendMessageToAztec(accountProofParams, message);
        emit RefundForwardedToAztec(message);
    }

    function forwardRefundToL2(
        DataStructures.L2ToL1Msg memory l2ToL1Message,
        bytes calldata message,
        uint256 aztecBlockNumber,
        uint256 leafIndex,
        bytes32[] calldata path
    ) external {
        bytes32 messageHash = _checkAndConsumeAztecMessage(l2ToL1Message, message, aztecBlockNumber, leafIndex, path);
        _refundedOrders[messageHash] = true;
        emit RefundForwardedToL2(message);
    }

    function forwardSettleToAztec(
        bytes32 orderId,
        bytes calldata originData,
        bytes calldata fillerData,
        StateValidator.AccountProofParameters memory accountProofParams
    ) external {
        _checkOrderStorageKey(bytes32(accountProofParams.storageKey), orderId, L2_GATEWAY_FILLED_ORDERS_SLOT);
        require(
            bytes32(accountProofParams.storageValue) == keccak256(abi.encodePacked(originData, fillerData)),
            InvalidFilledOrderCommitment()
        );
        // NOTE: The filler data is currently only 32 bytes and contains the address of the filler on Aztec, where the funds will be received.
        // It is also possible to include the hash of the filler address within `fillerData` and privately settle on Aztec.
        // However, an attacker could front-run the settlement using a secret, thereby preventing the filler from settling,
        // as the filler would not know the secret and thus would be unable to receive the tokens.
        // For this reason, and for simplicity, we hardcode a fixed value as the secret hash to avoid this problem.
        bytes memory message = abi.encodePacked(SETTLE_ORDER_TYPE, orderId, bytes32(fillerData));
        _validateAccountStorageAgainstAnchorRegistryStateRootAndSendMessageToAztec(accountProofParams, message);
        emit SettleForwardedToAztec(message);
    }

    function forwardSettleToL2(
        DataStructures.L2ToL1Msg memory l2ToL1Message,
        bytes calldata message,
        uint256 aztecBlockNumber,
        uint256 leafIndex,
        bytes32[] calldata path
    ) external {
        bytes32 messageHash = _checkAndConsumeAztecMessage(l2ToL1Message, message, aztecBlockNumber, leafIndex, path);
        _settledOrders[messageHash] = true;
        emit SettleForwardedToL2(message);
    }

    function _checkAndConsumeAztecMessage(
        DataStructures.L2ToL1Msg memory l2ToL1Message,
        bytes calldata message,
        uint256 aztecBlockNumber,
        uint256 leafIndex,
        bytes32[] calldata path
    ) internal returns (bytes32) {
        bytes32 messageHash = sha256(message) >> 8; // Represent it as an Aztec field element (BN254 scalar, encoded as bytes32)
        require(messageHash == l2ToL1Message.content, InvalidContent());
        require(l2ToL1Message.sender.actor == AZTEC_GATEWAY_7683, InvalidSender());
        // NOTE: recipient correctness is checked by Outbox
        IOutbox(AZTEC_OUTBOX).consume(l2ToL1Message, aztecBlockNumber, leafIndex, path);
        return messageHash;
    }

    function setAztecGateway7683(bytes32 aztecGateway7683) external onlyOwner {
        AZTEC_GATEWAY_7683 = aztecGateway7683;
    }

    function _checkOrderStorageKey(bytes32 storageKey, bytes32 orderId, uint256 slot) internal pure {
        require(storageKey == keccak256(abi.encode(orderId, slot)), InvalidStorageKey());
    }

    function _validateAccountStorageAgainstAnchorRegistryStateRootAndSendMessageToAztec(
        StateValidator.AccountProofParameters memory accountProofParams,
        bytes memory message
    ) internal {
        (Hash stateRoot,) = IAnchorStateRegistry(ANCHOR_STATE_REGISTRY).getAnchorRoot();
        require(
            StateValidator.validateAccountStorage(L2_GATEWAY, stateRoot.raw(), accountProofParams),
            InvalidAccountStorage()
        );
        bytes32 messageHash = sha256(message);
        IInbox(AZTEC_INBOX).sendL2Message(
            DataStructures.L2Actor({actor: AZTEC_GATEWAY_7683, version: AZTEC_VERSION}), messageHash, SECRET_HASH
        );
    }
}
