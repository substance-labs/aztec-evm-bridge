mod config;
mod utils;

use dep::aztec::macros::aztec;

#[aztec]
pub contract Proxy {
    use crate::{
        config::Config,
        utils::{u8_32_to_aztec_address, u8_32_to_eth_address, u8_32_to_u128},
    };
    use dep::authwit::auth::{compute_authwit_message_hash_from_call, set_authorized};
    use dep::aztec::{
        macros::{functions::{initializer, internal, private, public}, storage::storage},
        prelude::{AztecAddress, EthAddress, FunctionSelector, PublicImmutable},
        protocol_types::traits::ToField,
    };

    use aztec_gateway_7683::{
        AztecGateway7683,
        types::{onchain_cross_chain_order::OnchainCrossChainOrder, order_data::OrderData},
    };
    use token::Token;

    #[storage]
    struct Storage<Context> {
        config: PublicImmutable<Config, Context>,
    }

    #[public]
    #[initializer]
    fn constructor(gateway: AztecAddress, vault: EthAddress) {
        storage.config.initialize(Config { gateway, vault });
    }

    #[private]
    fn deposit(
        order: OnchainCrossChainOrder,
        verification_key: [Field; 128],
        proof: [Field; 456],
        public_inputs: [Field; 12],
        key_hash: Field,
    ) {
        std::verify_proof_with_type(verification_key, proof, public_inputs, key_hash, 1); // 1 = HONK_IDENTIFIER

        let order_data = OrderData::decode(order.order_data);
        assert(
            u8_32_to_eth_address(order_data.recipient) == storage.config.read().vault,
            "invalid recipient",
        );
        assert(
            u8_32_to_aztec_address(order_data.sender) == context.this_address(),
            "invalid sender",
        );

        let token = u8_32_to_aztec_address(order_data.input_token);
        let amount = u8_32_to_u128(order_data.amount_in);
        let nonce = Field::from_be_bytes(order_data.sender_nonce);
        Token::at(token)
            .transfer_to_public(context.msg_sender(), context.this_address(), amount, 1)
            .call(&mut context);

        Proxy::at(context.this_address())._deposit(token, amount, nonce, order).enqueue(&mut context);
    }

    #[public]
    #[internal]
    fn _deposit(token: AztecAddress, amount: u128, nonce: Field, order: OnchainCrossChainOrder) {
        let gateway = storage.config.read().gateway;

        let selector =
            FunctionSelector::from_signature("transfer_in_public((Field),(Field),u128,Field)");
        let message_hash = compute_authwit_message_hash_from_call(
            gateway,
            token,
            context.chain_id(),
            context.version(),
            selector,
            [context.this_address().to_field(), gateway.to_field(), amount as Field, nonce],
        );
        set_authorized(&mut context, message_hash, true);
        AztecGateway7683::at(gateway).open(/*order*/).call(&mut context);
    }

}
