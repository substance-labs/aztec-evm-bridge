// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {BytesReader} from "./BytesReader.sol";

struct OrderData {
    bytes32 sender;
    bytes32 recipient;
    bytes32 inputToken;
    bytes32 outputToken;
    uint256 amountIn;
    uint256 amountOut;
    uint256 senderNonce;
    uint32 originDomain;
    uint32 destinationDomain;
    bytes32 destinationSettler;
    uint32 fillDeadline;
}
// bytes data;

library OrderEncoder {
    using BytesReader for bytes;

    error InvalidOrderLength();

    bytes constant ORDER_DATA_TYPE = abi.encodePacked(
        "OrderData(",
        "bytes32 sender,",
        "bytes32 recipient,",
        "bytes32 inputToken,",
        "bytes32 outputToken,",
        "uint256 amountIn,",
        "uint256 amountOut,",
        "uint256 senderNonce,",
        "uint32 originDomain,",
        "uint32 destinationDomain,",
        "bytes32 destinationSettler,",
        "uint32 fillDeadline)"
    );
    //"bytes data)"

    bytes32 constant ORDER_DATA_TYPE_HASH = keccak256(ORDER_DATA_TYPE);

    function orderDataType() internal pure returns (bytes32) {
        return ORDER_DATA_TYPE_HASH;
    }

    function id(OrderData memory order) internal pure returns (bytes32) {
        return sha256(encode(order));
    }

    function encode(OrderData memory order) internal pure returns (bytes memory) {
        return abi.encodePacked(
            order.sender,
            order.recipient,
            order.inputToken,
            order.outputToken,
            order.amountIn,
            order.amountOut,
            order.senderNonce,
            order.originDomain,
            order.destinationDomain,
            order.destinationSettler,
            order.fillDeadline
        );
    }

    function decode(bytes memory orderBytes) internal pure returns (OrderData memory order) {
        require(orderBytes.length == 268, InvalidOrderLength());

        order.sender = orderBytes.readBytes32(0);
        order.recipient = orderBytes.readBytes32(32);
        order.inputToken = orderBytes.readBytes32(64);
        order.outputToken = orderBytes.readBytes32(96);
        order.amountIn = orderBytes.readUint256(128);
        order.amountOut = orderBytes.readUint256(160);
        order.senderNonce = orderBytes.readUint256(192);
        order.originDomain = orderBytes.readUint32(224);
        order.destinationDomain = orderBytes.readUint32(228);
        order.destinationSettler = orderBytes.readBytes32(232);
        order.fillDeadline = orderBytes.readUint32(264);

        return order;
    }
}
