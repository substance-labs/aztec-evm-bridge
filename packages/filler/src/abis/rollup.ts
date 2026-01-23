export default [
  {
    inputs: [],
    name: "getProvenBlockNumber",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getTips",
    outputs: [
      { internalType: "uint256", name: "pending", type: "uint256" },
      { internalType: "uint256", name: "proven", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
]
