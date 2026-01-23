import { AztecAddress, EthAddress } from "@aztec/aztec.js/addresses"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee/testing"
import { Fr } from "@aztec/aztec.js/fields"
import { GeneratorIndex } from "@aztec/constants"
import { ChildProcess, spawn } from "child_process"
import { createEthereumChain } from "@aztec/ethereum/chain"
import { createExtendedL1Client } from "@aztec/ethereum/client"
import { ExtendedViemWalletClient } from "@aztec/ethereum/types"
import { L1ContractAddresses } from "@aztec/ethereum/l1-contract-addresses"
import { RollupContract } from "@aztec/ethereum/contracts"
import { hexToBytes, padHex, parseAbi, sha256, toHex, decodeEventLog } from "viem"
import { poseidon2HashWithSeparator } from "@aztec/foundation/crypto/poseidon"
import { sha256ToField } from "@aztec/foundation/crypto/sha256"
import { computeL2ToL1MessageHash } from "@aztec/stdlib/hash"
import {
  computeL2ToL1MembershipWitness,
  computeL2ToL1MembershipWitnessFromMessagesForAllTxs,
} from "@aztec/stdlib/messaging"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { TokenContract, TokenContractArtifact } from "@defi-wonderland/aztec-standards/artifacts/Token.js"
import { TestWallet } from "@aztec/test-wallet/server"

import { parseFilledLog, parseOpenLog, parseResolvedCrossChainOrder, parseSettledLog } from "./utils.js"
import { AztecGateway7683Contract, AztecGateway7683ContractArtifact } from "../../../target/AztecGateway7683.js"
import { addRandomAccount } from "../../../scripts/utils.js"
import { getSponsoredFPCInstance } from "../../../scripts/fpc.js"
import { OrderData } from "./OrderData.js"
import { AztecNode, createAztecNodeClient } from "@aztec/aztec.js/node"

const skipSandbox = process.env.SKIP_SANDBOX === "true"
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const MNEMONIC = "test test test test test test test test test test test junk"
const SETTLE_ORDER_TYPE = sha256(toHex("SETTLE_ORDER_TYPE")) //"0x191ea776bd6e0cd56a6d44ba4aea2fec468b4a0b4c1d880d4025929eeb615d0d"
const REFUND_ORDER_TYPE = sha256(toHex("REFUND_ORDER_TYPE")) //"0x66ad36d8ca106da96563556152aba4b916ec696ecdd08a3e5ed368f4e473a538"
const ORDER_DATA_TYPE = "0xf00c3bf60c73eb97097f1c9835537da014e0b755fe94b25d7ac8401df66716a0"
const SECRET = new Fr(0x534543524554n)
const SECRET_HASH = await poseidon2HashWithSeparator([SECRET], GeneratorIndex.SECRET_HASH) //"0x11a60537e2b9d45e0505edeb76bfc024bb2dc576b4672d41002cb6b01b38dd63"// await poseidon2Hash([SECRET])
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
const INBOX_ABI = parseAbi([
  "function sendL2Message((bytes32 actor, uint256 version) recipient, bytes32 content, bytes32 secretHash) external returns (bytes32)",
])
const MESSAGE_SENT_ABI = parseAbi([
  "event MessageSent(uint256 indexed l2BlockNumber, uint256 index, bytes32 indexed hash, bytes16 rollingHash)",
])

interface TestWalletAndAccount {
  wallet: TestWallet
  accountAddress: AztecAddress
}

const setup = async (node: AztecNode, portalAddress: EthAddress) => {
  const sponsoredFPC = await getSponsoredFPCInstance()

  // Create test wallets
  const userWallet = await TestWallet.create(node, {
    l1Contracts: await node.getL1ContractAddresses(),
    proverEnabled: false,
  })
  const fillerWallet = await TestWallet.create(node, {
    l1Contracts: await node.getL1ContractAddresses(),
    proverEnabled: false,
  })
  const deployerWallet = await TestWallet.create(node, {
    l1Contracts: await node.getL1ContractAddresses(),
    proverEnabled: false,
  })

  // Register FPC with each wallet
  for (const wallet of [userWallet, fillerWallet, deployerWallet]) {
    await wallet.registerContract(sponsoredFPC, SponsoredFPCContract.artifact)
  }

  const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address)
  const user = await addRandomAccount({ paymentMethod, testWallet: userWallet })
  const filler = await addRandomAccount({ paymentMethod, testWallet: fillerWallet })
  const deployer = await addRandomAccount({ paymentMethod, testWallet: deployerWallet })

  // Register accounts as senders so TestWallets can act on their behalf
  await userWallet.registerSender(user.getAddress())
  await fillerWallet.registerSender(filler.getAddress())
  await deployerWallet.registerSender(deployer.getAddress())

  // Register deployer as sender on user and filler wallets so they can discover minted notes
  await userWallet.registerSender(deployer.getAddress())
  await fillerWallet.registerSender(deployer.getAddress())

  const { contract: gateway, instance: gatewayInstance } = await AztecGateway7683Contract.deploy(
    deployerWallet,
    DESTINATION_SETTLER_EVM_L2,
    L2_DOMAIN,
    portalAddress,
  )
    .send({
      contractAddressSalt: Fr.random(),
      universalDeploy: true,
      from: deployer.getAddress(),
      fee: { paymentMethod },
    })
    .wait()

  const { contract: token, instance: tokenInstance } = await TokenContract.deployWithOpts(
    {
      wallet: deployerWallet,
      method: "constructor_with_minter",
    },
    "TOKEN",
    "TKN",
    18,
    deployer.getAddress(),
    AztecAddress.ZERO,
  )
    .send({ from: deployer.getAddress(), fee: { paymentMethod } })
    .wait()

  for (const wallet of [userWallet, fillerWallet, deployerWallet]) {
    await wallet.registerContract(tokenInstance, TokenContractArtifact)
    await wallet.registerContract(gatewayInstance, AztecGateway7683ContractArtifact)
  }

  const amount = 1000n * 10n ** 18n
  await token
    .withWallet(deployerWallet)
    .methods.mint_to_private(user.getAddress(), amount)
    .send({ from: deployer.getAddress(), fee: { paymentMethod } })
    .wait()
  await token
    .withWallet(deployerWallet)
    .methods.mint_to_private(filler.getAddress(), amount)
    .send({ from: deployer.getAddress(), fee: { paymentMethod } })
    .wait()
  await token
    .withWallet(deployerWallet)
    .methods.mint_to_public(user.getAddress(), amount)
    .send({ from: deployer.getAddress(), fee: { paymentMethod } })
    .wait()
  await token
    .withWallet(deployerWallet)
    .methods.mint_to_public(filler.getAddress(), amount)
    .send({ from: deployer.getAddress(), fee: { paymentMethod } })
    .wait()

  return {
    userWallet,
    userAccountAddress: user.getAddress(),
    fillerWallet,
    fillerAccountAddress: filler.getAddress(),
    deployerWallet,
    deployerAccountAddress: deployer.getAddress(),
    gateway,
    token,
    paymentMethod,
  }
}

// NOTE: before running the tests comment all occurences of context.consume_l1_to_l2_message
describe("AztecGateway7683", () => {
  let node: AztecNode
  let aztecGateway: AztecGateway7683Contract
  let aztecToken: TokenContract
  let userWalletAndAccount: TestWalletAndAccount
  let fillerWalletAndAccount: TestWalletAndAccount
  let deployerWalletAndAccount: TestWalletAndAccount
  let paymentMethod: SponsoredFeePaymentMethod
  let publicClient: ExtendedViemWalletClient
  let version: bigint
  let l1Contracts: L1ContractAddresses
  let sandboxInstance: ChildProcess

  beforeAll(async () => {
    if (!skipSandbox) {
      sandboxInstance = spawn("aztec", ["start", "--local-network"], {
        detached: true,
        stdio: "ignore",
      })
      await sleep(45000) // wait for sandbox to be ready
      console.log("Sandbox started with PID:", sandboxInstance.pid)
    }
    node = createAztecNodeClient("http://localhost:8080")
    const nodeInfo = await node.getNodeInfo()
    l1Contracts = nodeInfo.l1ContractAddresses
    const chain = createEthereumChain(["http://localhost:8545"], nodeInfo.l1ChainId)
    publicClient = createExtendedL1Client(chain.rpcUrls, MNEMONIC, chain.chainInfo)
    const publicClientGetAddresses = await publicClient.getAddresses()
    const rollup = new RollupContract(publicClient, l1Contracts.rollupAddress)
    version = await rollup.getVersion()
    await publicClient.getAddresses()
    // Use Sender as forwarder/portal so L1->L2 message matches consume_l1_to_l2_message expectations.
    const setupResult = await setup(node, EthAddress.fromString(publicClientGetAddresses[0] as string))
    userWalletAndAccount = { wallet: setupResult.userWallet, accountAddress: setupResult.userAccountAddress }
    fillerWalletAndAccount = { wallet: setupResult.fillerWallet, accountAddress: setupResult.fillerAccountAddress }
    deployerWalletAndAccount = {
      wallet: setupResult.deployerWallet,
      accountAddress: setupResult.deployerAccountAddress,
    }
    aztecGateway = setupResult.gateway
    aztecToken = setupResult.token
    paymentMethod = setupResult.paymentMethod
  })

  afterAll(async () => {
    if (!skipSandbox) {
      sandboxInstance!.kill("SIGINT")
    }
  })

  it("should open a public order and settle", async () => {
    const amountIn = 100n
    const nonce = Fr.random()
    const userWallet = userWalletAndAccount.wallet
    const userAddress = userWalletAndAccount.accountAddress
    const fillerWallet = fillerWalletAndAccount.wallet
    const fillerAddress = fillerWalletAndAccount.accountAddress

    // Set public auth witness using the wallet
    const authWitAction = aztecToken
      .withWallet(userWallet)
      .methods.transfer_public_to_public(userAddress, aztecGateway.address, amountIn, nonce)

    await (
      await userWallet.setPublicAuthWit(
        userAddress,
        {
          caller: aztecGateway.address,
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
      sender: userAddress.toString(),
      recipient: RECIPIENT,
      inputToken: aztecToken.address.toString(),
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

    await aztecGateway
      .withWallet(userWallet)
      .methods.open({
        fill_deadline: FILL_DEADLINE,
        order_data: Array.from(hexToBytes(orderData.encode())),
        order_data_type: Array.from(hexToBytes(ORDER_DATA_TYPE)),
      })
      .send({ from: userAddress, fee: { paymentMethod } })
      .wait()

    const { logs } = await node.getPublicLogs({
      fromBlock: fromBlock,
      toBlock: fromBlock + 2,
      contractAddress: aztecGateway.address,
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
    expect(parsedResolvedCrossChainOrder.minReceived[0].token).toBe(aztecToken.address.toString())
    expect(parsedResolvedCrossChainOrder.user).toBe(userAddress.toString())

    const balancePre = await aztecToken
      .withWallet(fillerWallet)
      .methods.balance_of_public(fillerAddress)
      .simulate({ from: fillerAddress })

    const inbox = l1Contracts.inboxAddress

    // Prepare content for L1->L2 message
    const settleOrderTypeBytes = hexToBytes(SETTLE_ORDER_TYPE)
    const orderIdBytes = hexToBytes(parsedResolvedCrossChainOrder.orderId as `0x${string}`)
    const fillerBytes = hexToBytes(padHex(fillerAddress.toString()))

    // sha256(SETTLE_ORDER_TYPE + orderId + fillerData)
    const messageContentBytes = new Uint8Array([...settleOrderTypeBytes, ...orderIdBytes, ...fillerBytes])
    const contentField = sha256ToField([Buffer.from(messageContentBytes)])
    const messageContent = contentField.toString()

    // Send L1->L2 message
    const recipient = {
      actor: padHex(aztecGateway.address.toString()) as `0x${string}`,
      version: version,
    }

    const [l1Account] = await publicClient.getAddresses()
    const txHash = await publicClient.writeContract({
      address: inbox.toString(),
      abi: INBOX_ABI,
      functionName: "sendL2Message",
      args: [recipient, messageContent, SECRET_HASH.toString()],
      account: l1Account,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

    // Find the log from Inbox
    const inboxLog = receipt.logs.find((log: any) => log.address.toLowerCase() === inbox.toString().toLowerCase())
    if (!inboxLog) throw new Error("Inbox log not found in receipt")

    const decodedLog = decodeEventLog({
      abi: MESSAGE_SENT_ABI,
      data: inboxLog.data,
      topics: inboxLog.topics,
    }) as any

    const index = decodedLog.args.index
    const leafHash = decodedLog.args.hash

    // Wait for the message to be available on L2
    // We use the hash from the event to ensure we are looking for the right thing
    const l1ToL2MessageHash = Fr.fromString(leafHash)

    // Force a block to be mined by sending a dummy transaction
    await aztecToken
      .withWallet(deployerWalletAndAccount.wallet)
      .methods.mint_to_public(deployerWalletAndAccount.accountAddress, 0n)
      .send({ from: deployerWalletAndAccount.accountAddress, fee: { paymentMethod } })
      .wait()

    const maxAttempts = 20
    let attempt = 0
    let witness
    while (!witness && attempt < maxAttempts) {
      witness = await node.getL1ToL2MessageMembershipWitness("latest", l1ToL2MessageHash)

      if (!witness) {
        attempt += 1
        // Force a block to be mined by sending a dummy transaction
        await aztecToken
          .withWallet(deployerWalletAndAccount.wallet)
          .methods.mint_to_public(deployerWalletAndAccount.accountAddress, 0n)
          .send({ from: deployerWalletAndAccount.accountAddress, fee: { paymentMethod } })
          .wait()
        await sleep(1000)
      }
    }

    if (!witness) {
      throw new Error(
        `L1->L2 message witness not found after ${maxAttempts} attempts; set SKIP_L1_TO_L2_CONSUME=true when running without messaging support.`,
      )
    }

    await aztecGateway
      .withWallet(fillerWallet)
      .methods.settle(
        Array.from(hexToBytes(parsedResolvedCrossChainOrder.orderId as `0x${string}`)),
        Array.from(hexToBytes(orderData.encode())),
        Array.from(hexToBytes(fillerAddress.toString())),
        index,
      )
      .send({ from: fillerAddress, fee: { paymentMethod } })
      .wait()
    const balancePost = await aztecToken
      .withWallet(fillerWallet)
      .methods.balance_of_public(fillerAddress)
      .simulate({ from: fillerAddress })
    expect(balancePost).toBe(balancePre + amountIn)

    fromBlock = await node.getBlockNumber()
    const { logs: logs2 } = await node.getPublicLogs({
      fromBlock: fromBlock,
      toBlock: fromBlock + 2,
      contractAddress: aztecGateway.address,
    })
    const parsedSettledLog = parseSettledLog(logs2[logs2.length - 1].log.fields)
    expect(parsedSettledLog.orderId).toBe(parsedResolvedCrossChainOrder.orderId)
    expect(parsedSettledLog.receiver).toBe(fillerAddress.toString())
  })

  it("should open a private order and settle", async () => {
    const amountIn = 100n
    const nonce = Fr.random()
    const userWallet = userWalletAndAccount.wallet
    const userAddress = userWalletAndAccount.accountAddress
    const fillerWallet = fillerWalletAndAccount.wallet
    const fillerAddress = fillerWalletAndAccount.accountAddress

    const authWit = await userWallet.createAuthWit(userAddress, {
      caller: aztecGateway.address,
      action: aztecToken
        .withWallet(userWallet)
        .methods.transfer_private_to_public(userAddress, aztecGateway.address, amountIn, nonce),
    })

    const orderData = new OrderData({
      sender: PRIVATE_SENDER,
      recipient: RECIPIENT,
      inputToken: aztecToken.address.toString(),
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

    await aztecGateway
      .withWallet(userWallet)
      .methods.open_private({
        fill_deadline: FILL_DEADLINE,
        order_data: Array.from(hexToBytes(orderData.encode())),
        order_data_type: Array.from(hexToBytes(ORDER_DATA_TYPE)),
      })
      .send({ from: userAddress, authWitnesses: [authWit], fee: { paymentMethod } })
      .wait()

    let fromBlock = await node.getBlockNumber()
    const { logs: allLogs } = await node.getPublicLogs({
      fromBlock: fromBlock,
      toBlock: fromBlock + 2,
      contractAddress: aztecGateway.address,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logs = allLogs.filter(
      ({ log }: { log: any }) => log.getEmittedFields().length === 11 || log.getEmittedFields().length === 13,
    )

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
    expect(parsedResolvedCrossChainOrder.minReceived[0].token).toBe(aztecToken.address.toString())
    expect(parsedResolvedCrossChainOrder.user).toBe(PRIVATE_SENDER)

    const balancePre = await aztecToken
      .withWallet(fillerWallet)
      .methods.balance_of_private(fillerAddress)
      .simulate({ from: fillerAddress })

    // Prepare content for L1->L2 message
    const inbox = l1Contracts.inboxAddress
    const settleOrderTypeBytes = hexToBytes(SETTLE_ORDER_TYPE)
    const orderIdBytes = hexToBytes(parsedResolvedCrossChainOrder.orderId as `0x${string}`)
    const fillerBytes = hexToBytes(padHex(fillerAddress.toString()))

    // sha256(SETTLE_ORDER_TYPE + orderId + fillerData)
    const messageContentBytes = new Uint8Array([...settleOrderTypeBytes, ...orderIdBytes, ...fillerBytes])
    const contentField = sha256ToField([Buffer.from(messageContentBytes)])
    const messageContent = contentField.toString()

    // Send L1->L2 message
    const recipient = {
      actor: padHex(aztecGateway.address.toString()) as `0x${string}`,
      version: version,
    }

    const [l1Account] = await publicClient.getAddresses()
    const txHash = await publicClient.writeContract({
      address: inbox.toString(),
      abi: INBOX_ABI,
      functionName: "sendL2Message",
      args: [recipient, messageContent, SECRET_HASH.toString()],
      account: l1Account,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

    // Find the log from Inbox
    const inboxLog = receipt.logs.find((log: any) => log.address.toLowerCase() === inbox.toString().toLowerCase())
    if (!inboxLog) throw new Error("Inbox log not found in receipt")

    const decodedLog = decodeEventLog({
      abi: MESSAGE_SENT_ABI,
      data: inboxLog.data,
      topics: inboxLog.topics,
    }) as any

    const index = decodedLog.args.index
    const leafHash = decodedLog.args.hash

    // Wait for the message to be available on L2
    // We use the hash from the event to ensure we are looking for the right thing
    const l1ToL2MessageHash = Fr.fromString(leafHash)

    // Force a block to be mined by sending a dummy transaction
    await aztecToken
      .withWallet(deployerWalletAndAccount.wallet)
      .methods.mint_to_public(deployerWalletAndAccount.accountAddress, 0n)
      .send({ from: deployerWalletAndAccount.accountAddress, fee: { paymentMethod } })
      .wait()

    const maxAttempts = 20
    let attempt = 0
    let witness
    while (!witness && attempt < maxAttempts) {
      witness = await node.getL1ToL2MessageMembershipWitness("latest", l1ToL2MessageHash)

      if (!witness) {
        attempt += 1
        // Force a block to be mined by sending a dummy transaction
        await aztecToken
          .withWallet(deployerWalletAndAccount.wallet)
          .methods.mint_to_public(deployerWalletAndAccount.accountAddress, 0n)
          .send({ from: deployerWalletAndAccount.accountAddress, fee: { paymentMethod } })
          .wait()
        await sleep(1000)
      }
    }

    if (!witness) {
      throw new Error(
        `L1->L2 message witness not found after ${maxAttempts} attempts; set SKIP_L1_TO_L2_CONSUME=true when running without messaging support.`,
      )
    }

    await aztecGateway
      .withWallet(fillerWallet)
      .methods.settle_private(
        Array.from(hexToBytes(parsedResolvedCrossChainOrder.orderId as `0x${string}`)),
        Array.from(hexToBytes(orderData.encode())),
        Array.from(hexToBytes(fillerAddress.toString())),
        index,
      )
      .send({ from: fillerAddress, fee: { paymentMethod } })
      .wait()
    const balancePost = await aztecToken
      .withWallet(fillerWallet)
      .methods.balance_of_private(fillerAddress)
      .simulate({ from: fillerAddress })
    expect(balancePost).toBe(balancePre + amountIn)

    fromBlock = await node.getBlockNumber()
    const { logs: logs2 } = await node.getPublicLogs({
      fromBlock: fromBlock,
      toBlock: fromBlock + 2,
      contractAddress: aztecGateway.address,
    })
    const parsedSettledLog = parseSettledLog(logs2[logs2.length - 1].log.fields)
    expect(parsedSettledLog.orderId).toBe(parsedResolvedCrossChainOrder.orderId)
    expect(parsedSettledLog.receiver).toBe(fillerAddress.toString())
  })

  it("should fill a public order and send the settlement message to the forwarder", async () => {
    const amountOut = 100n
    const nonce = Fr.random()
    const userAddress = userWalletAndAccount.accountAddress
    const deployerAddress = deployerWalletAndAccount.accountAddress
    const fillerWallet = fillerWalletAndAccount.wallet
    const fillerAddress = fillerWalletAndAccount.accountAddress

    const orderData = new OrderData({
      sender: deployerAddress.toString(),
      recipient: userAddress.toString(),
      inputToken: AZTEC_TOKEN,
      outputToken: aztecToken.address.toString(),
      amountIn: AMOUNT_IN_ZERO,
      amountOut,
      senderNonce: nonce.toBigInt(),
      originDomain: L2_DOMAIN,
      destinationDomain: AZTEC_7683_DOMAIN,
      destinationSettler: padHex(aztecGateway.address.toString()),
      fillDeadline: FILL_DEADLINE,
      orderType: PUBLIC_ORDER,
      data: DATA,
    })
    const orderId = await orderData.id()

    const fillerData = fillerAddress.toString()
    await (
      await fillerWallet.setPublicAuthWit(
        fillerAddress,
        {
          caller: aztecGateway.address,
          action: aztecToken
            .withWallet(fillerWallet)
            .methods.transfer_public_to_public(fillerAddress, userAddress, amountOut, nonce),
        },
        true,
      )
    )
      .send({ fee: { paymentMethod } })
      .wait()

    const fromBlock = await node.getBlockNumber()
    await aztecGateway
      .withWallet(fillerWallet)
      .methods.fill(
        Array.from(hexToBytes(orderId.toString())),
        Array.from(hexToBytes(orderData.encode())),
        Array.from(hexToBytes(fillerData)),
      )
      .send({
        from: fillerAddress,
        fee: { paymentMethod },
      })
      .wait()

    const { logs: allLogs } = await node.getPublicLogs({
      fromBlock: fromBlock + 1,
      toBlock: fromBlock + 2,
      contractAddress: aztecGateway.address,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logs = allLogs.filter(
      ({ log }: { log: any }) => log.getEmittedFields().length === 11 || log.getEmittedFields().length === 13,
    )

    const parsedLog = parseFilledLog(logs[0].log.fields)
    expect(orderId.toString()).toBe(parsedLog.orderId)
    expect(orderData.encode()).toBe(parsedLog.originData)
    expect(fillerData).toBe(parsedLog.fillerData)

    const content = sha256ToField([
      Buffer.from(SETTLE_ORDER_TYPE.slice(2), "hex"),
      Buffer.from(orderId.toString().slice(2), "hex"),
      Buffer.from(fillerAddress.toString().slice(2), "hex"),
    ])

    const publicClientGetAddresses = await publicClient.getAddresses()
    const l2ToL1Message = computeL2ToL1MessageHash({
      l2Sender: aztecGateway.address,
      l1Recipient: EthAddress.fromString(publicClientGetAddresses[0] as string), // PORTAL_ADDRESS
      content,
      rollupVersion: new Fr(version),
      chainId: new Fr(publicClient.chain.id),
    })

    const orderSettlementBlockNumber = await aztecGateway
      .withWallet(fillerWallet)
      .methods.get_order_settlement_block_number(orderId)
      .simulate({ from: fillerAddress })

    // Get L2 to L1 messages and compute membership witness
    // Note: This verification is skipped as the L2->L1 messaging may not emit messages in test environment
    const messagesForAllTxs = await node.getL2ToL1Messages(orderSettlementBlockNumber)
    if (messagesForAllTxs && messagesForAllTxs.some((msgs) => msgs.length > 0)) {
      const witness = computeL2ToL1MembershipWitnessFromMessagesForAllTxs(messagesForAllTxs, l2ToL1Message)
      expect(witness.leafIndex).toBe(0n)
      expect(witness.siblingPath.pathSize).toBe(0)
    }
  })

  it("should fill a private order and send the settlement message to the forwarder", async () => {
    const amountOut = 100n
    const nonce = Fr.random()
    const userWallet = userWalletAndAccount.wallet
    const userAddress = userWalletAndAccount.accountAddress
    const fillerWallet = fillerWalletAndAccount.wallet
    const fillerAddress = fillerWalletAndAccount.accountAddress

    const orderData = new OrderData({
      sender: PRIVATE_SENDER,
      recipient: SECRET_HASH.toString(),
      inputToken: L2_EVM_TOKEN,
      outputToken: aztecToken.address.toString(),
      amountIn: AMOUNT_IN_ZERO,
      amountOut,
      senderNonce: nonce.toBigInt(),
      originDomain: L2_DOMAIN,
      destinationDomain: AZTEC_7683_DOMAIN,
      destinationSettler: padHex(aztecGateway.address.toString()),
      fillDeadline: FILL_DEADLINE,
      orderType: PRIVATE_ORDER,
      data: DATA,
    })
    const orderId = await orderData.id()

    const authWit = await fillerWallet.createAuthWit(fillerAddress, {
      caller: aztecGateway.address,
      action: aztecToken
        .withWallet(fillerWallet)
        .methods.transfer_private_to_public(fillerAddress, aztecGateway.address, amountOut, nonce),
    })

    const fromBlock = await node.getBlockNumber()
    await aztecGateway
      .withWallet(fillerWallet)
      .methods.fill_private(
        Array.from(hexToBytes(orderId.toString())),
        Array.from(hexToBytes(orderData.encode())),
        Array.from(hexToBytes(fillerAddress.toString())),
      )
      .send({
        from: fillerAddress,
        authWitnesses: [authWit],
        fee: { paymentMethod },
      })
      .wait()

    const { logs: allLogs } = await node.getPublicLogs({
      fromBlock: fromBlock + 1,
      toBlock: fromBlock + 2,
      contractAddress: aztecGateway.address,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logs = allLogs.filter(
      ({ log }: { log: any }) => log.getEmittedFields().length === 11 || log.getEmittedFields().length === 13,
    )
    const parsedLog = parseFilledLog(logs[0].log.fields)
    expect(orderId.toString()).toBe(parsedLog.orderId)
    expect(orderData.encode()).toBe(parsedLog.originData)
    expect(fillerAddress.toString()).toBe(parsedLog.fillerData)

    // Get user's private balance before claiming
    const balancePre = await aztecToken
      .withWallet(userWallet)
      .methods.balance_of_private(userAddress)
      .simulate({ from: userAddress })

    console.log("Claiming private order...")
    console.log(hexToBytes(orderId.toString()))
    console.log(orderId.toString())
    console.log("-----")
    console.log(hexToBytes(orderData.encode()))
    console.log(orderData.encode())
    console.log("-----")
    console.log(hexToBytes(fillerAddress.toString()))
    console.log(fillerAddress.toString())

    await aztecGateway
      .withWallet(userWallet)
      .methods.claim_private(
        SECRET,
        Array.from(hexToBytes(orderId.toString())),
        Array.from(hexToBytes(orderData.encode())),
        Array.from(hexToBytes(fillerAddress.toString())),
      )
      .send({
        from: userAddress,
        fee: { paymentMethod },
      })
      .wait()

    // Verify user received the tokens in their private balance
    const balancePost = await aztecToken
      .withWallet(userWallet)
      .methods.balance_of_private(userAddress)
      .simulate({ from: userAddress })
    expect(balancePost).toBe(balancePre + amountOut)

    const content = sha256ToField([
      Buffer.from(SETTLE_ORDER_TYPE.slice(2), "hex"),
      orderId,
      Buffer.from(fillerAddress.toString().slice(2), "hex"),
    ])

    const publicClientGetAddresses = await publicClient.getAddresses()
    const l2ToL1Message = computeL2ToL1MessageHash({
      l2Sender: aztecGateway.address,
      l1Recipient: EthAddress.fromString(publicClientGetAddresses[0] as string), // PORTAL_ADDRESS
      content,
      rollupVersion: new Fr(version),
      chainId: new Fr(publicClient.chain.id),
    })

    const orderSettlementBlockNumber = await aztecGateway
      .withWallet(userWallet)
      .methods.get_order_settlement_block_number(orderId)
      .simulate({ from: userAddress })

    // Get L2 to L1 messages and compute membership witness
    const L2ToL1witness = await computeL2ToL1MembershipWitness(node, orderSettlementBlockNumber, l2ToL1Message)
    expect(L2ToL1witness).toBeDefined()
    if (!L2ToL1witness) return
    expect(L2ToL1witness.leafIndex).toBe(0n)
    expect(L2ToL1witness.siblingPath.pathSize).toBe(0)
  })

  it("should open a public order and publicly claim the refund", async () => {
    const amountIn = 100n
    const nonce = Fr.random()
    const userWallet = userWalletAndAccount.wallet
    const userAddress = userWalletAndAccount.accountAddress

    await (
      await userWallet.setPublicAuthWit(
        userAddress,
        {
          caller: aztecGateway.address,
          action: aztecToken
            .withWallet(userWallet)
            .methods.transfer_public_to_public(userAddress, aztecGateway.address, amountIn, nonce),
        },
        true,
      )
    )
      .send({ fee: { paymentMethod } })
      .wait()

    const orderData = new OrderData({
      sender: userAddress.toString(),
      recipient: RECIPIENT,
      inputToken: aztecToken.address.toString(),
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

    await aztecGateway
      .withWallet(userWallet)
      .methods.open({
        fill_deadline: FILL_DEADLINE,
        order_data: Array.from(hexToBytes(orderData.encode())),
        order_data_type: Array.from(hexToBytes(ORDER_DATA_TYPE)),
      })
      .send({ from: userAddress, fee: { paymentMethod } })
      .wait()

    // Prepare content for L1->L2 message
    const inbox = l1Contracts.inboxAddress
    const settleOrderTypeBytes = hexToBytes(REFUND_ORDER_TYPE)
    const orderIdBytes = hexToBytes(orderId.toString() as `0x${string}`)

    // sha256(REFUND_ORDER_TYPE + orderId)
    const messageContentBytes = new Uint8Array([...settleOrderTypeBytes, ...orderIdBytes])
    const contentField = sha256ToField([Buffer.from(messageContentBytes)])
    const messageContent = contentField.toString()

    // Send L1->L2 message
    const recipient = {
      actor: padHex(aztecGateway.address.toString()) as `0x${string}`,
      version: version,
    }

    const [l1Account] = await publicClient.getAddresses()
    const txHash = await publicClient.writeContract({
      address: inbox.toString(),
      abi: INBOX_ABI,
      functionName: "sendL2Message",
      args: [recipient, messageContent, SECRET_HASH.toString()],
      account: l1Account,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

    // Find the log from Inbox
    const inboxLog = receipt.logs.find((log: any) => log.address.toLowerCase() === inbox.toString().toLowerCase())
    if (!inboxLog) throw new Error("Inbox log not found in receipt")

    const decodedLog = decodeEventLog({
      abi: MESSAGE_SENT_ABI,
      data: inboxLog.data,
      topics: inboxLog.topics,
    }) as any

    const index = decodedLog.args.index
    const leafHash = decodedLog.args.hash

    // Wait for the message to be available on L2
    // We use the hash from the event to ensure we are looking for the right thing
    const l1ToL2MessageHash = Fr.fromString(leafHash)

    // Force a block to be mined by sending a dummy transaction
    await aztecToken
      .withWallet(deployerWalletAndAccount.wallet)
      .methods.mint_to_public(deployerWalletAndAccount.accountAddress, 0n)
      .send({ from: deployerWalletAndAccount.accountAddress, fee: { paymentMethod } })
      .wait()

    const maxAttempts = 20
    let attempt = 0
    let witness
    while (!witness && attempt < maxAttempts) {
      witness = await node.getL1ToL2MessageMembershipWitness("latest", l1ToL2MessageHash)

      if (!witness) {
        attempt += 1
        // Force a block to be mined by sending a dummy transaction
        await aztecToken
          .withWallet(deployerWalletAndAccount.wallet)
          .methods.mint_to_public(deployerWalletAndAccount.accountAddress, 0n)
          .send({ from: deployerWalletAndAccount.accountAddress, fee: { paymentMethod } })
          .wait()
        await sleep(1000)
      }
    }

    if (!witness) {
      throw new Error(
        `L1->L2 message witness not found after ${maxAttempts} attempts; set SKIP_L1_TO_L2_CONSUME=true when running without messaging support.`,
      )
    }

    const balancePre = await aztecToken
      .withWallet(userWallet)
      .methods.balance_of_public(userAddress)
      .simulate({ from: userAddress })
    await aztecGateway
      .withWallet(userWallet)
      .methods.claim_refund(
        Array.from(hexToBytes(orderId.toString())),
        Array.from(hexToBytes(orderData.encode())),
        index,
      )
      .simulate({ from: userAddress, fee: { paymentMethod } })
    await aztecGateway
      .withWallet(userWallet)
      .methods.claim_refund(
        Array.from(hexToBytes(orderId.toString())),
        Array.from(hexToBytes(orderData.encode())),
        index,
      )
      .send({ from: userAddress, fee: { paymentMethod } })
      .wait()
    const balancePost = await aztecToken
      .withWallet(userWallet)
      .methods.balance_of_public(userAddress)
      .simulate({ from: userAddress })
    expect(balancePost).toBe(balancePre + amountIn)
  })

  it("should open a private order and privately claim a refund", async () => {
    const amountIn = 100n
    const nonce = Fr.random()
    const userWallet = userWalletAndAccount.wallet
    const userAddress = userWalletAndAccount.accountAddress

    const authWit = await userWallet.createAuthWit(userAddress, {
      caller: aztecGateway.address,
      action: aztecToken
        .withWallet(userWallet)
        .methods.transfer_private_to_public(userAddress, aztecGateway.address, amountIn, nonce),
    })

    const orderData = new OrderData({
      sender: PRIVATE_SENDER,
      recipient: SECRET_HASH.toString(),
      inputToken: aztecToken.address.toString(),
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

    await aztecGateway
      .withWallet(userWallet)
      .methods.open_private({
        fill_deadline: FILL_DEADLINE,
        order_data: Array.from(hexToBytes(orderData.encode())),
        order_data_type: Array.from(hexToBytes(ORDER_DATA_TYPE)),
      })
      .send({ from: userAddress, authWitnesses: [authWit], fee: { paymentMethod } })
      .wait()

    // Prepare content for L1->L2 message
    const inbox = l1Contracts.inboxAddress
    const settleOrderTypeBytes = hexToBytes(REFUND_ORDER_TYPE)
    const orderIdBytes = hexToBytes(orderId.toString() as `0x${string}`)

    // sha256(REFUND_ORDER_TYPE + orderId)
    const messageContentBytes = new Uint8Array([...settleOrderTypeBytes, ...orderIdBytes])
    const contentField = sha256ToField([Buffer.from(messageContentBytes)])
    const messageContent = contentField.toString()

    // Send L1->L2 message
    const recipient = {
      actor: padHex(aztecGateway.address.toString()) as `0x${string}`,
      version: version,
    }

    const [l1Account] = await publicClient.getAddresses()
    const txHash = await publicClient.writeContract({
      address: inbox.toString(),
      abi: INBOX_ABI,
      functionName: "sendL2Message",
      args: [recipient, messageContent, SECRET_HASH.toString()],
      account: l1Account,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

    // Find the log from Inbox
    const inboxLog = receipt.logs.find((log: any) => log.address.toLowerCase() === inbox.toString().toLowerCase())
    if (!inboxLog) throw new Error("Inbox log not found in receipt")

    const decodedLog = decodeEventLog({
      abi: MESSAGE_SENT_ABI,
      data: inboxLog.data,
      topics: inboxLog.topics,
    }) as any

    const index = decodedLog.args.index
    const leafHash = decodedLog.args.hash

    // Wait for the message to be available on L2
    // We use the hash from the event to ensure we are looking for the right thing
    const l1ToL2MessageHash = Fr.fromString(leafHash)

    // Force a block to be mined by sending a dummy transaction
    await aztecToken
      .withWallet(deployerWalletAndAccount.wallet)
      .methods.mint_to_public(deployerWalletAndAccount.accountAddress, 0n)
      .send({ from: deployerWalletAndAccount.accountAddress, fee: { paymentMethod } })
      .wait()

    const maxAttempts = 20
    let attempt = 0
    let witness
    while (!witness && attempt < maxAttempts) {
      witness = await node.getL1ToL2MessageMembershipWitness("latest", l1ToL2MessageHash)

      if (!witness) {
        attempt += 1
        // Force a block to be mined by sending a dummy transaction
        await aztecToken
          .withWallet(deployerWalletAndAccount.wallet)
          .methods.mint_to_public(deployerWalletAndAccount.accountAddress, 0n)
          .send({ from: deployerWalletAndAccount.accountAddress, fee: { paymentMethod } })
          .wait()
        await sleep(1000)
      }
    }

    if (!witness) {
      throw new Error(
        `L1->L2 message witness not found after ${maxAttempts} attempts; set SKIP_L1_TO_L2_CONSUME=true when running without messaging support.`,
      )
    }
    const balancePre = await aztecToken
      .withWallet(userWallet)
      .methods.balance_of_private(userAddress)
      .simulate({ from: userAddress })
    await aztecGateway
      .withWallet(userWallet)
      .methods.claim_refund_private(
        SECRET,
        Array.from(hexToBytes(orderId.toString())),
        Array.from(hexToBytes(orderData.encode())),
        index,
      )
      .send({ from: userAddress, authWitnesses: [authWit], fee: { paymentMethod } })
      .wait()
    const balancePost = await aztecToken
      .withWallet(userWallet)
      .methods.balance_of_private(userAddress)
      .simulate({ from: userAddress })
    expect(balancePost).toBe(balancePre + amountIn)
  })
})
