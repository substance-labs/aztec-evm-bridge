use dep::aztec::{prelude::{AztecAddress, EthAddress}, protocol_types::traits::FromField};

pub(crate) fn u8_32_to_u128(input: [u8; 32]) -> u128 {
    let mut result = 0;
    for i in 0..16 {
        result = result + (input[31 - i] as u128) * (1 << (i * 8));
    }
    result
}

pub(crate) fn u8_32_to_aztec_address(bytes: [u8; 32]) -> AztecAddress {
    AztecAddress::from_field(Field::from_be_bytes(bytes))
}

pub(crate) fn u8_32_to_eth_address(bytes: [u8; 32]) -> EthAddress {
    EthAddress::from_field(Field::from_be_bytes(bytes))
}
