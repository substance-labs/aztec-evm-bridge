use dep::aztec::protocol_types::{address::{AztecAddress, EthAddress}, traits::FromField};

pub(crate) fn u8_32_to_u128(input: [u8; 32]) -> u128 {
    let mut result = 0u128;
    for i in 0..16 {
        result += (input[31 - i] as u128) << ((i * 8) as u128);
    }
    result
}

pub(crate) fn u8_4_to_u32(bytes: [u8; 4]) -> u32 {
    let field = Field::from_be_bytes(bytes);
    field.assert_max_bit_size::<32>();
    field as u32
}

pub(crate) fn u8_32_to_aztec_address(bytes: [u8; 32]) -> AztecAddress {
    let field = Field::from_be_bytes(bytes);
    AztecAddress::from_field(field)
}

pub(crate) fn u8_32_to_eth_address(bytes: [u8; 32]) -> EthAddress {
    let field = Field::from_be_bytes(bytes);
    EthAddress::from_field(field)
}

pub(crate) fn u32_to_u8_4(x: u32) -> [u8; 4] {
    [((x >> 24) & 0xFF) as u8, ((x >> 16) & 0xFF) as u8, ((x >> 8) & 0xFF) as u8, (x & 0xFF) as u8]
}
