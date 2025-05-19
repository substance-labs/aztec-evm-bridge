import {
  AccountWallet,
  createLogger,
  Fr,
  PXE,
  waitForPXE,
  createPXEClient,
  Logger,
  EthAddress,
  deriveKeys,
} from "@aztec/aztec.js"
import { getInitialTestAccountsWallets } from "@aztec/accounts/testing"
import { spawn } from "child_process"
import { createEthereumChain, createExtendedL1Client, RollupContract } from "@aztec/ethereum"
import { encodePacked, hexToBytes, padHex, sha256 } from "viem"
import { sha256ToField } from "@aztec/foundation/crypto"
import { computePartialAddress } from "@aztec/stdlib/contract"

import { parseFilledLog, parseOpenLog, parseResolvedCrossChainOrder, parseSettledLog } from "./utils.js"

import { AztecGateway7683Contract } from "../../artifacts/AztecGateway7683.js"
import { TokenContract } from "../../artifacts/Token.js"

const MNEMONIC = "test test test test test test test test test test test junk"
const PORTAL_ADDRESS = EthAddress.ZERO
const SETTLE_ORDER_TYPE = "0x191ea776bd6e0cd56a6d44ba4aea2fec468b4a0b4c1d880d4025929eeb615d0d"
const ORDER_DATA_TYPE = "0xf00c3bf60c73eb97097f1c9835537da014e0b755fe94b25d7ac8401df66716a0"
const SECRET = padHex(("0x" + Buffer.from("secret", "utf-8").toString("hex")) as `0x${string}`)
const SECRET_HASH = sha256(SECRET)
const AZTEC_7683_DOMAIN = 999999

const PUBLIC_ORDER = 0
const PRIVATE_ORDER = 1
const PRIVATE_SENDER = "0x0000000000000000000000000000000000000000000000000000000000000000"
const RECIPIENT = "0x1111111111111111111111111111111111111111111111111111111111111111"
const TOKEN_IN = "0x2222222222222222222222222222222222222222222222222222222222222222"
const TOKEN_OUT = "0x3333333333333333333333333333333333333333333333333333333333333333"
const AMOUNT_OUT_ZERO = 0n
const AMOUNT_IN_ZERO = 0n
const MAINNET_CHAIN_ID = 1
const FILL_DEADLINE = 2 ** 32 - 1
const DESTINATION_SETTLER = "0x4444444444444444444444444444444444444444444444444444444444444444"
const DATA = "0x5555555555555555555555555555555555555555555555555555555555555555"

const setupSandbox = async () => {
  const { PXE_URL = "http://localhost:8080" } = process.env
  const pxe = createPXEClient(PXE_URL)
  await waitForPXE(pxe)
  return pxe
}

// const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const setup = async ({ admin, pxe, receiver }: { admin: AccountWallet; pxe: PXE; receiver: AccountWallet }) => {
  const gatewaySecretKey = Fr.random()
  const gatewayPublicKeys = (await deriveKeys(gatewaySecretKey)).publicKeys
  const gatewayDeployment = AztecGateway7683Contract.deployWithPublicKeys(gatewayPublicKeys, admin, PORTAL_ADDRESS)
  const gatewayInstance = await gatewayDeployment.getInstance()
  const gateway = await gatewayDeployment.send().deployed()

  const tokenSecretKey = Fr.random()
  const tokenPublicKeys = (await deriveKeys(tokenSecretKey)).publicKeys
  const tokenDeployment = TokenContract.deployWithPublicKeys(
    tokenPublicKeys,
    admin,
    admin.getAddress(),
    "TestToken0000000000000000000000",
    "TT00000000000000000000000000000",
    18,
  )
  const tokenInstance = await tokenDeployment.getInstance()
  const token = await tokenDeployment.send().deployed()

  await pxe.registerAccount(gatewaySecretKey, await computePartialAddress(gatewayInstance))
  await pxe.registerAccount(tokenSecretKey, await computePartialAddress(tokenInstance))

  await token
    .withWallet(admin)
    .methods.mint_to_private(admin.getAddress(), receiver.getAddress(), 1000000000n)
    .send()
    .wait()
  await token.withWallet(admin).methods.mint_to_public(receiver.getAddress(), 1000000000n).send().wait()

  return {
    token,
    gateway,
  }
}

describe("AztecGateway7683", () => {
  let pxe: PXE
  let wallets: AccountWallet[] = []
  let logger: Logger
  let sandboxInstance
  let skipSandbox: boolean
  let publicClient: any
  let version: bigint

  beforeAll(async () => {
    skipSandbox = process.env.SKIP_SANDBOX === "true"
    /*if (!skipSandbox) {
      sandboxInstance = spawn("aztec", ["start", "--sandbox"], {
        detached: true,
        stdio: "ignore",
      })
      await sleep(15000)
    }*/

    logger = createLogger("aztec:aztec-starter:aztec_gateway_7683")
    pxe = await setupSandbox()
    wallets = await getInitialTestAccountsWallets(pxe)

    const nodeInfo = await pxe.getNodeInfo()
    const chain = createEthereumChain(["http://localhost:8545"], nodeInfo.l1ChainId)
    publicClient = createExtendedL1Client(chain.rpcUrls, MNEMONIC, chain.chainInfo)
    const l1Contracts = (await pxe.getNodeInfo()).l1ContractAddresses
    const rollup = new RollupContract(publicClient, l1Contracts.rollupAddress)
    version = await rollup.getVersion()
  })

  afterAll(async () => {
    if (!skipSandbox) {
      sandboxInstance!.kill("SIGINT")
    }
  })

  it("should open a public order and settle", async () => {
    const [admin, filler, user] = wallets
    const { token, gateway } = await setup({ admin, pxe, receiver: user })

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
      .send()
      .wait()

    const orderData = encodePacked(
      [
        "bytes32",
        "bytes32",
        "bytes32",
        "bytes32",
        "uint256",
        "uint256",
        "uint256",
        "uint32",
        "uint32",
        "bytes32",
        "uint32",
        "uint8",
        "bytes32",
      ],
      [
        user.getAddress().toString(),
        RECIPIENT,
        token.address.toString(),
        TOKEN_OUT,
        amountIn,
        AMOUNT_OUT_ZERO,
        nonce.toBigInt(),
        AZTEC_7683_DOMAIN,
        MAINNET_CHAIN_ID,
        DESTINATION_SETTLER,
        FILL_DEADLINE,
        PUBLIC_ORDER,
        DATA,
      ],
    )

    let fromBlock = await pxe.getBlockNumber()
    await gateway
      .withWallet(user)
      .methods.open({
        fill_deadline: FILL_DEADLINE,
        order_data: Array.from(hexToBytes(orderData)),
        order_data_type: Array.from(hexToBytes(ORDER_DATA_TYPE)),
      })
      .send()
      .wait()

    const { logs } = await pxe.getPublicLogs({
      fromBlock: fromBlock - 1,
      toBlock: fromBlock + 2,
      contractAddress: gateway.address,
    })
    const { resolvedOrder } = parseOpenLog(logs[0].log.log, logs[1].log.log)
    const parsedResolvedCrossChainOrder = parseResolvedCrossChainOrder(resolvedOrder)
    expect(parsedResolvedCrossChainOrder.orderId).toBe(sha256(orderData))
    expect(parsedResolvedCrossChainOrder.fillDeadline).toBe(FILL_DEADLINE)
    expect(parsedResolvedCrossChainOrder.originChainId).toBe(AZTEC_7683_DOMAIN)
    expect(parsedResolvedCrossChainOrder.fillInstructions[0].originData).toBe(orderData)
    expect(parsedResolvedCrossChainOrder.fillInstructions[0].destinationChainId).toBe(1)
    expect(parsedResolvedCrossChainOrder.fillInstructions[0].destinationSettler).toBe(DESTINATION_SETTLER)
    expect(parsedResolvedCrossChainOrder.maxSpent[0].chainId).toBe(MAINNET_CHAIN_ID)
    expect(parsedResolvedCrossChainOrder.maxSpent[0].amount).toBe(AMOUNT_OUT_ZERO)
    expect(parsedResolvedCrossChainOrder.maxSpent[0].recipient).toBe(RECIPIENT)
    expect(parsedResolvedCrossChainOrder.maxSpent[0].token).toBe(TOKEN_OUT)
    expect(parsedResolvedCrossChainOrder.minReceived[0].chainId).toBe(AZTEC_7683_DOMAIN)
    expect(parsedResolvedCrossChainOrder.minReceived[0].amount).toBe(amountIn)
    expect(parsedResolvedCrossChainOrder.minReceived[0].recipient).toBe(padHex("0x00"))
    expect(parsedResolvedCrossChainOrder.minReceived[0].token).toBe(token.address.toString())
    expect(parsedResolvedCrossChainOrder.user).toBe(user.getAddress().toString())

    const balancePre = await token.methods.balance_of_public(filler.getAddress()).simulate()
    await gateway
      .withWallet(filler)
      .methods.settle(
        Array.from(hexToBytes(parsedResolvedCrossChainOrder.orderId as `0x${string}`)),
        Array.from(hexToBytes(orderData)),
        Array.from(hexToBytes(filler.getAddress().toString())),
        0n, // TODO
      )
      .send()
      .wait()
    const balancePost = await token.methods.balance_of_public(filler.getAddress()).simulate()
    expect(balancePost).toBe(balancePre + amountIn)

    fromBlock = await pxe.getBlockNumber()
    const { logs: logs2 } = await pxe.getPublicLogs({
      fromBlock: fromBlock - 1,
      toBlock: fromBlock + 2,
      contractAddress: gateway.address,
    })
    const parsedSettledLog = parseSettledLog(logs2[logs2.length - 1].log.log)
    expect(parsedSettledLog.orderId).toBe(parsedResolvedCrossChainOrder.orderId)
    expect(parsedSettledLog.receiver).toBe(filler.getAddress().toString())
  })

  it("should open a private order and settle", async () => {
    const [admin, filler, user] = wallets
    const { token, gateway } = await setup({ admin, pxe, receiver: user })

    const amountIn = 100n
    const nonce = Fr.random()
    const witness = await user.createAuthWit({
      caller: gateway.address,
      action: token.withWallet(user).methods.transfer_in_private(user.getAddress(), gateway.address, amountIn, nonce),
    })

    const orderData = encodePacked(
      [
        "bytes32",
        "bytes32",
        "bytes32",
        "bytes32",
        "uint256",
        "uint256",
        "uint256",
        "uint32",
        "uint32",
        "bytes32",
        "uint32",
        "uint8",
        "bytes32",
      ],
      [
        PRIVATE_SENDER,
        RECIPIENT,
        token.address.toString(),
        TOKEN_OUT,
        amountIn,
        AMOUNT_OUT_ZERO,
        nonce.toBigInt(),
        AZTEC_7683_DOMAIN,
        MAINNET_CHAIN_ID,
        DESTINATION_SETTLER,
        FILL_DEADLINE,
        PRIVATE_ORDER,
        DATA,
      ],
    )

    let fromBlock = await pxe.getBlockNumber()
    const receipt = await gateway
      .withWallet(user)
      .methods.open_private({
        fill_deadline: FILL_DEADLINE,
        order_data: Array.from(hexToBytes(orderData)),
        order_data_type: Array.from(hexToBytes(ORDER_DATA_TYPE)),
      })
      .with({
        authWitnesses: [witness],
      })
      .send()
      .wait()

    await token.withWallet(filler).methods.sync_notes().simulate()
    const notes = await pxe.getNotes({
      txHash: receipt.txHash,
      recipient: gateway.address,
      contractAddress: token.address,
      scopes: [gateway.address],
    })
    expect(notes.length).toBe(1)

    const { logs } = await pxe.getPublicLogs({
      fromBlock: fromBlock - 1,
      toBlock: fromBlock + 2,
      contractAddress: gateway.address,
    })
    const { resolvedOrder } = parseOpenLog(logs[0].log.log, logs[1].log.log)
    const parsedResolvedCrossChainOrder = parseResolvedCrossChainOrder(resolvedOrder)
    expect(parsedResolvedCrossChainOrder.orderId).toBe(sha256(orderData))
    expect(parsedResolvedCrossChainOrder.fillDeadline).toBe(FILL_DEADLINE)
    expect(parsedResolvedCrossChainOrder.originChainId).toBe(AZTEC_7683_DOMAIN)
    expect(parsedResolvedCrossChainOrder.fillInstructions[0].originData).toBe(orderData)
    expect(parsedResolvedCrossChainOrder.fillInstructions[0].destinationChainId).toBe(1)
    expect(parsedResolvedCrossChainOrder.fillInstructions[0].destinationSettler).toBe(DESTINATION_SETTLER)
    expect(parsedResolvedCrossChainOrder.maxSpent[0].chainId).toBe(MAINNET_CHAIN_ID)
    expect(parsedResolvedCrossChainOrder.maxSpent[0].amount).toBe(AMOUNT_OUT_ZERO)
    expect(parsedResolvedCrossChainOrder.maxSpent[0].recipient).toBe(RECIPIENT)
    expect(parsedResolvedCrossChainOrder.maxSpent[0].token).toBe(TOKEN_OUT)
    expect(parsedResolvedCrossChainOrder.minReceived[0].chainId).toBe(AZTEC_7683_DOMAIN)
    expect(parsedResolvedCrossChainOrder.minReceived[0].amount).toBe(amountIn)
    expect(parsedResolvedCrossChainOrder.minReceived[0].recipient).toBe(padHex("0x00"))
    expect(parsedResolvedCrossChainOrder.minReceived[0].token).toBe(token.address.toString())
    expect(parsedResolvedCrossChainOrder.user).toBe(PRIVATE_SENDER)

    const balancePre = await token.methods.balance_of_private(filler.getAddress()).simulate()
    await gateway
      .withWallet(filler)
      .methods.settle_private(
        Array.from(hexToBytes(parsedResolvedCrossChainOrder.orderId as `0x${string}`)),
        Array.from(hexToBytes(orderData)),
        Array.from(hexToBytes(filler.getAddress().toString())),
        0n, // TODO
      )
      .send()
      .wait()
    const balancePost = await token.methods.balance_of_private(filler.getAddress()).simulate()
    expect(balancePost).toBe(balancePre + amountIn)

    fromBlock = await pxe.getBlockNumber()
    const { logs: logs2 } = await pxe.getPublicLogs({
      fromBlock: fromBlock - 1,
      toBlock: fromBlock + 2,
      contractAddress: gateway.address,
    })
    const parsedSettledLog = parseSettledLog(logs2[logs2.length - 1].log.log)
    expect(parsedSettledLog.orderId).toBe(parsedResolvedCrossChainOrder.orderId)
    expect(parsedSettledLog.receiver).toBe(filler.getAddress().toString())
  })

  it("should fill a public order and send the settlement message to the forwarder via portal", async () => {
    const [admin, filler, recipient] = wallets
    const { token, gateway } = await setup({ admin, pxe, receiver: filler })

    const amountOut = 100n
    const nonce = Fr.random()
    const originData = encodePacked(
      [
        "bytes32",
        "bytes32",
        "bytes32",
        "bytes32",
        "uint256",
        "uint256",
        "uint256",
        "uint32",
        "uint32",
        "bytes32",
        "uint32",
        "uint8",
        "bytes32",
      ],
      [
        admin.getAddress().toString(),
        recipient.getAddress().toString(),
        TOKEN_IN,
        token.address.toString(),
        AMOUNT_IN_ZERO,
        amountOut,
        nonce.toBigInt(),
        MAINNET_CHAIN_ID,
        AZTEC_7683_DOMAIN,
        DESTINATION_SETTLER,
        FILL_DEADLINE,
        PUBLIC_ORDER,
        DATA,
      ],
    )

    const orderId = sha256(originData)
    const fillerData = padHex("0x00") // keep it 0 for now
    await (
      await filler.setPublicAuthWit(
        {
          caller: gateway.address,
          action: token
            .withWallet(filler)
            .methods.transfer_in_public(filler.getAddress(), recipient.getAddress(), amountOut, nonce),
        },
        true,
      )
    )
      .send()
      .wait()

    const fromBlock = await pxe.getBlockNumber()
    await gateway
      .withWallet(filler)
      .methods.fill(
        Array.from(hexToBytes(orderId)),
        Array.from(hexToBytes(originData)),
        Array.from(hexToBytes(fillerData)),
      )
      .send()
      .wait()

    const { logs } = await pxe.getPublicLogs({
      fromBlock: fromBlock - 1,
      toBlock: fromBlock + 2,
      contractAddress: gateway.address,
    })
    const parsedLog = parseFilledLog(logs[0].log.log)
    expect(orderId).toBe(parsedLog.orderId)
    expect(originData).toBe(parsedLog.originData)
    expect(fillerData).toBe(parsedLog.fillerData)

    const content = sha256ToField([
      Buffer.from(SETTLE_ORDER_TYPE.slice(2), "hex"),
      Buffer.from(orderId.slice(2), "hex"),
      Buffer.alloc(32, 0),
    ])

    const l2ToL1Message = sha256ToField([
      gateway.address.toBuffer(),
      new Fr(version).toBuffer(), // aztec version
      PORTAL_ADDRESS.toBuffer32(),
      new Fr(publicClient.chain.id).toBuffer(),
      content.toBuffer(),
    ])

    const orderSettlementBlockNumber = await gateway.methods
      .get_order_settlement_block_number(Array.from(hexToBytes(orderId)))
      .simulate()

    const [l2ToL1MessageIndex, siblingPath] = await pxe.getL2ToL1MembershipWitness(
      parseInt(orderSettlementBlockNumber),
      l2ToL1Message,
    )

    expect(l2ToL1MessageIndex).toBe(0n)
    expect(siblingPath.pathSize).toBe(1)
  })

  it("should fill a private order and send the settlement message to the forwarder via portal", async () => {
    const [admin, filler, recipient] = wallets
    const { token, gateway } = await setup({ admin, pxe, receiver: filler })

    const amountOut = 100n
    const nonce = Fr.random()
    const originData = encodePacked(
      [
        "bytes32",
        "bytes32",
        "bytes32",
        "bytes32",
        "uint256",
        "uint256",
        "uint256",
        "uint32",
        "uint32",
        "bytes32",
        "uint32",
        "uint8",
        "bytes32",
      ],
      [
        PRIVATE_SENDER,
        SECRET_HASH,
        TOKEN_IN,
        token.address.toString(),
        AMOUNT_IN_ZERO,
        amountOut,
        nonce.toBigInt(),
        MAINNET_CHAIN_ID,
        AZTEC_7683_DOMAIN,
        DESTINATION_SETTLER,
        FILL_DEADLINE,
        PRIVATE_ORDER,
        DATA,
      ],
    )
    const orderId = sha256(originData)
    const fillerData = filler.getAddress().toString()

    const witness = await filler.createAuthWit({
      caller: gateway.address,
      action: token
        .withWallet(filler)
        .methods.transfer_in_private(filler.getAddress(), gateway.address, amountOut, nonce),
    })
    const fromBlock = await pxe.getBlockNumber()
    await gateway
      .withWallet(filler)
      .methods.fill_private(
        Array.from(hexToBytes(orderId)),
        Array.from(hexToBytes(originData)),
        Array.from(hexToBytes(fillerData)),
      )
      .with({
        authWitnesses: [witness],
      })
      .send()
      .wait()
    const { logs } = await pxe.getPublicLogs({
      fromBlock: fromBlock - 1,
      toBlock: fromBlock + 2,
      contractAddress: gateway.address,
    })
    const parsedLog = parseFilledLog(logs[0].log.log)
    expect(orderId).toBe(parsedLog.orderId)
    expect(originData).toBe(parsedLog.originData)
    expect(fillerData).toBe(parsedLog.fillerData)

    await gateway
      .withWallet(recipient)
      .methods.claim_private(
        Array.from(hexToBytes(SECRET)),
        Array.from(hexToBytes(orderId)),
        Array.from(hexToBytes(originData)),
        Array.from(hexToBytes(fillerData)),
      )
      .send()
      .wait()

    const orderSettlementBlockNumber = await gateway.methods
      .get_order_settlement_block_number(Array.from(hexToBytes(orderId)))
      .simulate()

    const content = sha256ToField([
      Buffer.from(SETTLE_ORDER_TYPE.slice(2), "hex"),
      Buffer.from(orderId.slice(2), "hex"),
      Buffer.from(fillerData.slice(2), "hex"),
    ])

    const l2ToL1Message = sha256ToField([
      gateway.address.toBuffer(),
      new Fr(version).toBuffer(), // aztec version
      PORTAL_ADDRESS.toBuffer32(),
      new Fr(publicClient.chain.id).toBuffer(),
      content.toBuffer(),
    ])

    const [l2ToL1MessageIndex, siblingPath] = await pxe.getL2ToL1MembershipWitness(
      parseInt(orderSettlementBlockNumber),
      l2ToL1Message,
    )

    expect(l2ToL1MessageIndex).toBe(0n)
    expect(siblingPath.pathSize).toBe(1)
  })
})
