import { createPublicClient, createWalletClient, http, publicActions, walletActions } from "viem"
import { privateKeyToAccount } from "viem/accounts"

import type {
  Chain,
  // Client as Client_Base,
  // Transport,
  // EIP1474Methods,
  // WalletActions,
  // PublicActions,
  // Account,
  WalletClient,
  PublicClient,
} from "viem"

// export type Client = Client_Base<Transport, Chain, Account, EIP1474Methods, WalletActions & PublicActions>

type ContructorConfigs = {
  chains: Chain[]
  privateKey: `0x${string}`
  rpcUrls: { [chainName: string]: string }
}

class MultiClient {
  private walletClients: { [chainName: string]: WalletClient }
  private publicClients: { [chainName: string]: PublicClient }

  constructor({ chains, privateKey, rpcUrls }: ContructorConfigs) {
    this.walletClients = chains.reduce((acc: { [chainName: string]: any }, chain: Chain) => {
      const rpcUrl = rpcUrls[chain.id] as string
      acc[chain.id] = createWalletClient({
        key: rpcUrl,
        account: privateKeyToAccount(privateKey),
        chain,
        transport: http(rpcUrl),
      })
        .extend(publicActions)
        .extend(walletActions)
      return acc
    }, {})

    this.publicClients = chains.reduce((acc: { [chainName: string]: any }, chain: Chain) => {
      const rpcUrl = rpcUrls[chain.id] as string
      acc[chain.id] = createPublicClient({
        key: rpcUrl,
        chain,
        transport: http(rpcUrl),
      })
        .extend(publicActions)
        .extend(walletActions)
      return acc
    }, {})
  }

  getWalletClientByChain(chain: Chain): WalletClient {
    const client = this.walletClients[chain.id]
    if (!client) throw new Error("Client not found")
    return client
  }

  getPublicClientByChain(chain: Chain): PublicClient {
    const client = this.publicClients[chain.id]
    if (!client) throw new Error("Client not found")
    return client
  }

  getClientByChain(chain: Chain): { publicClient: PublicClient; walletClient: WalletClient } {
    const publicClient = this.getPublicClientByChain(chain)
    const walletClient = this.getWalletClientByChain(chain)
    return { publicClient, walletClient }
  }
}

export default MultiClient
