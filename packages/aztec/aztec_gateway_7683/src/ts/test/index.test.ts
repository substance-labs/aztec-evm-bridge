import { Fr, PXE, EthAddress, SponsoredFeePaymentMethod, Contract } from "@aztec/aztec.js"
import { spawn } from "child_process"
import { createEthereumChain, createExtendedL1Client, RollupContract } from "@aztec/ethereum"
import { hexToBytes, padHex } from "viem"
import { poseidon2Hash, sha256ToField } from "@aztec/foundation/crypto"
import { computeL2ToL1MessageHash } from "@aztec/stdlib/hash"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { TokenContractArtifact } from "@aztec/noir-contracts.js/Token"

import { parseFilledLog, parseOpenLog, parseResolvedCrossChainOrder, parseSettledLog } from "./utils.js"
import { AztecGateway7683Contract, AztecGateway7683ContractArtifact } from "../../artifacts/AztecGateway7683.js"
import { getRandomWallet, getPXEs } from "../../../scripts/utils.js"
import { getSponsoredFPCInstance } from "../../../scripts/fpc.js"
import { OrderData } from "./OrderData.js"
import { rmSync } from "fs"

const MNEMONIC = "test test test test test test test test test test test junk"
const PORTAL_ADDRESS = EthAddress.ZERO
const SETTLE_ORDER_TYPE = "0x191ea776bd6e0cd56a6d44ba4aea2fec468b4a0b4c1d880d4025929eeb615d0d"
const ORDER_DATA_TYPE = "0xf00c3bf60c73eb97097f1c9835537da014e0b755fe94b25d7ac8401df66716a0"
const SECRET = Fr.random()
const SECRET_HASH = await poseidon2Hash([SECRET])
const AZTEC_7683_DOMAIN = 999999

const PUBLIC_ORDER = 0
const PRIVATE_ORDER = 1
const PRIVATE_SENDER = "0x0000000000000000000000000000000000000000000000000000000000000000"
const RECIPIENT = "0x1111111111111111111111111111111111111111111111111111111111111111"
const AZTEC_TOKEN = "0x2222222222222222222222222222222222222222222222222222222222222222"
const L2_EVM_TOKEN = "0x3333333333333333333333333333333333333333333333333333333333333333"
const AMOUNT_OUT_ZERO = 0n
const AMOUNT_IN_ZERO = 0n
// const MAINNET_CHAIN_ID = 1
const L2_DOMAIN = 11155420
const FILL_DEADLINE = 2 ** 32 - 1
const DESTINATION_SETTLER_EVM_L2 = EthAddress.ZERO
const DATA = "0x5555555555555555555555555555555555555555555555555555555555555555"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const setup = async (pxes: PXE[]) => {
  const [pxe1, pxe2, pxe3] = pxes
  const sponsoredFPC = await getSponsoredFPCInstance()

  for (const pxe of [pxe1, pxe2, pxe3]) {
    await pxe.registerContract({
      instance: sponsoredFPC,
      artifact: SponsoredFPCContract.artifact,
    })
  }

  const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address)
  const user = await getRandomWallet({ paymentMethod, pxe: pxe1 })
  const filler = await getRandomWallet({ paymentMethod, pxe: pxe2 })
  const deployer = await getRandomWallet({ paymentMethod, pxe: pxe3 })

  await user.registerSender(deployer.getAddress())
  await filler.registerSender(deployer.getAddress())

  const gateway = await AztecGateway7683Contract.deploy(deployer, DESTINATION_SETTLER_EVM_L2, L2_DOMAIN, PORTAL_ADDRESS)
    .send({
      contractAddressSalt: Fr.random(),
      universalDeploy: false,
      skipClassPublication: false,
      skipInstancePublication: false,
      skipInitialization: false,
      from: deployer.getAddress(),
      fee: { paymentMethod },
    })
    .deployed()

  await user.registerSender(gateway.address)
  await filler.registerSender(gateway.address)
  await deployer.registerSender(gateway.address)

  const token = await Contract.deploy(deployer, TokenContractArtifact, [deployer.getAddress(), "TOKEN", "TKN", 18])
    .send({ from: deployer.getAddress(), fee: { paymentMethod } })
    .deployed()

  for (const pxe of pxes) {
    await pxe.registerContract({
      instance: token.instance,
      artifact: TokenContractArtifact,
    })
    await pxe.registerContract({
      instance: gateway.instance,
      artifact: AztecGateway7683ContractArtifact,
    })
  }

  const amount = 1000n * 10n ** 18n
  await token
    .withWallet(deployer)
    .methods.mint_to_private(user.getAddress(), amount)
    .send({ from: deployer.getAddress(), fee: { paymentMethod } })
    .wait()
  await token
    .withWallet(deployer)
    .methods.mint_to_private(filler.getAddress(), amount)
    .send({ from: deployer.getAddress(), fee: { paymentMethod } })
    .wait()
  await token
    .withWallet(deployer)
    .methods.mint_to_public(user.getAddress(), amount)
    .send({ from: deployer.getAddress(), fee: { paymentMethod } })
    .wait()
  await token
    .withWallet(deployer)
    .methods.mint_to_public(filler.getAddress(), amount)
    .send({ from: deployer.getAddress(), fee: { paymentMethod } })
    .wait()

  return {
    wallets: [user, filler, deployer],
    gateway,
    token,
    paymentMethod,
  }
}

// NOTE: before running the tests comment all occurences of context.consume_l1_to_l2_message
describe("AztecGateway7683", () => {
  let pxes: PXE[]
  let sandboxInstance
  let skipSandbox: boolean
  let publicClient: any
  let version: bigint
  let wallets: any[]
  let gateway: any
  let token: any
  let paymentMethod: any

  beforeEach(async () => {
    skipSandbox = process.env.SKIP_SANDBOX === "true"
    if (!skipSandbox) {
      // Clean up old PXE stores
      try {
        rmSync("store/pxe1", { recursive: true, force: true })
      } catch {}
      try {
        rmSync("store/pxe2", { recursive: true, force: true })
      } catch {}
      try {
        rmSync("store/pxe3", { recursive: true, force: true })
      } catch {}
      sandboxInstance = spawn("aztec", ["start", "--sandbox"], {
        detached: true,
        stdio: "ignore",
      })
      await sleep(15000)
    }
    pxes = await getPXEs(["pxe1", "pxe2", "pxe3"])
    const nodeInfo = await pxes[0].getNodeInfo()
    const chain = createEthereumChain(["http://localhost:8545"], nodeInfo.l1ChainId)
    publicClient = createExtendedL1Client(chain.rpcUrls, MNEMONIC, chain.chainInfo)
    const l1Contracts = (await pxes[0].getNodeInfo()).l1ContractAddresses
    const rollup = new RollupContract(publicClient, l1Contracts.rollupAddress)
    version = await rollup.getVersion()
  })

  afterAll(async () => {
    if (!skipSandbox) {
      sandboxInstance!.kill("SIGINT")
    }
  })

  it("should open a public order and settle", async () => {
    const [pxe1] = pxes
    const { token, gateway, wallets, paymentMethod } = await setup(pxes)
    const [user, filler] = wallets

    const amountIn = 100n
    const nonce = Fr.random()
    await (
      await user.setPublicAuthWit(
        {
          caller: gateway.address,
          action: token
            .withWallet(filler)
            .methods.transfer_in_public(user.getAddress(), gateway.address, amountIn, nonce),
        },
        true,
      )
    )
      .send({ from: user.getAddress(), fee: { paymentMethod } })
      .wait({
        timeout: 120000,
      })

    const orderData = new OrderData({
      sender: user.getAddress().toString(),
      recipient: RECIPIENT,
      inputToken: token.address.toString(),
      outputToken: L2_EVM_TOKEN,
      amountIn,
      amountOut: AMOUNT_OUT_ZERO,
      senderNonce: nonce.toBigInt(),
      originDomain: AZTEC_7683_DOMAIN,
      destinationDomain: L2_DOMAIN,
      destinationSettler: padHex(DESTINATION_SETTLER_EVM_L2.toString()),
      fillDeadline: FILL_DEADLINE,
      orderType: PUBLIC_ORDER,
      data: DATA,
    })
    const orderId = await orderData.id()

    let fromBlock = await pxe1.getBlockNumber()
    await gateway
      .withWallet(user)
      .methods.open({
        fill_deadline: FILL_DEADLINE,
        order_data: Array.from(hexToBytes(orderData.encode())),
        order_data_type: Array.from(hexToBytes(ORDER_DATA_TYPE)),
      })
      .send({ from: user.getAddress(), fee: { paymentMethod } })
      .wait()

    const { logs } = await pxe1.getPublicLogs({
      fromBlock: fromBlock - 1,
      toBlock: fromBlock + 2,
      contractAddress: gateway.address,
    })

    const { resolvedOrder } = parseOpenLog(logs[0].log.fields, logs[1].log.fields)
    const parsedResolvedCrossChainOrder = parseResolvedCrossChainOrder(resolvedOrder)
    expect(parsedResolvedCrossChainOrder.orderId).toBe(orderId.toString())
    expect(parsedResolvedCrossChainOrder.fillDeadline).toBe(FILL_DEADLINE)
    expect(parsedResolvedCrossChainOrder.originChainId).toBe(AZTEC_7683_DOMAIN)
    expect(parsedResolvedCrossChainOrder.fillInstructions[0].originData).toBe(orderData.encode())
    expect(parsedResolvedCrossChainOrder.fillInstructions[0].destinationChainId).toBe(L2_DOMAIN)
    expect(parsedResolvedCrossChainOrder.fillInstructions[0].destinationSettler).toBe(
      padHex(DESTINATION_SETTLER_EVM_L2.toString()),
    )
    expect(parsedResolvedCrossChainOrder.maxSpent[0].chainId).toBe(L2_DOMAIN)
    expect(parsedResolvedCrossChainOrder.maxSpent[0].amount).toBe(AMOUNT_OUT_ZERO)
    expect(parsedResolvedCrossChainOrder.maxSpent[0].recipient).toBe(RECIPIENT)
    expect(parsedResolvedCrossChainOrder.maxSpent[0].token).toBe(L2_EVM_TOKEN)
    expect(parsedResolvedCrossChainOrder.minReceived[0].chainId).toBe(AZTEC_7683_DOMAIN)
    expect(parsedResolvedCrossChainOrder.minReceived[0].amount).toBe(amountIn)
    expect(parsedResolvedCrossChainOrder.minReceived[0].recipient).toBe(padHex("0x00"))
    expect(parsedResolvedCrossChainOrder.minReceived[0].token).toBe(token.address.toString())
    expect(parsedResolvedCrossChainOrder.user).toBe(user.getAddress().toString())

    const balancePre = await token.methods
      .balance_of_public(filler.getAddress())
      .simulate({ from: filler.getAddress() })
    await gateway
      .withWallet(filler)
      .methods.settle(
        Array.from(hexToBytes(parsedResolvedCrossChainOrder.orderId as `0x${string}`)),
        Array.from(hexToBytes(orderData.encode())),
        Array.from(hexToBytes(filler.getAddress().toString())),
        0n, // TODO
      )
      .send({ from: filler.getAddress(), fee: { paymentMethod } })
      .wait()
    const balancePost = await token.methods
      .balance_of_public(filler.getAddress())
      .simulate({ from: filler.getAddress() })
    expect(balancePost).toBe(balancePre + amountIn)

    fromBlock = await pxe1.getBlockNumber()
    const { logs: logs2 } = await pxe1.getPublicLogs({
      fromBlock: fromBlock - 1,
      toBlock: fromBlock + 2,
      contractAddress: gateway.address,
    })
    const parsedSettledLog = parseSettledLog(logs2[logs2.length - 1].log.fields)
    expect(parsedSettledLog.orderId).toBe(parsedResolvedCrossChainOrder.orderId)
    expect(parsedSettledLog.receiver).toBe(filler.getAddress().toString())
  })

  it("should open a private order and settle", async () => {
    const [pxe1] = pxes
    const { token, gateway, wallets, paymentMethod } = await setup(pxes)
    const [user, filler, deployer] = wallets

    const amountIn = 100n
    const nonce = Fr.random()
    const witness = await user.createAuthWit({
      caller: gateway.address,
      action: token.withWallet(user).methods.transfer_to_public(user.getAddress(), gateway.address, amountIn, nonce),
    })

    const orderData = new OrderData({
      sender: PRIVATE_SENDER,
      recipient: RECIPIENT,
      inputToken: token.address.toString(),
      outputToken: L2_EVM_TOKEN,
      amountIn,
      amountOut: AMOUNT_OUT_ZERO,
      senderNonce: nonce.toBigInt(),
      originDomain: AZTEC_7683_DOMAIN,
      destinationDomain: L2_DOMAIN,
      destinationSettler: padHex(DESTINATION_SETTLER_EVM_L2.toString()),
      fillDeadline: FILL_DEADLINE,
      orderType: PRIVATE_ORDER,
      data: DATA,
    })
    const orderId = await orderData.id()

    let fromBlock = await pxe1.getBlockNumber()
    await gateway
      .withWallet(user)
      .methods.open_private({
        fill_deadline: FILL_DEADLINE,
        order_data: Array.from(hexToBytes(orderData.encode())),
        order_data_type: Array.from(hexToBytes(ORDER_DATA_TYPE)),
      })
      .with({
        authWitnesses: [witness],
      })
      .send({ from: user.getAddress(), fee: { paymentMethod } })
      .wait()

    const { logs } = await pxe1.getPublicLogs({
      fromBlock: fromBlock - 1,
      toBlock: fromBlock + 2,
      contractAddress: gateway.address,
    })

    const { resolvedOrder } = parseOpenLog(logs[0].log.fields, logs[1].log.fields)
    const parsedResolvedCrossChainOrder = parseResolvedCrossChainOrder(resolvedOrder)
    expect(parsedResolvedCrossChainOrder.orderId).toBe(orderId.toString())
    expect(parsedResolvedCrossChainOrder.fillDeadline).toBe(FILL_DEADLINE)
    expect(parsedResolvedCrossChainOrder.originChainId).toBe(AZTEC_7683_DOMAIN)
    expect(parsedResolvedCrossChainOrder.fillInstructions[0].originData).toBe(orderData.encode())
    expect(parsedResolvedCrossChainOrder.fillInstructions[0].destinationChainId).toBe(L2_DOMAIN)
    expect(parsedResolvedCrossChainOrder.fillInstructions[0].destinationSettler).toBe(
      padHex(DESTINATION_SETTLER_EVM_L2.toString()),
    )
    expect(parsedResolvedCrossChainOrder.maxSpent[0].chainId).toBe(L2_DOMAIN)
    expect(parsedResolvedCrossChainOrder.maxSpent[0].amount).toBe(AMOUNT_OUT_ZERO)
    expect(parsedResolvedCrossChainOrder.maxSpent[0].recipient).toBe(RECIPIENT)
    expect(parsedResolvedCrossChainOrder.maxSpent[0].token).toBe(L2_EVM_TOKEN)
    expect(parsedResolvedCrossChainOrder.minReceived[0].chainId).toBe(AZTEC_7683_DOMAIN)
    expect(parsedResolvedCrossChainOrder.minReceived[0].amount).toBe(amountIn)
    expect(parsedResolvedCrossChainOrder.minReceived[0].recipient).toBe(padHex("0x00"))
    expect(parsedResolvedCrossChainOrder.minReceived[0].token).toBe(token.address.toString())
    expect(parsedResolvedCrossChainOrder.user).toBe(PRIVATE_SENDER)

    const balancePre = await token
      .withWallet(filler)
      .methods.balance_of_private(filler.getAddress())
      .simulate({ from: filler.getAddress() })
    await gateway
      .withWallet(filler)
      .methods.settle_private(
        Array.from(hexToBytes(parsedResolvedCrossChainOrder.orderId as `0x${string}`)),
        Array.from(hexToBytes(orderData.encode())),
        Array.from(hexToBytes(filler.getAddress().toString())),
        0n, // TODO
      )
      .send({ from: filler.getAddress(), fee: { paymentMethod } })
      .wait()
    const balancePost = await token
      .withWallet(filler)
      .methods.balance_of_private(filler.getAddress())
      .simulate({ from: filler.getAddress() })
    expect(balancePost).toBe(balancePre + amountIn)

    fromBlock = await pxe1.getBlockNumber()
    const { logs: logs2 } = await pxe1.getPublicLogs({
      fromBlock: fromBlock - 1,
      toBlock: fromBlock + 2,
      contractAddress: gateway.address,
    })
    const parsedSettledLog = parseSettledLog(logs2[logs2.length - 1].log.fields)
    expect(parsedSettledLog.orderId).toBe(parsedResolvedCrossChainOrder.orderId)
    expect(parsedSettledLog.receiver).toBe(filler.getAddress().toString())
  })

  it("should fill a public order and send the settlement message to the forwarder", async () => {
    const [pxe1] = pxes
    const { token, gateway, wallets, paymentMethod } = await setup(pxes)
    const [user, filler, deployer] = wallets

    const amountOut = 100n
    const nonce = Fr.random()
    const orderData = new OrderData({
      sender: deployer.getAddress().toString(),
      recipient: user.getAddress().toString(),
      inputToken: AZTEC_TOKEN,
      outputToken: token.address.toString(),
      amountIn: AMOUNT_IN_ZERO,
      amountOut,
      senderNonce: nonce.toBigInt(),
      originDomain: L2_DOMAIN,
      destinationDomain: AZTEC_7683_DOMAIN,
      destinationSettler: padHex(gateway.address.toString()),
      fillDeadline: FILL_DEADLINE,
      orderType: PUBLIC_ORDER,
      data: DATA,
    })
    const orderId = await orderData.id()

    const fillerData = filler.getAddress().toString()
    await (
      await filler.setPublicAuthWit(
        {
          caller: gateway.address,
          action: token
            .withWallet(filler)
            .methods.transfer_in_public(filler.getAddress(), user.getAddress(), amountOut, nonce),
        },
        true,
      )
    )
      .send({ from: filler.getAddress(), fee: { paymentMethod } })
      .wait()

    const fromBlock = await pxe1.getBlockNumber()
    await gateway
      .withWallet(filler)
      .methods.fill(
        Array.from(hexToBytes(orderId.toString())),
        Array.from(hexToBytes(orderData.encode())),
        Array.from(hexToBytes(fillerData)),
      )
      .send({
        from: filler.getAddress(),
        fee: { paymentMethod },
      })
      .wait()

    const { logs } = await pxe1.getPublicLogs({
      fromBlock: fromBlock - 1,
      toBlock: fromBlock + 2,
      contractAddress: gateway.address,
    })
    const parsedLog = parseFilledLog(logs[0].log.fields)
    expect(orderId.toString()).toBe(parsedLog.orderId)
    expect(orderData.encode()).toBe(parsedLog.originData)
    expect(fillerData).toBe(parsedLog.fillerData)

    const content = sha256ToField([
      Buffer.from(SETTLE_ORDER_TYPE.slice(2), "hex"),
      Buffer.from(orderId.toString().slice(2), "hex"),
      Buffer.from(filler.getAddress().toString().slice(2), "hex"),
    ])

    const l2ToL1Message = computeL2ToL1MessageHash({
      l2Sender: gateway.address,
      l1Recipient: PORTAL_ADDRESS,
      content,
      rollupVersion: new Fr(version),
      chainId: new Fr(publicClient.chain.id),
    })

    const orderSettlementBlockNumber = await gateway.methods
      .get_order_settlement_block_number(orderId)
      .simulate({ from: filler.getAddress() })
    console.log("orderSettlementBlockNumber:", orderSettlementBlockNumber)
    const currentBlock = await pxe1.getBlockNumber()
    console.log("currentBlock:", currentBlock)
    const [l2ToL1MessageIndex, siblingPath] = await pxe1.getL2ToL1MembershipWitness(Number(currentBlock), l2ToL1Message)

    expect(l2ToL1MessageIndex).toBe(0n)
    expect(siblingPath.pathSize).toBe(0)
  })

  it("should fill a private order and send the settlement message to the forwarder", async () => {
    const [pxe1] = pxes
    const { token, gateway, wallets, paymentMethod } = await setup(pxes)
    const [user, filler] = wallets

    const amountOut = 100n
    const nonce = Fr.random()
    const orderData = new OrderData({
      sender: PRIVATE_SENDER,
      recipient: SECRET_HASH.toString(),
      inputToken: AZTEC_TOKEN,
      outputToken: token.address.toString(),
      amountIn: AMOUNT_IN_ZERO,
      amountOut,
      senderNonce: nonce.toBigInt(),
      originDomain: L2_DOMAIN,
      destinationDomain: AZTEC_7683_DOMAIN,
      destinationSettler: padHex(gateway.address.toString()),
      fillDeadline: FILL_DEADLINE,
      orderType: PRIVATE_ORDER,
      data: DATA,
    })
    const orderId = await orderData.id()
    const fillerData = filler.getAddress().toString()

    const witness = await filler.createAuthWit({
      caller: gateway.address,
      action: token
        .withWallet(filler)
        .methods.transfer_to_public(filler.getAddress(), gateway.address, amountOut, nonce),
    })

    const fromBlock = await pxe1.getBlockNumber()
    await gateway
      .withWallet(filler)
      .methods.fill_private(
        Array.from(hexToBytes(orderId.toString())),
        Array.from(hexToBytes(orderData.encode())),
        Array.from(hexToBytes(fillerData)),
      )
      .with({
        authWitnesses: [witness],
      })
      .send({
        from: filler.getAddress(),
        fee: { paymentMethod },
      })
      .wait()

    const { logs } = await pxe1.getPublicLogs({
      fromBlock: fromBlock - 1,
      toBlock: fromBlock + 2,
      contractAddress: gateway.address,
    })
    const parsedLog = parseFilledLog(logs[0].log.fields)
    expect(orderId.toString()).toBe(parsedLog.orderId)
    expect(orderData.encode()).toBe(parsedLog.originData)
    expect(fillerData).toBe(parsedLog.fillerData)

    await gateway
      .withWallet(user)
      .methods.claim_private(
        SECRET,
        Array.from(hexToBytes(orderId.toString())),
        Array.from(hexToBytes(orderData.encode())),
        Array.from(hexToBytes(fillerData)),
      )
      .send({
        from: user.getAddress(),
        fee: { paymentMethod },
      })
      .wait()

    const content = sha256ToField([
      Buffer.from(SETTLE_ORDER_TYPE.slice(2), "hex"),
      orderId,
      Buffer.from(fillerData.slice(2), "hex"),
    ])

    const l2ToL1Message = computeL2ToL1MessageHash({
      l2Sender: gateway.address,
      l1Recipient: PORTAL_ADDRESS,
      content,
      rollupVersion: new Fr(version),
      chainId: new Fr(publicClient.chain.id),
    })

    const orderSettlementBlockNumber = await gateway.methods
      .get_order_settlement_block_number(orderId)
      .simulate({ from: user.getAddress() })
    const [l2ToL1MessageIndex, siblingPath] = await pxe1.getL2ToL1MembershipWitness(
      parseInt(orderSettlementBlockNumber),
      l2ToL1Message,
    )

    expect(l2ToL1MessageIndex).toBe(0n)
    expect(siblingPath.pathSize).toBe(0)
  })

  it("should open a public order and publicly claim the refund", async () => {
    const { token, gateway, wallets, paymentMethod } = await setup(pxes)
    const [user, filler] = wallets

    const amountIn = 100n
    const nonce = Fr.random()
    await (
      await user.setPublicAuthWit(
        {
          caller: gateway.address,
          action: token
            .withWallet(filler)
            .methods.transfer_in_public(user.getAddress(), gateway.address, amountIn, nonce),
        },
        true,
      )
    )
      .send({ from: user.getAddress(), fee: { paymentMethod } })
      .wait()

    const orderData = new OrderData({
      sender: user.getAddress().toString(),
      recipient: RECIPIENT,
      inputToken: token.address.toString(),
      outputToken: L2_EVM_TOKEN,
      amountIn,
      amountOut: AMOUNT_OUT_ZERO,
      senderNonce: nonce.toBigInt(),
      originDomain: AZTEC_7683_DOMAIN,
      destinationDomain: L2_DOMAIN,
      destinationSettler: padHex(DESTINATION_SETTLER_EVM_L2.toString()),
      fillDeadline: FILL_DEADLINE,
      orderType: PUBLIC_ORDER,
      data: DATA,
    })
    const orderId = await orderData.id()

    await gateway
      .withWallet(user)
      .methods.open({
        fill_deadline: FILL_DEADLINE,
        order_data: Array.from(hexToBytes(orderData.encode())),
        order_data_type: Array.from(hexToBytes(ORDER_DATA_TYPE)),
      })
      .send({ from: user.getAddress(), fee: { paymentMethod } })
      .wait()

    // NOTE: suppose that the order refund has been instructed on the source chain
    const leafIndex = 0 // TODO: change it
    const balancePre = await token
      .withWallet(user)
      .methods.balance_of_public(user.getAddress())
      .simulate({ from: user.getAddress() })
    await gateway
      .withWallet(user)
      .methods.claim_refund(
        Array.from(hexToBytes(orderId.toString())),
        Array.from(hexToBytes(orderData.encode())),
        leafIndex,
      )
      .send({ from: user.getAddress(), fee: { paymentMethod } })
      .wait()
    const balancePost = await token
      .withWallet(user)
      .methods.balance_of_public(user.getAddress())
      .simulate({ from: user.getAddress() })
    expect(balancePost).toBe(balancePre + amountIn)
  })

  it("should open a private order and privately claim a refund", async () => {
    const { token, gateway, wallets, paymentMethod } = await setup(pxes)
    const [user] = wallets

    const amountIn = 100n
    const nonce = Fr.random()
    const witness = await user.createAuthWit({
      caller: gateway.address,
      action: token.withWallet(user).methods.transfer_to_public(user.getAddress(), gateway.address, amountIn, nonce),
    })

    const orderData = new OrderData({
      sender: PRIVATE_SENDER,
      recipient: SECRET_HASH.toString(),
      inputToken: token.address.toString(),
      outputToken: L2_EVM_TOKEN,
      amountIn,
      amountOut: AMOUNT_OUT_ZERO,
      senderNonce: nonce.toBigInt(),
      originDomain: AZTEC_7683_DOMAIN,
      destinationDomain: L2_DOMAIN,
      destinationSettler: padHex(DESTINATION_SETTLER_EVM_L2.toString()),
      fillDeadline: FILL_DEADLINE,
      orderType: PRIVATE_ORDER,
      data: DATA,
    })
    const orderId = await orderData.id()

    await gateway
      .withWallet(user)
      .methods.open_private({
        fill_deadline: FILL_DEADLINE,
        order_data: Array.from(hexToBytes(orderData.encode())),
        order_data_type: Array.from(hexToBytes(ORDER_DATA_TYPE)),
      })
      .with({
        authWitnesses: [witness],
      })
      .send({ from: user.getAddress(), fee: { paymentMethod } })
      .wait()

    // NOTE: suppose that the order refund has been instructed on the source chain
    const leafIndex = 0 // TODO: change it
    const balancePre = await token
      .withWallet(user)
      .methods.balance_of_private(user.getAddress())
      .simulate({ from: user.getAddress() })
    await gateway
      .withWallet(user)
      .methods.claim_refund_private(
        SECRET,
        Array.from(hexToBytes(orderId.toString())),
        Array.from(hexToBytes(orderData.encode())),
        leafIndex,
      )
      .with({
        authWitnesses: [witness],
      })
      .send({ from: user.getAddress(), fee: { paymentMethod } })
      .wait()
    const balancePost = await token
      .withWallet(user)
      .methods.balance_of_private(user.getAddress())
      .simulate({ from: user.getAddress() })
    expect(balancePost).toBe(balancePre + amountIn)
  })
})
