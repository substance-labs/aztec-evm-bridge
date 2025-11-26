const zeroHash = "0x" + "00".repeat(32)

export const poseidon2Hash = async () => zeroHash
export const sha256ToField = async () => zeroHash
export const sha256Fr = async () => zeroHash
export const pedersenCommit = async () => zeroHash
export const pedersenHash = async () => zeroHash
export const frPackedDeserialiseBuffer = () => zeroHash
export const blake2s = async () => zeroHash

export default {
  poseidon2Hash,
  sha256ToField,
  sha256Fr,
  pedersenCommit,
  pedersenHash,
  frPackedDeserialiseBuffer,
  blake2s,
}
