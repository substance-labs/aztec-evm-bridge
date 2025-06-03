import { Fr, PXE, EthAddress, SponsoredFeePaymentMethod, Contract } from "@aztec/aztec.js"
import { spawn } from "child_process"
import { createEthereumChain, createExtendedL1Client, RollupContract } from "@aztec/ethereum"
import { hexToBytes, padHex } from "viem"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { TokenContractArtifact } from "@aztec/noir-contracts.js/Token"

import { AztecGateway7683Contract, AztecGateway7683ContractArtifact } from "../artifacts/AztecGateway7683.js"
import { getRandomWallet, getPXEs } from "./utils.js"
import { getSponsoredFPCInstance } from "./fpc.js"
import { OrderData } from "./OrderData.js"
import { ProxyContract, ProxyContractArtifact } from "../artifacts/Proxy.js"

import { vKey, proof, publicInputs, vKeyHash } from "./zkpassport-data.js"

const MNEMONIC = "test test test test test test test test test test test junk"
const PORTAL_ADDRESS = EthAddress.ZERO
const ORDER_DATA_TYPE = "0xf00c3bf60c73eb97097f1c9835537da014e0b755fe94b25d7ac8401df66716a0"
const AZTEC_7683_DOMAIN = 999999
const PUBLIC_ORDER_WITH_HOOK = 2
const VAULT = EthAddress.ZERO.toString()
const L2_EVM_TOKEN = "0x3333333333333333333333333333333333333333333333333333333333333333"
const AMOUNT_OUT_ZERO = 0n
const L2_DOMAIN = 11155420
const FILL_DEADLINE = 2 ** 32 - 1
const DESTINATION_SETTLER_EVM_L2 = EthAddress.ZERO

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
  const deployer = await getRandomWallet({ paymentMethod, pxe: pxe2 })

  await user.registerSender(deployer.getAddress())
  await filler.registerSender(deployer.getAddress())

  const gateway = await AztecGateway7683Contract.deploy(deployer, DESTINATION_SETTLER_EVM_L2, L2_DOMAIN, PORTAL_ADDRESS)
    .send({
      contractAddressSalt: Fr.random(),
      universalDeploy: false,
      skipClassRegistration: false,
      skipPublicDeployment: false,
      skipInitialization: false,
      fee: { paymentMethod },
    })
    .deployed()

  const proxy = await ProxyContract.deploy(deployer, gateway.address, EthAddress.fromString(VAULT))
    .send({
      contractAddressSalt: Fr.random(),
      universalDeploy: false,
      skipClassRegistration: false,
      skipPublicDeployment: false,
      skipInitialization: false,
      fee: { paymentMethod },
    })
    .deployed()

  await user.registerSender(gateway.address)
  await filler.registerSender(gateway.address)
  await deployer.registerSender(gateway.address)
  await user.registerSender(proxy.address)
  await filler.registerSender(proxy.address)
  await deployer.registerSender(proxy.address)

  const token = await Contract.deploy(deployer, TokenContractArtifact, [deployer.getAddress(), "TOKEN", "TKN", 18])
    .send({ fee: { paymentMethod } })
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
    await pxe.registerContract({
      instance: proxy.instance,
      artifact: ProxyContractArtifact,
    })
  }

  const amount = 1000n * 10n ** 18n
  await token
    .withWallet(deployer)
    .methods.mint_to_private(deployer.getAddress(), user.getAddress(), amount)
    .send({ fee: { paymentMethod } })
    .wait()
  await token
    .withWallet(deployer)
    .methods.mint_to_private(deployer.getAddress(), filler.getAddress(), amount)
    .send({ fee: { paymentMethod } })
    .wait()
  await token
    .withWallet(deployer)
    .methods.mint_to_public(user.getAddress(), amount)
    .send({ fee: { paymentMethod } })
    .wait()
  await token
    .withWallet(deployer)
    .methods.mint_to_public(filler.getAddress(), amount)
    .send({ fee: { paymentMethod } })
    .wait()

  return {
    wallets: [user, filler, deployer],
    gateway,
    token,
    paymentMethod,
    proxy,
  }
}

// NOTE: before running the tests comment all occurences of context.consume_l1_to_l2_message
describe("AztecGateway7683", () => {
  let pxes: PXE[]
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
    const { token, gateway, wallets, paymentMethod, proxy } = await setup(pxes)
    const [user, filler] = wallets

    const amountIn = 100n
    const nonce = new Fr(2)
    const witness = await user.createAuthWit({
      caller: proxy.address,
      action: token.withWallet(user).methods.transfer_to_public(user.getAddress(), proxy.address, amountIn, Fr.ONE),
    })

    const orderData = new OrderData({
      sender: proxy.address.toString(),
      recipient: padHex(VAULT),
      inputToken: token.address.toString(),
      outputToken: L2_EVM_TOKEN,
      amountIn,
      amountOut: AMOUNT_OUT_ZERO,
      senderNonce: nonce.toBigInt(),
      originDomain: AZTEC_7683_DOMAIN,
      destinationDomain: L2_DOMAIN,
      destinationSettler: padHex(DESTINATION_SETTLER_EVM_L2.toString()),
      fillDeadline: FILL_DEADLINE,
      orderType: PUBLIC_ORDER_WITH_HOOK,
      data: padHex("0x00"),
    })

    await proxy
      .withWallet(user)
      .methods.deposit(
        {
          fill_deadline: FILL_DEADLINE,
          order_data: Array.from(hexToBytes(orderData.encode())),
          order_data_type: Array.from(hexToBytes(ORDER_DATA_TYPE)),
        },
        vKey.map((field) => Fr.fromHexString(field)),
        proof.map((field) => Fr.fromHexString(field)),
        publicInputs.map((field) => Fr.fromHexString(field)),
        Fr.fromHexString(vKeyHash),
      )
      .with({
        authWitnesses: [witness],
      })
      .send({ fee: { paymentMethod } })
      .wait()
  })
})
