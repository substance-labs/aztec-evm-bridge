import type { ChangeEvent } from 'react'
import { useState, useEffect } from 'react'
import type { Hex } from 'viem'

// Storage key for rate limiting
const FAUCET_STORAGE_KEY = 'faucet_claims'

// Faucet configuration
const FAUCET_CONFIG = {
  // Maximum amount per claim (in wei)
  maxAmountPerClaim: BigInt('1000000000000000000'), // 1 token
  // Cooldown period in milliseconds (24 hours)
  cooldownMs: 24 * 60 * 60 * 1000,
  // Token addresses
  aztecTokenAddress: import.meta.env.VITE_AZTEC_TOKEN_ADDRESS || '0x0e334ca55bc06810c70f9cba8a341d79f3cbb29b8d55eb0f877fc3f463e507f1',
  evmTokenAddress: import.meta.env.VITE_EVM_TOKEN_ADDRESS || '0xF2D41ea5bD5b3A686a2aDB387EbF83913BDAA055',
  // RPC URLs
  aztecRpcUrl: import.meta.env.VITE_AZTEC_RPC_URL || 'https://next.devnet.aztec-labs.com',
  evmRpcUrl: import.meta.env.VITE_EVM_RPC_URL || 'https://base-sepolia.g.alchemy.com/v2/p9Kt1j_0O5cvXjx48tyA9',
  // Minter credentials from environment variables
  aztecMinterSecretKey: import.meta.env.VITE_AZTEC_MINTER_SECRET_KEY || '',
  aztecMinterSalt: import.meta.env.VITE_AZTEC_MINTER_SALT || '',
  evmFaucetPrivateKey: import.meta.env.VITE_EVM_FAUCET_PRIVATE_KEY || '',
}

interface ClaimRecord {
  aztecLastClaim?: number
  evmLastClaim?: number
}

interface FaucetClaims {
  [address: string]: ClaimRecord
}

function getClaimsFromStorage(): FaucetClaims {
  try {
    const stored = localStorage.getItem(FAUCET_STORAGE_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

function saveClaimsToStorage(claims: FaucetClaims): void {
  localStorage.setItem(FAUCET_STORAGE_KEY, JSON.stringify(claims))
}

function canClaim(address: string, chain: 'aztec' | 'evm'): { canClaim: boolean; timeRemaining?: number } {
  const claims = getClaimsFromStorage()
  const record = claims[address.toLowerCase()]
  
  if (!record) {
    return { canClaim: true }
  }

  const lastClaim = chain === 'aztec' ? record.aztecLastClaim : record.evmLastClaim
  if (!lastClaim) {
    return { canClaim: true }
  }

  const now = Date.now()
  const elapsed = now - lastClaim
  
  if (elapsed >= FAUCET_CONFIG.cooldownMs) {
    return { canClaim: true }
  }

  return { 
    canClaim: false, 
    timeRemaining: FAUCET_CONFIG.cooldownMs - elapsed 
  }
}

function recordClaim(address: string, chain: 'aztec' | 'evm'): void {
  const claims = getClaimsFromStorage()
  const normalizedAddress = address.toLowerCase()
  
  if (!claims[normalizedAddress]) {
    claims[normalizedAddress] = {}
  }

  if (chain === 'aztec') {
    claims[normalizedAddress].aztecLastClaim = Date.now()
  } else {
    claims[normalizedAddress].evmLastClaim = Date.now()
  }

  saveClaimsToStorage(claims)
}

function formatTimeRemaining(ms: number): string {
  const hours = Math.floor(ms / (60 * 60 * 1000))
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000))
  return `${hours}h ${minutes}m`
}

export function Faucet() {
  const [recipientAddress, setRecipientAddress] = useState('')
  const [amount, setAmount] = useState('1000000000000000000') // 1 token default
  const [selectedChain, setSelectedChain] = useState<'aztec' | 'evm'>('aztec')
  const [status, setStatus] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)

  // Claim eligibility state
  const [claimStatus, setClaimStatus] = useState<{ canClaim: boolean; timeRemaining?: number }>({ canClaim: true })

  // Check claim eligibility when address or chain changes
  useEffect(() => {
    if (recipientAddress) {
      setClaimStatus(canClaim(recipientAddress, selectedChain))
    } else {
      setClaimStatus({ canClaim: true })
    }
  }, [recipientAddress, selectedChain])

  const handleMintAztec = async () => {
    setError(null)
    setStatus('Initializing Aztec minting...')
    setIsLoading(true)
    setTxHash(null)

    try {
      if (!recipientAddress) {
        throw new Error('Recipient address is required')
      }
      if (!FAUCET_CONFIG.aztecMinterSecretKey || !FAUCET_CONFIG.aztecMinterSalt) {
        throw new Error('Aztec minter credentials are not configured. Please set VITE_AZTEC_MINTER_SECRET_KEY and VITE_AZTEC_MINTER_SALT in .env')
      }

      // Check rate limit
      const eligibility = canClaim(recipientAddress, 'aztec')
      if (!eligibility.canClaim) {
        throw new Error(`Rate limited. Please wait ${formatTimeRemaining(eligibility.timeRemaining!)} before claiming again.`)
      }

      // Validate amount
      const requestedAmount = BigInt(amount)
      if (requestedAmount > FAUCET_CONFIG.maxAmountPerClaim) {
        throw new Error(`Maximum amount per claim is ${FAUCET_CONFIG.maxAmountPerClaim.toString()} wei`)
      }

      setStatus('Loading Aztec modules...')
      
      const { Fr } = await import('@aztec/aztec.js/fields')
      const { AztecAddress } = await import('@aztec/aztec.js/addresses')
      const { createAztecNodeClient } = await import('@aztec/aztec.js/node')
      const { TestWallet } = await import('@aztec/test-wallet/client/lazy')
      const { SponsoredFeePaymentMethod } = await import('@aztec/aztec.js/fee')
      const { TokenContract } = await import('@defi-wonderland/aztec-standards/artifacts/Token.js')

      setStatus('Connecting to Aztec network...')
      const aztecNode = createAztecNodeClient(FAUCET_CONFIG.aztecRpcUrl)
      
      setStatus('Creating minter wallet...')
      const testWallet = await TestWallet.create(aztecNode, {
        l1Contracts: await aztecNode.getL1ContractAddresses(),
        proverEnabled: false,
      })

      const secretKey = Fr.fromHexString(FAUCET_CONFIG.aztecMinterSecretKey as Hex)
      const salt = Fr.fromHexString(FAUCET_CONFIG.aztecMinterSalt as Hex)
      const minterAccount = await testWallet.createSchnorrAccount(secretKey, salt)

      // Setup sponsored fee payment
      const fpcAddress = AztecAddress.fromString('0x0c0b78c19dc07e4779c3e7109be3a84c89a612c96fde85e53f6d66f3fb42fd75')
      const paymentMethod = new SponsoredFeePaymentMethod(fpcAddress)

      setStatus('Loading token contract...')
      const token = await TokenContract.at(
        AztecAddress.fromString(FAUCET_CONFIG.aztecTokenAddress),
        testWallet
      )

      setStatus(`Minting ${amount} tokens to ${recipientAddress.slice(0, 10)}...`)
      const recipientAztecAddress = AztecAddress.fromString(recipientAddress as Hex)
      
      const minterAddress = await minterAccount.getCompleteAddress()
      const txReceipt = await token.methods
        .mint_to_public(recipientAztecAddress, requestedAmount)
        .send({
          from: minterAddress.address,
          fee: { paymentMethod },
        })
        .wait({ timeout: 120000 })

      // Record the claim
      recordClaim(recipientAddress, 'aztec')
      
      setTxHash(txReceipt.txHash.toString())
      setStatus(`✅ Successfully minted ${amount} tokens to ${recipientAddress.slice(0, 10)}...`)
      setClaimStatus(canClaim(recipientAddress, 'aztec'))
    } catch (err) {
      setError((err as Error).message)
      setStatus('Minting failed')
      console.error('Aztec faucet error:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleMintEvm = async () => {
    setError(null)
    setStatus('Initializing EVM transfer...')
    setIsLoading(true)
    setTxHash(null)

    try {
      if (!recipientAddress) {
        throw new Error('Recipient address is required')
      }
      if (!FAUCET_CONFIG.evmFaucetPrivateKey) {
        throw new Error('EVM faucet private key is not configured. Please set VITE_EVM_FAUCET_PRIVATE_KEY in .env')
      }

      // Check rate limit
      const eligibility = canClaim(recipientAddress, 'evm')
      if (!eligibility.canClaim) {
        throw new Error(`Rate limited. Please wait ${formatTimeRemaining(eligibility.timeRemaining!)} before claiming again.`)
      }

      // Validate amount
      const requestedAmount = BigInt(amount)
      if (requestedAmount > FAUCET_CONFIG.maxAmountPerClaim) {
        throw new Error(`Maximum amount per claim is ${FAUCET_CONFIG.maxAmountPerClaim.toString()} wei`)
      }

      setStatus('Loading viem modules...')
      
      const { createPublicClient, createWalletClient, http, parseAbi } = await import('viem')
      const { baseSepolia } = await import('viem/chains')
      const { privateKeyToAccount } = await import('viem/accounts')

      setStatus('Connecting to Base Sepolia...')
      
      const account = privateKeyToAccount(FAUCET_CONFIG.evmFaucetPrivateKey as Hex)
      
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(FAUCET_CONFIG.evmRpcUrl),
      })

      const walletClient = createWalletClient({
        account,
        chain: baseSepolia,
        transport: http(FAUCET_CONFIG.evmRpcUrl),
      })

      // ERC20 transfer ABI
      const erc20Abi = parseAbi([
        'function transfer(address to, uint256 amount) returns (bool)',
        'function balanceOf(address account) view returns (uint256)',
      ])

      setStatus('Checking faucet balance...')
      const faucetBalance = await publicClient.readContract({
        address: FAUCET_CONFIG.evmTokenAddress as Hex,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account.address],
      })

      if (faucetBalance < requestedAmount) {
        throw new Error(`Faucet has insufficient balance. Available: ${faucetBalance.toString()} wei`)
      }

      setStatus(`Transferring ${amount} tokens to ${recipientAddress.slice(0, 10)}...`)
      
      const hash = await walletClient.writeContract({
        address: FAUCET_CONFIG.evmTokenAddress as Hex,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [recipientAddress as Hex, requestedAmount],
      })

      setStatus('Waiting for confirmation...')
      await publicClient.waitForTransactionReceipt({ hash })

      // Record the claim
      recordClaim(recipientAddress, 'evm')
      
      setTxHash(hash)
      setStatus(`✅ Successfully transferred ${amount} tokens to ${recipientAddress.slice(0, 10)}...`)
      setClaimStatus(canClaim(recipientAddress, 'evm'))
    } catch (err) {
      setError((err as Error).message)
      setStatus('Transfer failed')
      console.error('EVM faucet error:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleClaim = () => {
    if (selectedChain === 'aztec') {
      handleMintAztec()
    } else {
      handleMintEvm()
    }
  }

  return (
    <>
      {status && <div className="alert info">{status}</div>}
      {error && <div className="alert error">{error}</div>}

      <section className="order-form">
        <h2>Select Chain</h2>
        <div className="mode-switcher">
          <button
            type="button"
            className={selectedChain === 'aztec' ? 'active' : ''}
            onClick={() => setSelectedChain('aztec')}
          >
            🔮 Aztec Devnet
          </button>
          <button
            type="button"
            className={selectedChain === 'evm' ? 'active' : ''}
            onClick={() => setSelectedChain('evm')}
          >
            ⟠ Base Sepolia
          </button>
        </div>
      </section>

      <section className="order-form">
        <h2>Recipient Details</h2>
        <div className="field-grid">
          <label>
            <span>Recipient Address</span>
            <input
              value={recipientAddress}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setRecipientAddress(e.target.value)}
              placeholder={selectedChain === 'aztec' ? '0x... (Aztec address)' : '0x... (EVM address)'}
            />
          </label>
          <label>
            <span>Amount (wei)</span>
            <input
              value={amount}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
              placeholder="1000000000000000000"
            />
          </label>
        </div>

        {!claimStatus.canClaim && recipientAddress && (
          <div className="alert error" style={{ marginTop: '1rem' }}>
            ⏰ This address must wait {formatTimeRemaining(claimStatus.timeRemaining!)} before claiming {selectedChain === 'aztec' ? 'Aztec' : 'Base Sepolia'} tokens again.
          </div>
        )}

        <div className="faucet-info" style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '0.5rem' }}>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#9da8ff' }}>
            <strong>ℹ️ Faucet Limits:</strong><br />
            • Max {(Number(FAUCET_CONFIG.maxAmountPerClaim) / 1e18).toFixed(0)} token per claim<br />
            • One claim per chain per 24 hours per address<br />
            • You can claim from both Aztec and Base Sepolia in the same day
          </p>
        </div>

        <div className="order-actions" style={{ marginTop: '1rem' }}>
          <button
            type="button"
            onClick={handleClaim}
            className="primary"
            disabled={isLoading || !claimStatus.canClaim || !recipientAddress}
          >
            {isLoading ? 'Processing...' : `Claim ${selectedChain === 'aztec' ? 'Aztec' : 'Base Sepolia'} Tokens`}
          </button>
        </div>
      </section>

      {txHash && (
        <section className="results">
          <h2>Transaction Result</h2>
          <div style={{ wordBreak: 'break-all' }}>
            <strong>Transaction Hash:</strong><br />
            <code>{txHash}</code>
          </div>
        </section>
      )}

      <section className="order-form">
        <h2>Token Addresses</h2>
        <div style={{ fontSize: '0.85rem', color: '#b7bed7' }}>
          <p><strong>Aztec Token:</strong> <code style={{ fontSize: '0.8rem' }}>{FAUCET_CONFIG.aztecTokenAddress}</code></p>
          <p><strong>Base Sepolia Token:</strong> <code style={{ fontSize: '0.8rem' }}>{FAUCET_CONFIG.evmTokenAddress}</code></p>
        </div>
      </section>
    </>
  )
}

export default Faucet
