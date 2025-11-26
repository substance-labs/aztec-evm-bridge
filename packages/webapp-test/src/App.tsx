import type { ChangeEvent } from 'react'
import { useMemo, useState } from 'react'
import type { Hex } from 'viem'

import { Bridge, OrderDataEncoder, type Order, type OrderData } from '@substancelabs/aztec-evm-bridge-sdk'

import './App.css'

type Tab = 'encode' | 'open'

type OrderFormState = {
  sender: string
  recipient: string
  inputToken: string
  outputToken: string
  destinationSettler: string
  data: string
  amountIn: string
  amountOut: string
  senderNonce: string
  originDomain: string
  destinationDomain: string
  fillDeadline: string
  orderType: string
}

const toHex = (value: string): Hex => {
  const normalized = value.trim().replace(/^0x/, '')
  return (`0x${normalized.padStart(64, '0')}`) as Hex
}

const DEFAULT_FORM: OrderFormState = {
  sender: '0x1111',
  recipient: '0x2222',
  inputToken: '0xaaaaaaaa',
  outputToken: '0xbbbbbbbb',
  destinationSettler: '0xcccccccc',
  data: '0x01',
  amountIn: '1000000000000000000',
  amountOut: '250000000000000000',
  senderNonce: '1',
  originDomain: '8453',
  destinationDomain: '11155111',
  fillDeadline: (Math.floor(Date.now() / 1000) + 3600).toString(),
  orderType: '1',
}

const buildOrderData = (form: OrderFormState): OrderData => ({
  sender: toHex(form.sender),
  recipient: toHex(form.recipient),
  inputToken: toHex(form.inputToken),
  outputToken: toHex(form.outputToken),
  destinationSettler: toHex(form.destinationSettler),
  data: toHex(form.data),
  amountIn: BigInt(form.amountIn || '0'),
  amountOut: BigInt(form.amountOut || '0'),
  senderNonce: BigInt(form.senderNonce || '0'),
  originDomain: Number(form.originDomain || 0),
  destinationDomain: Number(form.destinationDomain || 0),
  fillDeadline: Number(form.fillDeadline || 0),
  orderType: Number(form.orderType || 0),
})

const FIELD_GROUPS: Array<{ title: string; fields: Array<{ name: keyof OrderFormState; label: string; type?: string }> }> = [
  {
    title: 'Addresses & Identifiers (bytes32)',
    fields: [
      { name: 'sender', label: 'Sender' },
      { name: 'recipient', label: 'Recipient' },
      { name: 'inputToken', label: 'Input token' },
      { name: 'outputToken', label: 'Output token' },
      { name: 'destinationSettler', label: 'Destination settler' },
      { name: 'data', label: 'Data payload' },
    ],
  },
  {
    title: 'Amounts & Domains',
    fields: [
      { name: 'amountIn', label: 'Amount in (wei)', type: 'text' },
      { name: 'amountOut', label: 'Amount out (wei)', type: 'text' },
      { name: 'senderNonce', label: 'Sender nonce', type: 'number' },
      { name: 'originDomain', label: 'Origin domain', type: 'number' },
      { name: 'destinationDomain', label: 'Destination domain', type: 'number' },
      { name: 'fillDeadline', label: 'Fill deadline (unix)', type: 'number' },
      { name: 'orderType', label: 'Order type (uint8)', type: 'number' },
    ],
  },
]

function App() {
  const [tab, setTab] = useState<Tab>('encode')
  const [form, setForm] = useState<OrderFormState>(DEFAULT_FORM)
  const [encoded, setEncoded] = useState<string>('')
  const [decoded, setDecoded] = useState<OrderData | null>(null)
  const [status, setStatus] = useState<string>('Ready to encode')
  const [error, setError] = useState<string | null>(null)

  // Order opening state
  const [orderForm, setOrderForm] = useState({
    // Bridge direction
    direction: 'aztecToEvm' as 'aztecToEvm' | 'evmToAztec',
    chainIdIn: '999999', // Aztec
    chainIdOut: '84532', // Base Sepolia
    tokenIn: '0x089d76aaa3261376f2073894cddff9a070c1ca2c3ae2a2b25fcce25d68caae81',
    tokenOut: '0xAf31a5CFf95131B2E0D3fa89125342984567f399',
    amountIn: '1000',
    amountOut: '1000',
    recipient: '0x2083573BE32F514a8a81d7E9781bA95156b7CB70',
    mode: 'public' as const,
    data: '0x0000000000000000000000000000000000000000000000000000000000000000',
    
    // Bridge initialization mode
    bridgeInitMode: 'secretKey' as 'secretKey' | 'pxe' | 'azguard',
    
    // Secret key mode
    evmPrivateKey: '',
    aztecSecretKey: '0x272df8703f3901a55a5baa9d24c21e03134c83fc99c05a971e4fa51565aff309',
    aztecKeySalt: '0x0badf64f28b28e496813040295c611daeea552fc271de1e8e92baca5f32c68be',
    aztecNodeUrl: 'https://devnet.aztec-labs.com',
    aztecPxeStoreDirectory: 'webapp-pxe',
    
    // PXE mode
    pxeUrl: 'https://devnet.aztec-labs.com',
    
    // Azguard mode
    azguardConnected: false,
  })
  const [orderStatus, setOrderStatus] = useState<string>('')
  const [orderResult, setOrderResult] = useState<any>(null)
  const [orderLogs, setOrderLogs] = useState<Array<{ timestamp: string; message: string }>>([])

  const addOrderLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setOrderLogs(prev => [...prev, { timestamp, message }])
    setOrderStatus(message)
  }

  const orderData = useMemo(() => buildOrderData(form), [form])

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleEncode = () => {
    try {
      const encoder = new OrderDataEncoder(orderData)
      const orderHex = encoder.encode()
      setEncoded(orderHex)
      setDecoded(null)
      setStatus('Order encoded successfully. Feel free to tweak the fields or decode again.')
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleDecode = () => {
    if (!encoded) {
      setError('Provide an encoded order payload before decoding.')
      return
    }
    try {
      const order = OrderDataEncoder.decode(encoded as Hex)
      setDecoded(order)
      setStatus('Decoded order data. See the JSON preview below.')
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleOrderFormChange = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = event.target
    
    // Update chain IDs and token addresses automatically when direction changes
    if (name === 'direction') {
      if (value === 'aztecToEvm') {
        setOrderForm((prev) => ({
          ...prev,
          direction: 'aztecToEvm',
          chainIdIn: '999999',  // Aztec
          chainIdOut: '84532',   // Base Sepolia
          tokenIn: '0x089d76aaa3261376f2073894cddff9a070c1ca2c3ae2a2b25fcce25d68caae81',  // Aztec token
          tokenOut: '0xAf31a5CFf95131B2E0D3fa89125342984567f399',  // Base Sepolia token
        }))
      } else if (value === 'evmToAztec') {
        setOrderForm((prev) => ({
          ...prev,
          direction: 'evmToAztec',
          chainIdIn: '84532',    // Base Sepolia
          chainIdOut: '999999',  // Aztec
          tokenIn: '0xAf31a5CFf95131B2E0D3fa89125342984567f399',   // Base Sepolia token
          tokenOut: '0x089d76aaa3261376f2073894cddff9a070c1ca2c3ae2a2b25fcce25d68caae81', // Aztec token
        }))
      }
    } else {
      setOrderForm((prev) => ({ ...prev, [name]: value }))
    }
  }

  const handleOpenOrder = async () => {
    setError(null)
    setOrderLogs([])
    addOrderLog('Initializing bridge...')
    setOrderResult(null)

    try {
      if (!orderForm.tokenIn || !orderForm.tokenOut) {
        throw new Error('Token addresses are required')
      }
      if (!orderForm.recipient) {
        throw new Error('Recipient address is required')
      }

      const isEvmToAztec = Number(orderForm.chainIdOut) === 11155111 // Aztec Sepolia
      const isAztecToEvm = Number(orderForm.chainIdIn) === 11155111 // Aztec Sepolia
      
      // Validate required credentials based on order direction
      if (isAztecToEvm) {
        if (!orderForm.aztecSecretKey || !orderForm.aztecKeySalt) {
          throw new Error('Aztec secret key and salt are required for Aztec→EVM orders')
        }
        if (!orderForm.aztecNodeUrl) {
          throw new Error('Aztec node URL is required for Aztec→EVM orders')
        }
      }
      
      if (isEvmToAztec && !orderForm.evmPrivateKey) {
        throw new Error('EVM private key is required for EVM→Aztec orders')
      }

      // Build Bridge config based on initialization mode
      const bridgeConfig: any = {}
      
      if (orderForm.bridgeInitMode === 'secretKey') {
        // Mode 1: Initialize with secret key and salt (SDK creates PXE internally)
        if (orderForm.evmPrivateKey) {
          bridgeConfig.evmPrivateKey = orderForm.evmPrivateKey as Hex
        }
        
        if (orderForm.aztecSecretKey && orderForm.aztecKeySalt) {
          bridgeConfig.aztecSecretKey = orderForm.aztecSecretKey as Hex
          bridgeConfig.aztecKeySalt = orderForm.aztecKeySalt as Hex
          bridgeConfig.aztecNodeUrl = orderForm.aztecNodeUrl
          bridgeConfig.aztecPxeStoreDirectory = orderForm.aztecPxeStoreDirectory || 'webapp-pxe'
          addOrderLog('🔑 Mode: Secret Key + Salt (SDK creates PXE internally)')
        }
      } else if (orderForm.bridgeInitMode === 'pxe') {
        // Mode 2: Create a standalone Wallet and pass to Bridge
        addOrderLog('🔌 Mode: Creating standalone Wallet...')
        
        if (!orderForm.aztecNodeUrl) {
          throw new Error('Aztec node URL is required')
        }
        
        // Import necessary Aztec modules
        const { createAztecNodeClient } = await import('@aztec/aztec.js/node')
        const { getPXEConfig } = await import('@aztec/pxe/config')
        const { createPXE } = await import('@aztec/pxe/client/lazy')
        const { Fr } = await import('@aztec/foundation/fields')
        const { getContractInstanceFromInstantiationParams } = await import('@aztec/aztec.js/contracts')
        const { SponsoredFPCContractArtifact } = await import('@aztec/noir-contracts.js/SponsoredFPC')
        const { SPONSORED_FPC_SALT } = await import('@aztec/constants')
        const { deriveSigningKey } = await import('@aztec/stdlib/keys')
        
        addOrderLog('Creating Aztec node client...')
        const aztecNode = createAztecNodeClient(orderForm.aztecNodeUrl)
        
        addOrderLog('Initializing PXE...')
        const config = getPXEConfig()
        config.l1Contracts = await aztecNode.getL1ContractAddresses()
        config.proverEnabled = false
        
        const pxe = await createPXE(aztecNode, config, { useLogSuffix: true })
        
        addOrderLog('Registering Sponsored FPC contract...')
        const sponsoredFPCInstance = await getContractInstanceFromInstantiationParams(
          SponsoredFPCContractArtifact,
          { salt: new Fr(SPONSORED_FPC_SALT) }
        )
        await pxe.registerContract({
          instance: sponsoredFPCInstance,
          artifact: SponsoredFPCContractArtifact,
        })
        
        addOrderLog('Creating and registering Schnorr account...')
        if (!orderForm.aztecSecretKey || !orderForm.aztecKeySalt) {
          throw new Error('Secret key and salt are required for Wallet mode')
        }
        
        const secret = Fr.fromString(orderForm.aztecSecretKey)
        const salt = Fr.fromString(orderForm.aztecKeySalt)
        const signingKey = deriveSigningKey(secret)
        
        // Use SDKAztecWallet to properly register the account
        const { SDKAztecWallet } = await import('@substancelabs/aztec-evm-bridge-sdk')
        const sdkWallet = await SDKAztecWallet.fromPXE(orderForm.aztecNodeUrl, pxe)
        const accountManager = await sdkWallet.createSchnorrAccount(secret, salt, signingKey)
        
        addOrderLog(`✓ Account registered: ${accountManager.address.toString().slice(0, 16)}...`)
        addOrderLog('✓ Wallet fully configured and ready')
        
        // Pass the wallet (which extends BaseWallet) to Bridge
        bridgeConfig.aztecWallet = sdkWallet
        
        // Bridge still needs credentials to retrieve/use accounts
        if (orderForm.aztecSecretKey && orderForm.aztecKeySalt) {
          bridgeConfig.aztecSecretKey = orderForm.aztecSecretKey as Hex
          bridgeConfig.aztecKeySalt = orderForm.aztecKeySalt as Hex
        }
        
        if (orderForm.evmPrivateKey) {
          bridgeConfig.evmPrivateKey = orderForm.evmPrivateKey as Hex
        }
      } else if (orderForm.bridgeInitMode === 'azguard') {
        // Mode 3: Initialize with Azguard wallet
        addOrderLog('👛 Mode: Azguard Wallet')
        if (!orderForm.azguardConnected) {
          throw new Error(
            'Azguard wallet not connected. ' +
            'Install @azguardwallet/client and connect your Azguard wallet first. ' +
            'Then pass the AzguardClient instance as bridgeConfig.azguardClient.'
          )
        }
        // In a real implementation, you would get the azguardClient from the wallet connection
        // bridgeConfig.azguardClient = azguardClientInstance
        throw new Error('Azguard integration requires @azguardwallet/client package and wallet connection.')
      }

      const bridge = new Bridge(bridgeConfig)

      const order: Order = {
        chainIdIn: Number(orderForm.chainIdIn),
        chainIdOut: Number(orderForm.chainIdOut),
        tokenIn: orderForm.tokenIn as Hex,
        tokenOut: orderForm.tokenOut as Hex,
        amountIn: BigInt(orderForm.amountIn),
        amountOut: BigInt(orderForm.amountOut),
        recipient: orderForm.recipient as Hex,
        mode: orderForm.mode,
        data: orderForm.data as Hex,
      }

      addOrderLog('Opening order...')

      const result = await bridge.openOrder(order, {
        onSecret: ({ orderId, secret }) => {
          addOrderLog(`✓ Secret generated for order ${orderId.slice(0, 10)}...`)
          console.log('Order ID:', orderId)
          console.log('Secret:', secret)
        },
        onOrderOpened: ({ orderId, transactionHash, resolvedOrder }) => {
          addOrderLog(`✓ Order opened! TX: ${transactionHash.slice(0, 10)}...`)
          addOrderLog('⏳ Waiting for order to be filled...')
          console.log('Full Transaction Hash:', transactionHash)
          console.log('Order ID:', orderId)
          console.log('Resolved Order:', resolvedOrder)
        },
        onOrderFilled: ({ orderId, transactionHash }) => {
          addOrderLog(`✓ Order filled! ID: ${orderId.slice(0, 10)}...`)
          if (transactionHash) {
            addOrderLog(`✓ Fill TX: ${transactionHash.slice(0, 10)}...`)
          }
          addOrderLog('⏳ Claiming order...')
        },
        onOrderClaimed: ({ transactionHash }) => {
          addOrderLog(`✓ Order claimed! TX: ${transactionHash.slice(0, 10)}...`)
          console.log('Claim TX:', transactionHash)
        },
      })

      setOrderResult(result)
      addOrderLog('✅ Order completed successfully!')
    } catch (err) {
      setError((err as Error).message)
      addOrderLog('❌ Order failed')
      console.error('Order error:', err)
    }
  }

  return (
    <div className="app">
      <header>
        <div>
          <p className="eyebrow">Aztec EVM Bridge SDK playground</p>
          <h1>Test SDK functionality</h1>
          <p>
            This lightweight Vite 7 app imports the{' '}
            <code>@substancelabs/aztec-evm-bridge-sdk</code> package to test encoding, decoding, and opening orders.
            Use it to quickly test how the SDK behaves in a browser before wiring it into a larger dapp.
          </p>
        </div>
        <div className="tab-switcher">
          <button type="button" className={tab === 'encode' ? 'active' : ''} onClick={() => setTab('encode')}>
            Encode/Decode
          </button>
          <button type="button" className={tab === 'open' ? 'active' : ''} onClick={() => setTab('open')}>
            Open Order
          </button>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}

      {tab === 'encode' && (
        <>
          {!error && status && <div className="alert info">{status}</div>}
          <div className="header-actions">
            <button type="button" onClick={() => setForm(DEFAULT_FORM)}>
              Reset fields
            </button>
            <button type="button" className="secondary" onClick={handleEncode}>
              Encode order
            </button>
          </div>

          <section className="form-grid">
            {FIELD_GROUPS.map((group) => (
              <article key={group.title}>
                <h2>{group.title}</h2>
                <div className="field-grid">
                  {group.fields.map((field) => (
                    <label key={field.name}>
                      <span>{field.label}</span>
                      <input
                        name={field.name}
                        value={form[field.name]}
                        onChange={handleChange}
                        type={field.type ?? 'text'}
                        autoComplete="off"
                      />
                    </label>
                  ))}
                </div>
              </article>
            ))}
          </section>

          <section className="results">
            <div className="results-header">
              <h2>Encoded payload</h2>
              <div className="results-actions">
                <button type="button" onClick={handleEncode}>
                  Encode order
                </button>
                <button type="button" className="secondary" onClick={handleDecode} disabled={!encoded}>
                  Decode payload
                </button>
              </div>
            </div>
            <textarea
              name="encoded"
              placeholder="0x..."
              value={encoded}
              onChange={(event) => setEncoded(event.target.value)}
              spellCheck={false}
            />

            <h2>Decoded order preview</h2>
            <pre>{decoded ? JSON.stringify(decoded, (_key, value) => 
              typeof value === 'bigint' ? value.toString() : value
            , 2) : 'Run "Decode payload" to see structured data.'}</pre>
          </section>
        </>
      )}

      {tab === 'open' && (
        <>
          {orderStatus && <div className="alert info">{orderStatus}</div>}

          <div className="alert info">
            <strong>Bridge Initialization Modes:</strong>
            <ul style={{ margin: '0.5rem 0 0 1.5rem', paddingLeft: 0 }}>
              <li><strong>Secret Key:</strong> SDK creates PXE internally. Best for browser testing.</li>
              <li><strong>Standalone Wallet:</strong> Creates Wallet first, registers account, then passes to Bridge.</li>
              <li><strong>Azguard:</strong> Use Azguard wallet (requires @azguardwallet/client).</li>
            </ul>
          </div>

          <section className="order-form">
            <h2>Bridge Initialization</h2>
            <div className="field-grid">
              <label>
                <span>Initialization Mode</span>
                <select 
                  name="bridgeInitMode" 
                  value={orderForm.bridgeInitMode} 
                  onChange={handleOrderFormChange}
                >
                  <option value="secretKey">Secret Key + Salt</option>
                  <option value="pxe">Standalone Wallet (BaseWallet)</option>
                  <option value="azguard">Azguard Wallet</option>
                </select>
              </label>
            </div>

            <h2>Order Parameters</h2>
            <div className="field-grid">
              <label>
                <span>Bridge Direction</span>
                <select 
                  name="direction" 
                  value={orderForm.direction} 
                  onChange={handleOrderFormChange}
                >
                  <option value="aztecToEvm">Aztec → EVM (Base Sepolia)</option>
                  <option value="evmToAztec">EVM (Base Sepolia) → Aztec</option>
                </select>
              </label>
            </div>
            
            <div className="field-grid">
              <label>
                <span>Source Chain ID</span>
                <input
                  name="chainIdIn"
                  value={orderForm.chainIdIn}
                  type="text"
                  disabled
                  style={{ opacity: 0.6, cursor: 'not-allowed' }}
                />
              </label>
              <label>
                <span>Destination Chain ID</span>
                <input
                  name="chainIdOut"
                  value={orderForm.chainIdOut}
                  type="text"
                  disabled
                  style={{ opacity: 0.6, cursor: 'not-allowed' }}
                />
              </label>
              <label>
                <span>Input Token Address</span>
                <input
                  name="tokenIn"
                  value={orderForm.tokenIn}
                  onChange={handleOrderFormChange}
                  placeholder="0x..."
                />
              </label>
              <label>
                <span>Output Token Address</span>
                <input
                  name="tokenOut"
                  value={orderForm.tokenOut}
                  onChange={handleOrderFormChange}
                  placeholder="0x..."
                />
              </label>
              <label>
                <span>Amount In (wei)</span>
                <input
                  name="amountIn"
                  value={orderForm.amountIn}
                  onChange={handleOrderFormChange}
                  placeholder="1000000000000000000"
                />
              </label>
              <label>
                <span>Amount Out (wei)</span>
                <input
                  name="amountOut"
                  value={orderForm.amountOut}
                  onChange={handleOrderFormChange}
                  placeholder="250000000000000000"
                />
              </label>
              <label>
                <span>Recipient Address</span>
                <input
                  name="recipient"
                  value={orderForm.recipient}
                  onChange={handleOrderFormChange}
                  placeholder="0x..."
                />
              </label>
              <label>
                <span>Mode</span>
                <select name="mode" value={orderForm.mode} onChange={handleOrderFormChange}>
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                  <option value="publicWithHook">Public with Hook</option>
                  <option value="privateWithHook">Private with Hook</option>
                </select>
              </label>
              <label>
                <span>Data (32 bytes)</span>
                <input
                  name="data"
                  value={orderForm.data}
                  onChange={handleOrderFormChange}
                  placeholder="0x0000...0001"
                />
              </label>
              <label>
                <span>EVM Private Key (for EVM→Aztec)</span>
                <input
                  name="evmPrivateKey"
                  value={orderForm.evmPrivateKey}
                  onChange={handleOrderFormChange}
                  type="password"
                  placeholder="0x..."
                />
              </label>
            </div>

            {orderForm.bridgeInitMode === 'secretKey' && (
              <>
                <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>
                  Aztec Credentials - Secret Key Mode
                </h3>
                <div className="field-grid">
                  <label>
                    <span>Aztec Secret Key</span>
                    <input
                      name="aztecSecretKey"
                      value={orderForm.aztecSecretKey}
                      onChange={handleOrderFormChange}
                      type="password"
                      placeholder="0x..."
                    />
                  </label>
                  <label>
                    <span>Aztec Key Salt</span>
                    <input
                      name="aztecKeySalt"
                      value={orderForm.aztecKeySalt}
                      onChange={handleOrderFormChange}
                      type="password"
                      placeholder="0x..."
                    />
                  </label>
                  <label>
                    <span>Aztec Node URL</span>
                    <input
                      name="aztecNodeUrl"
                      value={orderForm.aztecNodeUrl}
                      onChange={handleOrderFormChange}
                      placeholder="https://devnet.aztec-labs.com"
                    />
                  </label>
                  <label>
                    <span>PXE Store Directory (optional)</span>
                    <input
                      name="aztecPxeStoreDirectory"
                      value={orderForm.aztecPxeStoreDirectory}
                      onChange={handleOrderFormChange}
                      placeholder="webapp-pxe"
                    />
                  </label>
                </div>
              </>
            )}

            {orderForm.bridgeInitMode === 'pxe' && (
              <>
                <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>
                  Standalone Wallet Mode
                </h3>
                <div className="alert info">
                  Creates a standalone Wallet (extends BaseWallet) with PXE and account, then passes it to the Bridge. 
                  This mode demonstrates how to use the Bridge with a pre-initialized wallet instance.
                  The wallet must have accounts already registered.
                </div>
                <div className="field-grid">
                  <label>
                    <span>Aztec Node URL</span>
                    <input
                      name="aztecNodeUrl"
                      value={orderForm.aztecNodeUrl}
                      onChange={handleOrderFormChange}
                      placeholder="https://devnet.aztec-labs.com"
                    />
                  </label>
                  <label>
                    <span>Aztec Secret Key (for account creation)</span>
                    <input
                      name="aztecSecretKey"
                      value={orderForm.aztecSecretKey}
                      onChange={handleOrderFormChange}
                      type="password"
                      placeholder="0x..."
                    />
                  </label>
                  <label>
                    <span>Aztec Key Salt</span>
                    <input
                      name="aztecKeySalt"
                      value={orderForm.aztecKeySalt}
                      onChange={handleOrderFormChange}
                      type="password"
                      placeholder="0x..."
                    />
                  </label>
                </div>
              </>
            )}

            {orderForm.bridgeInitMode === 'azguard' && (
              <>
                <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>
                  Azguard Wallet Mode
                </h3>
                <div className="alert info">
                  Connect your Azguard wallet and pass the <code>AzguardClient</code> instance 
                  via <code>bridgeConfig.azguardClient</code>. Requires <code>@azguardwallet/client</code> package.
                </div>
                <div className="field-grid">
                  <label>
                    <span>Wallet Status</span>
                    <input
                      value={orderForm.azguardConnected ? 'Connected' : 'Not Connected'}
                      disabled
                    />
                  </label>
                </div>
              </>
            )}

            <div className="order-actions">
              <button type="button" onClick={handleOpenOrder} className="primary">
                Open Order
              </button>
            </div>
          </section>

          {orderLogs.length > 0 && (
            <section className="results">
              <h2>Order Progress</h2>
              <div style={{ 
                background: '#1e1e1e', 
                padding: '1rem', 
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: '0.9rem',
                maxHeight: '300px',
                overflowY: 'auto'
              }}>
                {orderLogs.map((log, index) => (
                  <div key={index} style={{ marginBottom: '0.5rem', color: '#d4d4d4' }}>
                    <span style={{ color: '#858585' }}>[{log.timestamp}]</span> {log.message}
                  </div>
                ))}
              </div>
            </section>
          )}

          {orderResult && (
            <section className="results">
              <h2>Order Result</h2>
              <pre>{JSON.stringify(orderResult, (_key, value) => 
                typeof value === 'bigint' ? value.toString() : value
              , 2)}</pre>
            </section>
          )}
        </>
      )}
    </div>
  )
}

export default App
