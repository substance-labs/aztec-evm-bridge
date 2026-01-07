use crate::AztecGateway7683;
use crate::types::{
    onchain_cross_chain_order::OnchainCrossChainOrder,
    order_data::{OrderData, ORDER_DATA_LENGTH, ORDER_DATA_TYPE, PUBLIC_ORDER},
};
use dep::aztec::{
    protocol_types::{
        address::{AztecAddress, EthAddress},
        traits::ToField,
    },
    test::helpers::test_environment::TestEnvironment,
};

pub struct TestSetup {
    pub env: TestEnvironment,
    pub gateway_address: AztecAddress,
    pub owner: AztecAddress,
    pub user1: AztecAddress,
    pub user2: AztecAddress,
    pub l2_gateway: EthAddress,
    pub l2_gateway_domain: u32,
    pub forwarder: EthAddress,
}

pub unconstrained fn setup() -> TestSetup {
    let mut env = TestEnvironment::new();
    
    // Create test accounts - use contract accounts for authwit support
    let owner = env.create_contract_account();
    let user1 = env.create_contract_account();
    let user2 = env.create_contract_account();
    
    // Mock addresses for L2 gateway and forwarder
    let l2_gateway = EthAddress::from_field(0x1234567890abcdef);
    let l2_gateway_domain = 1; // Ethereum mainnet
    let forwarder = EthAddress::from_field(0xfedcba0987654321);
    
    // Deploy the gateway contract
    let initializer = AztecGateway7683::interface().constructor(
        l2_gateway,
        l2_gateway_domain,
        forwarder,
    );
    
    let gateway_address = env
        .deploy("AztecGateway7683")
        .with_public_initializer(owner, initializer);
    
    TestSetup {
        env,
        gateway_address,
        owner,
        user1,
        user2,
        l2_gateway,
        l2_gateway_domain,
        forwarder,
    }
}

pub unconstrained fn create_test_order_data() -> OrderData {
    OrderData {
        sender: [1; 32],
        recipient: [2; 32],
        input_token: [3; 32],
        output_token: [4; 32],
        amount_in: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100],
        amount_out: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 95],
        sender_nonce: [5; 32],
        origin_domain: 1,
        destination_domain: 999999, // LOCAL_DOMAIN
        destination_settler: [6; 32],
        fill_deadline: 1000000,
        order_type: PUBLIC_ORDER,
        data: [7; 32],
    }
}

pub unconstrained fn create_test_order_data_with_sender(sender: AztecAddress) -> OrderData {
    let sender_field = sender.to_field();
    let sender_bytes = sender_field.to_be_bytes::<32>();
    
    OrderData {
        sender: sender_bytes,
        recipient: [2; 32],
        input_token: [3; 32],
        output_token: [4; 32],
        amount_in: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100],
        amount_out: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 95],
        sender_nonce: [5; 32],
        origin_domain: 999999, // LOCAL_DOMAIN
        destination_domain: 999999, // LOCAL_DOMAIN
        destination_settler: [6; 32],
        fill_deadline: 1000000,
        order_type: PUBLIC_ORDER,
        data: [7; 32],
    }
}

pub unconstrained fn encode_order_data(order_data: OrderData) -> [u8; ORDER_DATA_LENGTH] {
    let mut bytes = [0; ORDER_DATA_LENGTH];
    
    // Copy each field to the appropriate position
    for i in 0..32 { bytes[i] = order_data.sender[i]; }
    for i in 0..32 { bytes[32 + i] = order_data.recipient[i]; }
    for i in 0..32 { bytes[64 + i] = order_data.input_token[i]; }
    for i in 0..32 { bytes[96 + i] = order_data.output_token[i]; }
    for i in 0..32 { bytes[128 + i] = order_data.amount_in[i]; }
    for i in 0..32 { bytes[160 + i] = order_data.amount_out[i]; }
    for i in 0..32 { bytes[192 + i] = order_data.sender_nonce[i]; }
    
    // origin_domain (4 bytes)
    let origin_bytes = (order_data.origin_domain as Field).to_be_bytes::<4>();
    for i in 0..4 { bytes[224 + i] = origin_bytes[i]; }
    
    // destination_domain (4 bytes)
    let dest_bytes = (order_data.destination_domain as Field).to_be_bytes::<4>();
    for i in 0..4 { bytes[228 + i] = dest_bytes[i]; }
    
    for i in 0..32 { bytes[232 + i] = order_data.destination_settler[i]; }
    
    // fill_deadline (4 bytes)
    let deadline_bytes = (order_data.fill_deadline as Field).to_be_bytes::<4>();
    for i in 0..4 { bytes[264 + i] = deadline_bytes[i]; }
    
    bytes[268] = order_data.order_type;
    for i in 0..32 { bytes[269 + i] = order_data.data[i]; }
    
    bytes
}

pub unconstrained fn create_test_order() -> OnchainCrossChainOrder {
    let order_data = create_test_order_data();
    OnchainCrossChainOrder {
        fill_deadline: 1000000,
        order_data_type: ORDER_DATA_TYPE,
        order_data: encode_order_data(order_data),
    }
}

pub unconstrained fn create_test_order_with_sender(sender: AztecAddress) -> OnchainCrossChainOrder {
    let order_data = create_test_order_data_with_sender(sender);
    OnchainCrossChainOrder {
        fill_deadline: 1000000,
        order_data_type: ORDER_DATA_TYPE,
        order_data: encode_order_data(order_data),
    }
}
