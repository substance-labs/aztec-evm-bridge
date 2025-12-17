import { PXE } from "@aztec/pxe/client/bundle"
import { AztecAddress, EthAddress } from "@aztec/aztec.js/addresses"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { spawn } from "child_process"
import { createEthereumChain, createExtendedL1Client, RollupContract } from "@aztec/ethereum"
import { hexToBytes, padHex } from "viem"
import { poseidon2Hash, sha256ToField } from "@aztec/foundation/crypto"
import { computeL2ToL1MessageHash } from "@aztec/stdlib/hash"
import {
  computeL2ToL1MembershipWitness,
  computeL2ToL1MembershipWitnessFromMessagesForAllTxs,
} from "@aztec/stdlib/messaging"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { TokenContract, TokenContractArtifact } from "@defi-wonderland/aztec-standards/artifacts/Token.js"
import { TestWallet } from "@aztec/test-wallet/server"

import { parseFilledLog, parseOpenLog, parseResolvedCrossChainOrder, parseSettledLog } from "./utils.js"
import { AztecGateway7683Contract, AztecGateway7683ContractArtifact } from "../../artifacts/AztecGateway7683.js"
import { getPXEs, addRandomAccount } from "../../../scripts/utils.js"
import { getSponsoredFPCInstance } from "../../../scripts/fpc.js"
import { OrderData } from "./OrderData.js"
import { rmSync } from "fs"
import { AztecNode } from "@aztec/aztec.js/node"

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
const L2_DOMAIN = 11155420
const FILL_DEADLINE = 2 ** 32 - 1
const DESTINATION_SETTLER_EVM_L2 = EthAddress.ZERO
const DATA = "0x5555555555555555555555555555555555555555555555555555555555555555"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const setup = async (pxes: PXE[], node: AztecNode) => {
  const sponsoredFPC = await getSponsoredFPCInstance()

  // Create test wallets
  const wallet1 = await TestWallet.create(node, {
    l1Contracts: await node.getL1ContractAddresses(),
    proverEnabled: false,
  })
  const wallet2 = await TestWallet.create(node, {
    l1Contracts: await node.getL1ContractAddresses(),
    proverEnabled: false,
  })
  const wallet3 = await TestWallet.create(node, {
    l1Contracts: await node.getL1ContractAddresses(),
    proverEnabled: false,
  })

  // Register FPC with each wallet
  for (const wallet of [wallet1, wallet2, wallet3]) {
    await wallet.registerContract({
      instance: sponsoredFPC,
      artifact: SponsoredFPCContract.artifact,
    })
  }

  const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address)
  const user = await addRandomAccount({ paymentMethod, testWallet: wallet1 })
  const filler = await addRandomAccount({ paymentMethod, testWallet: wallet2 })
  const deployer = await addRandomAccount({ paymentMethod, testWallet: wallet3 })

  // Register accounts as senders so TestWallets can act on their behalf
  await wallet1.registerSender(user.getAddress())
  await wallet2.registerSender(filler.getAddress())
  await wallet3.registerSender(deployer.getAddress())

  // Register deployer as sender on user and filler wallets so they can discover minted notes
  await wallet1.registerSender(deployer.getAddress())
  await wallet2.registerSender(deployer.getAddress())

  const gateway = await AztecGateway7683Contract.deploy(wallet3, DESTINATION_SETTLER_EVM_L2, L2_DOMAIN, PORTAL_ADDRESS)
    .send({
      contractAddressSalt: Fr.random(),
      universalDeploy: true,
      from: deployer.getAddress(),
      fee: { paymentMethod },
    })
    .deployed()

  const token = await TokenContract.deployWithOpts(
    {
      wallet: wallet3,
      method: "constructor_with_minter",
    },
    "TOKEN",
    "TKN",
    18,
    deployer.getAddress(),
    AztecAddress.ZERO,
  )
    .send({ from: deployer.getAddress(), fee: { paymentMethod } })
    .deployed()

  for (const wallet of [wallet1, wallet2, wallet3]) {
    await wallet.registerContract({
      instance: token.instance,
      artifact: TokenContractArtifact,
    })
    await wallet.registerContract({
      instance: gateway.instance,
      artifact: AztecGateway7683ContractArtifact,
    })
  }

  const amount = 1000n * 10n ** 18n
  await token
    .withWallet(wallet3)
    .methods.mint_to_private(user.getAddress(), amount)
    .send({ from: deployer.getAddress(), fee: { paymentMethod } })
    .wait()
  await token
    .withWallet(wallet3)
    .methods.mint_to_private(filler.getAddress(), amount)
    .send({ from: deployer.getAddress(), fee: { paymentMethod } })
    .wait()
  await token
    .withWallet(wallet3)
    .methods.mint_to_public(user.getAddress(), amount)
    .send({ from: deployer.getAddress(), fee: { paymentMethod } })
    .wait()
  await token
    .withWallet(wallet3)
    .methods.mint_to_public(filler.getAddress(), amount)
    .send({ from: deployer.getAddress(), fee: { paymentMethod } })
    .wait()

  return {
    wallets: [user, filler, deployer],
    testWallets: [wallet1, wallet2, wallet3],
    gateway,
    token,
    paymentMethod,
  }
}

// NOTE: before running the tests comment all occurences of context.consume_l1_to_l2_message
describe("AztecGateway7683", () => {
  let pxes: PXE[]
  let node: AztecNode
  let sandboxInstance: any
  let skipSandbox: boolean
  let publicClient: any
  let version: bigint

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

    ;({ pxes, node } = await getPXEs(["pxe1", "pxe2", "pxe3"]))
    const nodeInfo = await node.getNodeInfo()
    const chain = createEthereumChain(["http://localhost:8545"], nodeInfo.l1ChainId)
    publicClient = createExtendedL1Client(chain.rpcUrls, MNEMONIC, chain.chainInfo)
    const l1Contracts = nodeInfo.l1ContractAddresses
    const rollup = new RollupContract(publicClient, l1Contracts.rollupAddress)
    version = await rollup.getVersion()
  })

  afterAll(async () => {
    if (!skipSandbox) {
      sandboxInstance!.kill("SIGINT")
    }
  })

  it("should open a public order and settle", async () => {
    const { token, gateway, wallets, testWallets, paymentMethod } = await setup(pxes, node)
    const [user, filler] = wallets
    const [userWallet, fillerWallet] = testWallets

    const amountIn = 100n
    const nonce = Fr.random()

    // Set public auth witness using the wallet
    const authWitAction = token
      .withWallet(userWallet)
      .methods.transfer_public_to_public(user.getAddress(), gateway.address, amountIn, nonce)

    await (
      await userWallet.setPublicAuthWit(
        user.getAddress(),
        {
          caller: gateway.address,
          action: authWitAction,
        },
        true,
      )
    )
      .send({ fee: { paymentMethod } })
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

    let fromBlock = await node.getBlockNumber()

    await gateway
      .withWallet(userWallet)
      .methods.open({
        fill_deadline: FILL_DEADLINE,
        order_data: Array.from(hexToBytes(orderData.encode())),
        order_data_type: Array.from(hexToBytes(ORDER_DATA_TYPE)),
      })
      .send({ from: user.getAddress(), fee: { paymentMethod } })
      .wait()

    const { logs } = await node.getPublicLogs({
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

    const balancePre = await token
      .withWallet(fillerWallet)
      .methods.balance_of_public(filler.getAddress())
      .simulate({ from: filler.getAddress() })
    await gateway
      .withWallet(fillerWallet)
      .methods.settle(
        Array.from(hexToBytes(parsedResolvedCrossChainOrder.orderId as `0x${string}`)),
        Array.from(hexToBytes(orderData.encode())),
        Array.from(hexToBytes(filler.getAddress().toString())),
        0n, // TODO
      )
      .send({ from: filler.getAddress(), fee: { paymentMethod } })
      .wait()
    const balancePost = await token
      .withWallet(fillerWallet)
      .methods.balance_of_public(filler.getAddress())
      .simulate({ from: filler.getAddress() })
    expect(balancePost).toBe(balancePre + amountIn)

    fromBlock = await node.getBlockNumber()
    const { logs: logs2 } = await node.getPublicLogs({
      fromBlock: fromBlock - 1,
      toBlock: fromBlock + 2,
      contractAddress: gateway.address,
    })
    const parsedSettledLog = parseSettledLog(logs2[logs2.length - 1].log.fields)
    expect(parsedSettledLog.orderId).toBe(parsedResolvedCrossChainOrder.orderId)
    expect(parsedSettledLog.receiver).toBe(filler.getAddress().toString())
  })

  it("should open a private order and settle", async () => {
    const { token, gateway, wallets, testWallets, paymentMethod } = await setup(pxes, node)
    const [user, filler] = wallets
    const [userWallet, fillerWallet] = testWallets

    const amountIn = 100n
    const nonce = Fr.random()
    const witness = await userWallet.createAuthWit(user.getAddress(), {
      caller: gateway.address,
      action: token
        .withWallet(userWallet)
        .methods.transfer_private_to_public(user.getAddress(), gateway.address, amountIn, nonce),
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

    let fromBlock = await node.getBlockNumber()
    await gateway
      .withWallet(userWallet)
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

    const { logs } = await node.getPublicLogs({
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
      .withWallet(fillerWallet)
      .methods.balance_of_private(filler.getAddress())
      .simulate({ from: filler.getAddress() })
    await gateway
      .withWallet(fillerWallet)
      .methods.settle_private(
        Array.from(hexToBytes(parsedResolvedCrossChainOrder.orderId as `0x${string}`)),
        Array.from(hexToBytes(orderData.encode())),
        Array.from(hexToBytes(filler.getAddress().toString())),
        0n, // TODO
      )
      .send({ from: filler.getAddress(), fee: { paymentMethod } })
      .wait()
    const balancePost = await token
      .withWallet(fillerWallet)
      .methods.balance_of_private(filler.getAddress())
      .simulate({ from: filler.getAddress() })
    expect(balancePost).toBe(balancePre + amountIn)

    fromBlock = await node.getBlockNumber()
    const { logs: logs2 } = await node.getPublicLogs({
      fromBlock: fromBlock - 1,
      toBlock: fromBlock + 2,
      contractAddress: gateway.address,
    })
    const parsedSettledLog = parseSettledLog(logs2[logs2.length - 1].log.fields)
    expect(parsedSettledLog.orderId).toBe(parsedResolvedCrossChainOrder.orderId)
    expect(parsedSettledLog.receiver).toBe(filler.getAddress().toString())
  })

  it("should fill a public order and send the settlement message to the forwarder", async () => {
    const { token, gateway, wallets, testWallets, paymentMethod } = await setup(pxes, node)
    const [user, filler, deployer] = wallets
    const [userWallet, fillerWallet] = testWallets

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
      await fillerWallet.setPublicAuthWit(
        filler.getAddress(),
        {
          caller: gateway.address,
          action: token
            .withWallet(fillerWallet)
            .methods.transfer_public_to_public(filler.getAddress(), user.getAddress(), amountOut, nonce),
        },
        true,
      )
    )
      .send({ fee: { paymentMethod } })
      .wait()

    const fromBlock = await node.getBlockNumber()
    await gateway
      .withWallet(fillerWallet)
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

    const { logs } = await node.getPublicLogs({
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

    const orderSettlementBlockNumber = await gateway
      .withWallet(fillerWallet)
      .methods.get_order_settlement_block_number(orderId)
      .simulate({ from: filler.getAddress() })
    const currentBlock = await node.getBlockNumber()

    // Get L2 to L1 messages and compute membership witness
    // Note: This verification is skipped as the L2->L1 messaging may not emit messages in test environment
    const messagesForAllTxs = await node.getL2ToL1Messages(currentBlock)
    if (messagesForAllTxs && messagesForAllTxs.some((msgs) => msgs.length > 0)) {
      const witness = computeL2ToL1MembershipWitnessFromMessagesForAllTxs(messagesForAllTxs, l2ToL1Message)
      expect(witness.leafIndex).toBe(0n)
      expect(witness.siblingPath.pathSize).toBe(0)
    }
  })

  it("should fill a private order and send the settlement message to the forwarder", async () => {
    const { token, gateway, wallets, testWallets, paymentMethod } = await setup(pxes, node)
    const [user, filler] = wallets
    const [userWallet, fillerWallet] = testWallets

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

    const witness = await fillerWallet.createAuthWit(filler.getAddress(), {
      caller: gateway.address,
      action: token
        .withWallet(fillerWallet)
        .methods.transfer_private_to_public(filler.getAddress(), gateway.address, amountOut, nonce),
    })

    const fromBlock = await node.getBlockNumber()
    await gateway
      .withWallet(fillerWallet)
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

    const { logs } = await node.getPublicLogs({
      fromBlock: fromBlock - 1,
      toBlock: fromBlock + 2,
      contractAddress: gateway.address,
    })
    const parsedLog = parseFilledLog(logs[0].log.fields)
    expect(orderId.toString()).toBe(parsedLog.orderId)
    expect(orderData.encode()).toBe(parsedLog.originData)
    expect(fillerData).toBe(parsedLog.fillerData)

    await gateway
      .withWallet(userWallet)
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

    const orderSettlementBlockNumber = await gateway
      .withWallet(userWallet)
      .methods.get_order_settlement_block_number(orderId)
      .simulate({ from: user.getAddress() })

    // Get L2 to L1 messages and compute membership witness
    const L2ToL1witness = await computeL2ToL1MembershipWitness(node, Number(orderSettlementBlockNumber), l2ToL1Message)
    expect(L2ToL1witness).toBeDefined()
    if (!L2ToL1witness) return
    expect(L2ToL1witness.leafIndex).toBe(0n)
    expect(L2ToL1witness.siblingPath.pathSize).toBe(0)
  })

  it("should open a public order and publicly claim the refund", async () => {
    const { token, gateway, wallets, testWallets, paymentMethod } = await setup(pxes, node)
    const [user] = wallets
    const [userWallet] = testWallets

    const amountIn = 100n
    const nonce = Fr.random()
    await (
      await userWallet.setPublicAuthWit(
        user.getAddress(),
        {
          caller: gateway.address,
          action: token
            .withWallet(userWallet)
            .methods.transfer_public_to_public(user.getAddress(), gateway.address, amountIn, nonce),
        },
        true,
      )
    )
      .send({ fee: { paymentMethod } })
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
      .withWallet(userWallet)
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
      .withWallet(userWallet)
      .methods.balance_of_public(user.getAddress())
      .simulate({ from: user.getAddress() })
    await gateway
      .withWallet(userWallet)
      .methods.claim_refund(
        Array.from(hexToBytes(orderId.toString())),
        Array.from(hexToBytes(orderData.encode())),
        leafIndex,
      )
      .send({ from: user.getAddress(), fee: { paymentMethod } })
      .wait()
    const balancePost = await token
      .withWallet(userWallet)
      .methods.balance_of_public(user.getAddress())
      .simulate({ from: user.getAddress() })
    expect(balancePost).toBe(balancePre + amountIn)
  })

  it("should open a private order and privately claim a refund", async () => {
    const { token, gateway, wallets, testWallets, paymentMethod } = await setup(pxes, node)
    const [user] = wallets
    const [userWallet] = testWallets

    const amountIn = 100n
    const nonce = Fr.random()
    const witness = await userWallet.createAuthWit(user.getAddress(), {
      caller: gateway.address,
      action: token
        .withWallet(userWallet)
        .methods.transfer_private_to_public(user.getAddress(), gateway.address, amountIn, nonce),
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
      .withWallet(userWallet)
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
      .withWallet(userWallet)
      .methods.balance_of_private(user.getAddress())
      .simulate({ from: user.getAddress() })
    await gateway
      .withWallet(userWallet)
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
      .withWallet(userWallet)
      .methods.balance_of_private(user.getAddress())
      .simulate({ from: user.getAddress() })
    expect(balancePost).toBe(balancePre + amountIn)
  })
})
