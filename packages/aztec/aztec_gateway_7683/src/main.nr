pub mod config;
pub mod types;
pub mod utils;
mod test;

use dep::aztec::macros::aztec;

#[aztec]
pub contract AztecGateway7683 {
    // context.chain_id() returns 1, which corresponds to the mainnet, making it unsuitable for our use case.
    // Instead, we designate 999999 as the destination domain.
    global LOCAL_DOMAIN: u32 = 999999;

    global UNKNOWN: Field = 0;
    global OPENED: Field = 1;
    global FILLED: Field = 2;
    global FILLED_PRIVATELY: Field = 3;
    global SETTLED: Field = 4;
    global REFUNDED: Field = 5;

    global SETTLE_ORDER_TYPE: [u8; 32] = [
        25, 30, 167, 118, 189, 110, 12, 213, 106, 109, 68, 186, 74, 234, 47, 236, 70, 139, 74, 11,
        76, 29, 136, 13, 64, 37, 146, 158, 235, 97, 93, 13,
    ]; // sha256("SETTLE_ORDER_TYPE")
    global REFUND_ORDER_TYPE: [u8; 32] = [
        102, 173, 54, 216, 202, 16, 109, 169, 101, 99, 85, 97, 82, 171, 164, 185, 22, 236, 105, 110,
        205, 208, 138, 62, 94, 211, 104, 244, 228, 115, 165, 56,
    ]; // sha256("REFUND_ORDER_TYPE")
    global SECRET: [u8; 6] = [83, 69, 67, 82, 69, 84]; // SECRET

    use crate::{
        config::Config,
        types::{
            events::{Filled, Open, Settled},
            helpers::InternalRCOParams,
            onchain_cross_chain_order::OnchainCrossChainOrder,
            order_data::{
                ORDER_DATA_LENGTH, ORDER_DATA_TYPE, OrderData, PRIVATE_ORDER,
                PRIVATE_ORDER_WITH_HOOK, PUBLIC_ORDER, PUBLIC_ORDER_WITH_HOOK,
            },
            resolved_cross_chain_order::{
                FILL_INSTRUCTIONS_MAX_INSTRUCTIONS, FillInstruction, MAX_SPENT_MAX_OUTPUTS,
                MIN_RECEIVED_MAX_OUTPUTS, Output, RESOLVED_CROSS_CHAIN_LENGTH,
                ResolvedCrossChainOrder,
            },
        },
        utils::{u32_to_u8_4, u8_32_to_aztec_address, u8_32_to_eth_address, u8_32_to_u128},
    };
    use dep::aztec::{
        macros::{functions::{external, initializer, internal, view}, storage::storage},
        protocol_types::{
            address::{AztecAddress, EthAddress},
            hash::{poseidon2_hash, sha256_to_field},
            traits::{Packable, Serialize},
        },
        state_vars::{Map, PublicImmutable, PublicMutable},
    };
    use token::Token;

    #[storage]
    struct Storage<Context> {
        config: PublicImmutable<Config, Context>,
        claimable_orders: Map<Field, PublicMutable<Field, Context>, Context>,
        order_status: Map<Field, PublicMutable<Field, Context>, Context>,
        used_nonces: Map<AztecAddress, Map<Field, PublicMutable<bool, Context>, Context>, Context>,
        orders_settlement_block_numbers: Map<Field, PublicMutable<Field, Context>, Context>,
        orders_refund_block_numbers: Map<Field, PublicMutable<Field, Context>, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(l2Gateway: EthAddress, l2GatewayDomain: u32, forwarder: EthAddress) {
        storage.config.initialize(Config { l2Gateway, l2GatewayDomain, forwarder });
    }

    #[external("private")]
    fn claim_private(
        secret: Field,
        order_id_bytes: [u8; 32],
        origin_data_bytes: [u8; ORDER_DATA_LENGTH],
        filler_data_bytes: [u8; 32],
    ) {
        let order_id = Field::from_be_bytes(order_id_bytes);
        let order_data = OrderData::decode(origin_data_bytes);
        assert(order_data.id() == order_id, "Invalid id");

        AztecGateway7683::at(context.this_address())
            ._assert_order_status_private(order_id, FILLED_PRIVATELY)
            .enqueue(&mut context);

        // verify that a commitment exists for the given order.
        AztecGateway7683::at(context.this_address())
            ._check_if_order_is_claimable_private(
                order_id,
                _get_claimable_order_commitment(order_id, filler_data_bytes),
            )
            .enqueue(&mut context);

        let order_data = OrderData::decode(origin_data_bytes);
        assert(
            poseidon2_hash([secret]) == Field::from_be_bytes(order_data.recipient),
            "Invalid secret",
        );

        // transfer from gateway public balance to user private balance
        let token = u8_32_to_aztec_address(order_data.output_token);
        Token::at(token)
            .transfer_public_to_private(
                context.this_address(),
                context.msg_sender().unwrap(),
                u8_32_to_u128(order_data.amount_out),
                0
            )
            .call(&mut context);

        AztecGateway7683::at(context.this_address())
            ._update_order_status_private(order_id, FILLED)
            .enqueue(&mut context);

        AztecGateway7683::at(context.this_address())
            ._trigger_settlement(
                order_id,
                _get_settle_content_hash(order_id_bytes, filler_data_bytes),
            )
            .enqueue(&mut context);
    }

    #[external("public")]
    fn claim_refund(
        order_id_bytes: [u8; 32],
        order_data_bytes: [u8; ORDER_DATA_LENGTH],
        message_leaf_index: Field,
    ) {
        let order_id = Field::from_be_bytes(order_id_bytes);
        let order_data = OrderData::decode(order_data_bytes);
        assert(order_data.id() == order_id, "Invalid id");
        assert(storage.order_status.at(order_id).read() == OPENED, "Order not opened");
        storage.order_status.at(order_id).write(REFUNDED);

        assert(
            (order_data.order_type == PUBLIC_ORDER)
                | (order_data.order_type == PUBLIC_ORDER_WITH_HOOK),
            "Not a public order",
        );
        let config = storage.config.read();
        assert(
            u8_32_to_eth_address(order_data.destination_settler) == config.l2Gateway,
            "Invalid destination settler",
        );
        assert(
            order_data.destination_domain == config.l2GatewayDomain,
            "Invalid destination domain",
        );

        context.consume_l1_to_l2_message(
            _get_refund_content_hash(order_id_bytes),
            Field::from_be_bytes(SECRET),
            storage.config.read().forwarder,
            message_leaf_index,
        );

        Token::at(u8_32_to_aztec_address(order_data.input_token))
            .transfer_public_to_public(
                context.this_address(),
                u8_32_to_aztec_address(order_data.sender),
                u8_32_to_u128(order_data.amount_in),
                0,
            )
            .call(&mut context);
        // TODO: emit Refunded
    }

    #[external("private")]
    fn claim_refund_private(
        secret: Field,
        order_id_bytes: [u8; 32],
        origin_data_bytes: [u8; ORDER_DATA_LENGTH],
        message_leaf_index: Field,
    ) {
        let order_id = Field::from_be_bytes(order_id_bytes);
        let order_data = OrderData::decode(origin_data_bytes);
        assert(order_data.id() == order_id, "Invalid id");

        AztecGateway7683::at(context.this_address())._check_refund_private(order_id).enqueue(
            &mut context,
        );

        let order_data = OrderData::decode(origin_data_bytes);
        let order_type = order_data.order_type;
        assert(
            poseidon2_hash([secret]) == Field::from_be_bytes(order_data.recipient),
            "Invalid secret",
        );
        assert(
            (order_type == PRIVATE_ORDER) | (order_type == PRIVATE_ORDER_WITH_HOOK),
            "Not a private order",
        );
        let config = storage.config.read();
        assert(
            u8_32_to_eth_address(order_data.destination_settler) == config.l2Gateway,
            "Invalid destination settler",
        );
        assert(
            order_data.destination_domain == config.l2GatewayDomain,
            "Invalid destination domain",
        );

        context.consume_l1_to_l2_message(
            _get_refund_content_hash(order_id_bytes),
            Field::from_be_bytes(SECRET),
            storage.config.read().forwarder,
            message_leaf_index,
        );

        let token = u8_32_to_aztec_address(order_data.input_token);
        Token::at(token)
            .transfer_public_to_private(
                context.this_address(),
                context.msg_sender().unwrap(),
                u8_32_to_u128(order_data.amount_in),
                0
            )
            .call(&mut context);
    }

    #[external("public")]
    fn fill(
        order_id_bytes: [u8; 32],
        origin_data_bytes: [u8; ORDER_DATA_LENGTH],
        filler_data_bytes: [u8; 32],
    ) {
        let order_id = Field::from_be_bytes(order_id_bytes);
        let order_data = OrderData::decode(origin_data_bytes);
        assert(order_id == order_data.id(), "Invalid id");

        let order_type = order_data.order_type;
        assert(
            (order_type == PUBLIC_ORDER) | (order_type == PUBLIC_ORDER_WITH_HOOK),
            "Not a public order",
        );
        assert(storage.order_status.at(order_id).read() == UNKNOWN, "Invalid status");
        assert(context.timestamp() as u32 <= order_data.fill_deadline, "Order fill expired");
        assert(order_data.destination_domain == LOCAL_DOMAIN, "Invalid destination domain");
        storage.order_status.at(order_id).write(FILLED);

        // transfer from filler public balance to gateway public balance
        Token::at(u8_32_to_aztec_address(order_data.output_token))
            .transfer_public_to_public(
                context.msg_sender().unwrap(),
                u8_32_to_aztec_address(order_data.recipient),
                u8_32_to_u128(order_data.amount_out),
                Field::from_be_bytes(order_data.sender_nonce),
            )
            .call(&mut context);

        AztecGateway7683::at(context.this_address())
            ._trigger_settlement(
                order_id,
                _get_settle_content_hash(order_id_bytes, filler_data_bytes), // at the moment filler data contains the ethereum address where the filler wants to receive the funds during the settlement
            )
            .call(&mut context);

        context.emit_public_log(Filled {
            order_id: order_id_bytes,
            origin_data: origin_data_bytes,
            filler_data: filler_data_bytes,
        }
            .pack());
    }

    #[external("private")]
    fn fill_private(
        order_id_bytes: [u8; 32],
        origin_data_bytes: [u8; ORDER_DATA_LENGTH],
        filler_data_bytes: [u8; 32],
    ) {
        let order_data = OrderData::decode(origin_data_bytes);
        let order_id = Field::from_be_bytes(order_id_bytes);
        assert(order_id == order_data.id(), "Invalid id");

        // transfer from filler private balance to gateway public balance
        Token::at(u8_32_to_aztec_address(order_data.output_token))
            .transfer_private_to_public(
                context.msg_sender().unwrap(),
                context.this_address(),
                u8_32_to_u128(order_data.amount_out),
                Field::from_be_bytes(order_data.sender_nonce),
            )
            .call(&mut context);

        assert(order_data.destination_domain == LOCAL_DOMAIN, "Invalid destination domain");
        assert(
            (order_data.order_type == PRIVATE_ORDER)
                | (order_data.order_type == PRIVATE_ORDER_WITH_HOOK),
            "Not a private order",
        );
        AztecGateway7683::at(context.this_address())
            ._fill_private(
                order_id,
                order_id_bytes,
                origin_data_bytes,
                filler_data_bytes,
                order_data.fill_deadline,
            )
            .enqueue(&mut context);
    }

    #[external("public")]
    #[view]
    fn get_order_status(order_id: Field) -> Field {
        storage.order_status.at(order_id).read()
    }

    #[external("public")]
    #[view]
    fn get_order_refund_block_number(order_id: Field) -> Field {
        storage.orders_refund_block_numbers.at(order_id).read()
    }

    #[external("public")]
    #[view]
    fn get_order_settlement_block_number(order_id: Field) -> Field {
        storage.orders_settlement_block_numbers.at(order_id).read()
    }

    #[external("public")]
    fn open(order: OnchainCrossChainOrder) {
        assert(order.order_data_type == ORDER_DATA_TYPE, "Invalid data type");

        let data = _resolve(order, context.msg_sender().unwrap(), context.timestamp() as u32);
        let resolved_order = data.resolved_cross_chain_order;
        let order_id = data.order_id;
        let nonce = Field::from_be_bytes(data.order_data.sender_nonce);
        let order_type = data.order_data.order_type;
        assert(
            (order_type == PUBLIC_ORDER) | (order_type == PUBLIC_ORDER_WITH_HOOK),
            "Not a public order",
        );
        assert(data.order_data.origin_domain == LOCAL_DOMAIN, "Invalid origin domain");
        assert(!storage.used_nonces.at(context.msg_sender().unwrap()).at(nonce).read(), "Invalid nonce");

        storage.order_status.at(order_id).write(OPENED);
        storage.used_nonces.at(context.msg_sender().unwrap()).at(nonce).write(true);

        for i in 0..resolved_order.min_received.len() {
            let min_received = resolved_order.min_received[i];

            Token::at(u8_32_to_aztec_address(min_received.token))
                .transfer_public_to_public(
                    context.msg_sender().unwrap(),
                    context.this_address(),
                    u8_32_to_u128(min_received.amount),
                    nonce,
                )
                .call(&mut context);
        }

        let event = Open::new(resolved_order.order_id, resolved_order.serialize());
        context.emit_public_log(event.open1.pack());
        context.emit_public_log(event.open2.pack());
    }

    #[external("private")]
    fn open_private(order: OnchainCrossChainOrder) {
        assert(order.order_data_type == ORDER_DATA_TYPE, "Invalid data type");

        // Force the sender to be zero in order to avoid creating a connection between the sender and the recipient
        let data = _resolve(order, AztecAddress::zero(), 0 as u32);
        let resolved_order = data.resolved_cross_chain_order;
        let order_id = data.order_id;
        let nonce = Field::from_be_bytes(data.order_data.sender_nonce);

        assert(
            (data.order_data.order_type == PRIVATE_ORDER)
                | (data.order_data.order_type == PRIVATE_ORDER_WITH_HOOK),
            "Not a private order",
        );
        assert(data.order_data.origin_domain == LOCAL_DOMAIN, "Invalid origin domain");

        AztecGateway7683::at(context.this_address())
            ._assert_nonce_and_set_order_status_private(order_id, nonce)
            .enqueue(&mut context);

        for i in 0..resolved_order.min_received.len() {
            let min_received = resolved_order.min_received[i];

            // transfer from user private balance to gateway public balance
            Token::at(u8_32_to_aztec_address(min_received.token))
                .transfer_private_to_public(
                    context.msg_sender().unwrap(),
                    context.this_address(),
                    u8_32_to_u128(min_received.amount),
                    nonce,
                )
                .call(&mut context);
        }

        AztecGateway7683::at(context.this_address())
            ._emit_open_private(resolved_order.order_id, resolved_order.serialize())
            .enqueue(&mut context);
    }

    #[external("public")]
    fn refund(order_id_bytes: [u8; 32], origin_data_bytes: [u8; ORDER_DATA_LENGTH]) {
        let order_id = Field::from_be_bytes(order_id_bytes);
        let order_data = OrderData::decode(origin_data_bytes);
        assert(order_data.id() == order_id, "Invalid id");
        assert(storage.order_status.at(order_id).read() == UNKNOWN, "Invalid status");
        assert(context.timestamp() as u32 > order_data.fill_deadline, "Order not expired");
        storage.orders_refund_block_numbers.at(order_id).write(context.block_number() as Field);
        context.message_portal(
            storage.config.read().forwarder,
            _get_refund_content_hash(order_id_bytes),
        );
    }

    #[external("public")]
    fn settle(
        order_id_bytes: [u8; 32],
        origin_data_bytes: [u8; ORDER_DATA_LENGTH],
        filler_data_bytes: [u8; 32],
        message_leaf_index: Field,
    ) {
        let order_id = Field::from_be_bytes(order_id_bytes);
        let order_data = OrderData::decode(origin_data_bytes);
        assert(order_data.id() == order_id, "Invalid id");
        assert(storage.order_status.at(order_id).read() == OPENED, "Invalid status");
        assert(
            (order_data.order_type == PUBLIC_ORDER)
                | (order_data.order_type == PUBLIC_ORDER_WITH_HOOK),
            "Not a public order",
        );
        let config = storage.config.read();
        assert(
            u8_32_to_eth_address(order_data.destination_settler) == config.l2Gateway,
            "Invalid destination settler",
        );
        assert(
            order_data.destination_domain == config.l2GatewayDomain,
            "Invalid destination domain",
        );

        context.consume_l1_to_l2_message(
            _get_settle_content_hash(order_id_bytes, filler_data_bytes),
            Field::from_be_bytes(SECRET),
            storage.config.read().forwarder,
            message_leaf_index,
        );

        // transfer from gateway public balance to user public balande
        Token::at(u8_32_to_aztec_address(order_data.input_token))
            .transfer_public_to_public(
                context.this_address(),
                u8_32_to_aztec_address(filler_data_bytes),
                u8_32_to_u128(order_data.amount_in),
                0,
            )
            .call(&mut context);

        storage.order_status.at(order_id).write(SETTLED);
        context.emit_public_log(Settled { order_id: order_id_bytes, receiver: filler_data_bytes }
            .pack());
    }

    #[external("private")]
    fn settle_private(
        order_id_bytes: [u8; 32],
        origin_data_bytes: [u8; ORDER_DATA_LENGTH],
        filler_data_bytes: [u8; 32],
        message_leaf_index: Field,
    ) {
        let order_id = Field::from_be_bytes(order_id_bytes);
        let order_data = OrderData::decode(origin_data_bytes);
        assert(order_data.id() == order_id, "Invalid id");

        AztecGateway7683::at(context.this_address())
            ._assert_order_status_private(order_id, OPENED)
            .enqueue(&mut context);

        assert(
            (order_data.order_type == PRIVATE_ORDER)
                | (order_data.order_type == PRIVATE_ORDER_WITH_HOOK),
            "Not a private order",
        );
        let config = storage.config.read();
        assert(
            u8_32_to_eth_address(order_data.destination_settler) == config.l2Gateway,
            "Invalid destination settler",
        );
        assert(
            order_data.destination_domain == config.l2GatewayDomain,
            "Invalid destination domain",
        );

        context.consume_l1_to_l2_message(
            _get_settle_content_hash(order_id_bytes, filler_data_bytes),
            Field::from_be_bytes(SECRET),
            storage.config.read().forwarder,
            message_leaf_index,
        );

        let filler = u8_32_to_aztec_address(filler_data_bytes);
        let token = u8_32_to_aztec_address(order_data.input_token);
        Token::at(token)
            .transfer_public_to_private(
                context.this_address(),
                filler,
                u8_32_to_u128(order_data.amount_in),
                0
            )
            .call(&mut context);

        AztecGateway7683::at(context.this_address())
            ._update_order_status_private(order_id, SETTLED)
            .enqueue(&mut context);

        AztecGateway7683::at(context.this_address())
            ._emit_settled_private(order_id_bytes, filler_data_bytes)
            .enqueue(&mut context);
    }

    #[external("public")]
    #[internal]
    fn _assert_nonce_and_set_order_status_private(order_id: Field, nonce: Field) {
        assert(!storage.used_nonces.at(context.msg_sender().unwrap()).at(nonce).read(), "Invalid nonce");
        storage.used_nonces.at(context.msg_sender().unwrap()).at(nonce).write(true);
        storage.order_status.at(order_id).write(OPENED);
    }

    #[external("public")]
    #[internal]
    fn _assert_order_status_private(order_id: Field, status: Field) {
        assert(storage.order_status.at(order_id).read() == status, "Invalid status");
    }

    #[external("public")]
    #[internal]
    fn _check_if_order_is_claimable_private(order_id: Field, claimable_order_commitment: Field) {
        assert(
            storage.claimable_orders.at(order_id).read() == claimable_order_commitment,
            "Invalid order",
        );
    }

    #[external("public")]
    #[internal]
    fn _check_refund_private(order_id: Field) {
        assert(storage.order_status.at(order_id).read() == OPENED, "Order not opened");
        storage.order_status.at(order_id).write(REFUNDED);
        // TODO: emit Refunded
    }

    #[external("public")]
    #[internal]
    fn _emit_open_private(
        order_id_bytes: [u8; 32],
        resolved_order_bytes: [Field; RESOLVED_CROSS_CHAIN_LENGTH],
    ) {
        let event = Open::new(order_id_bytes, resolved_order_bytes);
        context.emit_public_log(event.open1.pack());
        context.emit_public_log(event.open2.pack());
    }

    #[external("public")]
    #[internal]
    fn _emit_settled_private(order_id_bytes: [u8; 32], receiver: [u8; 32]) {
        context.emit_public_log(Settled { order_id: order_id_bytes, receiver }.pack());
    }

    #[external("public")]
    #[internal]
    fn _fill_private(
        order_id: Field,
        order_id_bytes: [u8; 32],
        origin_data_bytes: [u8; ORDER_DATA_LENGTH],
        filler_data_bytes: [u8; 32],
        fill_deadline: u32,
    ) {
        assert(storage.order_status.at(order_id).read() == UNKNOWN, "Invalid status");
        assert(context.timestamp() as u32 <= fill_deadline, "Order is expired");

        let order_commitment = _get_claimable_order_commitment(order_id, filler_data_bytes);
        storage.claimable_orders.at(order_id).write(order_commitment);
        storage.order_status.at(order_id).write(FILLED_PRIVATELY);
        context.emit_public_log(Filled {
            order_id: order_id_bytes,
            origin_data: origin_data_bytes,
            filler_data: filler_data_bytes,
        }
            .pack());
    }

    #[external("public")]
    #[internal]
    fn _trigger_settlement(order_id: Field, content_hash: Field) {
        storage.orders_settlement_block_numbers.at(order_id).write(context.block_number() as Field);
        context.message_portal(storage.config.read().forwarder, content_hash);
    }

    #[external("public")]
    #[internal]
    fn _update_order_status_private(order_id: Field, status: Field) {
        storage.order_status.at(order_id).write(status);
    }

    #[contract_library_method]
    fn _get_claimable_order_commitment(order_id: Field, filler_data_bytes: [u8; 32]) -> Field {
        poseidon2_hash([order_id, Field::from_be_bytes(filler_data_bytes)])
    }

    #[contract_library_method]
    fn _get_settle_content_hash(order_id_bytes: [u8; 32], filler_data_bytes: [u8; 32]) -> Field {
        let mut hash_bytes = [0; 96];
        for i in 0..32 {
            hash_bytes[i] = SETTLE_ORDER_TYPE[i];
            hash_bytes[i + 32] = order_id_bytes[i];
            hash_bytes[i + 64] = filler_data_bytes[i];
        }
        sha256_to_field(hash_bytes)
    }

    #[contract_library_method]
    fn _get_refund_content_hash(order_id_bytes: [u8; 32]) -> Field {
        let mut hash_bytes = [0; 64];
        for i in 0..32 {
            hash_bytes[i] = REFUND_ORDER_TYPE[i];
            hash_bytes[i + 32] = order_id_bytes[i];
        }
        sha256_to_field(hash_bytes)
    }

    #[contract_library_method]
    fn _resolve(
        order: OnchainCrossChainOrder,
        sender: AztecAddress,
        timestamp: u32,
    ) -> InternalRCOParams {
        let mut order_data = OrderData::decode(order.order_data);
        let order_id = order_data.id();

        assert(order_data.fill_deadline == order.fill_deadline, "Invalid fill deadline");
        assert(u8_32_to_aztec_address(order_data.sender) == sender, "Invalid sender");

        let destination_domain_bytes = u32_to_u8_4(order_data.destination_domain);
        let min_received_output = Output {
            token: order_data.input_token,
            recipient: [0; 32],
            amount: order_data.amount_in,
            chain_id: u32_to_u8_4(order_data.origin_domain),
        };
        let min_received: [Output; MIN_RECEIVED_MAX_OUTPUTS] =
            [min_received_output; MIN_RECEIVED_MAX_OUTPUTS];

        let max_spent_output = Output {
            token: order_data.output_token,
            recipient: order_data.recipient,
            amount: order_data.amount_out,
            chain_id: destination_domain_bytes,
        };
        let max_spent: [Output; MAX_SPENT_MAX_OUTPUTS] = [max_spent_output; MAX_SPENT_MAX_OUTPUTS];

        let fill_instruction = FillInstruction {
            destination_chain_id: destination_domain_bytes,
            destination_settler: order_data.destination_settler,
            origin_data: order.order_data,
        };
        let fill_instructions: [FillInstruction; FILL_INSTRUCTIONS_MAX_INSTRUCTIONS] =
            [fill_instruction; FILL_INSTRUCTIONS_MAX_INSTRUCTIONS];

        let order_id_bytes = order_id.to_be_bytes();
        let resolved_order = ResolvedCrossChainOrder {
            user: order_data.sender,
            origin_chain_id: u32_to_u8_4(LOCAL_DOMAIN),
            open_deadline: u32_to_u8_4(timestamp),
            fill_deadline: u32_to_u8_4(order.fill_deadline),
            order_id: order_id_bytes,
            min_received,
            max_spent,
            fill_instructions,
        };

        InternalRCOParams { order_id, resolved_cross_chain_order: resolved_order, order_data }
    }

}
