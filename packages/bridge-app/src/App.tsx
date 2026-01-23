import type { ChangeEvent } from 'react'
import { useMemo, useState } from 'react'
import type { Hex } from 'viem'

import { Bridge, OrderDataEncoder, type Order, type OrderData } from '@substancelabs/aztec-evm-bridge-sdk'
import { Faucet } from './components/Faucet'

import './App.css'

type Tab = 'encode' | 'open' | 'faucet'

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
  const [initMode, setInitMode] = useState<'azguard' | 'wallet'>('wallet')
  const [orderDirection, setOrderDirection] = useState<'evm-to-aztec' | 'aztec-to-evm'>('evm-to-aztec')
  const [orderForm, setOrderForm] = useState({
    chainIdIn: '84532', // Base Sepolia
    chainIdOut: '999999', // Aztec Sepolia
    tokenIn: '0xAf31a5CFf95131B2E0D3fa89125342984567f399', // WETH on Base Sepolia
    tokenOut: '0x089d76aaa3261376f2073894cddff9a070c1ca2c3ae2a2b25fcce25d68caae81', // WETH on Aztec
    amountIn: '1000',
    amountOut: '1000',
    recipient: '',
    mode: 'public' as const,
    data: '0x0000000000000000000000000000000000000000000000000000000000000000',
    // Wallet credentials (for 'wallet' mode)
    aztecSecretKey: '',
    aztecKeySalt: '',
    aztecNodeUrl: 'https://devnet.aztec-labs.com',
    // EVM credentials
    evmPrivateKey: '',
  })
  const [orderStatus, setOrderStatus] = useState<string>('')
  const [orderResult, setOrderResult] = useState<any>(null)
  const [isOrderLoading, setIsOrderLoading] = useState<boolean>(false)

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
    setOrderForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleDirectionChange = (newDirection: 'evm-to-aztec' | 'aztec-to-evm') => {
    setOrderDirection(newDirection)
    
    // Swap chain IDs and token addresses when direction changes
    if (newDirection === 'evm-to-aztec') {
      setOrderForm((prev) => ({
        ...prev,
        chainIdIn: '84532', // Base Sepolia
        chainIdOut: '999999', // Aztec
        tokenIn: '0xAf31a5CFf95131B2E0D3fa89125342984567f399', // WETH on Base Sepolia
        tokenOut: '0x089d76aaa3261376f2073894cddff9a070c1ca2c3ae2a2b25fcce25d68caae81', // WETH on Aztec
      }))
    } else {
      setOrderForm((prev) => ({
        ...prev,
        chainIdIn: '999999', // Aztec
        chainIdOut: '84532', // Base Sepolia
        tokenIn: '0x089d76aaa3261376f2073894cddff9a070c1ca2c3ae2a2b25fcce25d68caae81', // WETH on Aztec
        tokenOut: '0xAf31a5CFf95131B2E0D3fa89125342984567f399', // WETH on Base Sepolia
      }))
    }
  }

  const handleOpenOrder = async () => {
    setError(null)
    setOrderStatus('Initializing bridge...')
    setOrderResult(null)
    setIsOrderLoading(true)

    try {
      if (!orderForm.tokenIn || !orderForm.tokenOut) {
        throw new Error('Token addresses are required')
      }
      if (!orderForm.recipient) {
        throw new Error('Recipient address is required')
      }
      if (!orderForm.evmPrivateKey) {
        throw new Error('EVM private key is required')
      }

      let bridge: Bridge

      if (initMode === 'azguard') {
        // Initialize with Azguard client
        setOrderStatus('Connecting to Azguard...')
        const { AzguardClient } = await import('@azguardwallet/client')
        const azguardClient = await AzguardClient.create()
        
        bridge = await Bridge.create({
          azguardClient,
          evmPrivateKey: orderForm.evmPrivateKey as Hex,
        })
        setOrderStatus('Connected to Azguard')
      } else {
        // Initialize with test wallet
        if (!orderForm.aztecSecretKey || !orderForm.aztecKeySalt) {
          throw new Error('Aztec secret key and salt are required for wallet mode')
        }

        setOrderStatus('Creating Aztec wallet...')
        const { Fr } = await import('@aztec/aztec.js/fields')
        const { createAztecNodeClient } = await import('@aztec/aztec.js/node')
        const { TestWallet } = await import('@aztec/test-wallet/client/lazy')
        
        const aztecNode = createAztecNodeClient(orderForm.aztecNodeUrl)
        const secretKey = Fr.fromHexString(orderForm.aztecSecretKey as Hex)
        const salt = Fr.fromHexString(orderForm.aztecKeySalt as Hex)
        
        const testWallet = await TestWallet.create(aztecNode, {
          l1Contracts: await aztecNode.getL1ContractAddresses(),
          proverEnabled: false,
        })
        
        const accountManager = await testWallet.createSchnorrAccount(secretKey, salt)
        
        // Try to deploy account if needed
        try {
          const deployMethod = await accountManager.getDeployMethod()
          const completeAddress = await accountManager.getCompleteAddress()
          await deployMethod.send({ from: completeAddress.address }).wait()
        } catch (e) {
          console.log('Account already deployed or deployment not needed:', e)
        }
        
        bridge = await Bridge.create({
          aztecWallet: testWallet,
          evmPrivateKey: orderForm.evmPrivateKey as Hex,
        })
        setOrderStatus('Aztec wallet created')
      }

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

      setOrderStatus('Opening order...')

      const result = await bridge.openOrder(order, {
        onSecret: ({ orderId, secret }: { orderId: string; secret: string }) => {
          setOrderStatus(`Secret generated for order ${orderId.slice(0, 10)}...`)
          console.log('Order ID:', orderId)
          console.log('Secret:', secret)
        },
        onOrderOpened: ({ orderId, transactionHash, resolvedOrder }: any) => {
          setOrderStatus(`Order opened! TX: ${transactionHash.slice(0, 10)}...`)
          console.log('Full Transaction Hash:', transactionHash)
          console.log('Order ID:', orderId)
          console.log('Resolved Order:', resolvedOrder)
        },
        onOrderFilled: ({ orderId }: { orderId: string }) => {
          setOrderStatus(`Order filled! ID: ${orderId.slice(0, 10)}...`)
        },
        onOrderClaimed: ({ transactionHash }: { transactionHash: string }) => {
          setOrderStatus(`Order claimed! TX: ${transactionHash.slice(0, 10)}...`)
          console.log('Claim TX:', transactionHash)
        },
      })

      setOrderResult(result)
      setOrderStatus('Order completed successfully!')
    } catch (err) {
      setError((err as Error).message)
      setOrderStatus('Order failed')
      console.error('Order error:', err)
    } finally {
      setIsOrderLoading(false)
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
          <button type="button" className={tab === 'faucet' ? 'active' : ''} onClick={() => setTab('faucet')}>
            🚰 Faucet
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
            <pre>{decoded ? JSON.stringify(decoded, null, 2) : 'Run "Decode payload" to see structured data.'}</pre>
          </section>
        </>
      )}

      {tab === 'open' && (
        <>
          {orderStatus && <div className="alert info">{orderStatus}</div>}

          <section className="order-form">
            <h2>Order Direction</h2>
            <div className="mode-switcher">
              <button
                type="button"
                className={orderDirection === 'evm-to-aztec' ? 'active' : ''}
                onClick={() => handleDirectionChange('evm-to-aztec')}
              >
                EVM → Aztec
              </button>
              <button
                type="button"
                className={orderDirection === 'aztec-to-evm' ? 'active' : ''}
                onClick={() => handleDirectionChange('aztec-to-evm')}
              >
                Aztec → EVM
              </button>
            </div>
          </section>

          <section className="order-form">
            <h2>Initialization Mode</h2>
            <div className="mode-switcher">
              <button
                type="button"
                className={initMode === 'wallet' ? 'active' : ''}
                onClick={() => setInitMode('wallet')}
              >
                Test Wallet
              </button>
              <button
                type="button"
                className={initMode === 'azguard' ? 'active' : ''}
                onClick={() => setInitMode('azguard')}
              >
                Azguard Extension
              </button>
            </div>
          </section>

          {initMode === 'wallet' && (
            <section className="order-form">
              <h2>Aztec Wallet Credentials</h2>
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
                    placeholder="https://api.aztec.network/..."
                  />
                </label>
              </div>
            </section>
          )}

          <section className="order-form">
            <h2>EVM Credentials</h2>
            <div className="field-grid">
              <label>
                <span>EVM Private Key</span>
                <input
                  name="evmPrivateKey"
                  value={orderForm.evmPrivateKey}
                  onChange={handleOrderFormChange}
                  type="password"
                  placeholder="0x..."
                />
              </label>
            </div>
          </section>

          <section className="order-form">
            <h2>Order Parameters</h2>
            <div className="field-grid">
              <label>
                <span>Source Chain ID</span>
                <input
                  name="chainIdIn"
                  value={orderForm.chainIdIn}
                  onChange={handleOrderFormChange}
                  type="number"
                  placeholder="84532"
                />
              </label>
              <label>
                <span>Destination Chain ID</span>
                <input
                  name="chainIdOut"
                  value={orderForm.chainIdOut}
                  onChange={handleOrderFormChange}
                  type="number"
                  placeholder="11155111"
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
            </div>

            <div className="order-actions">
              <button type="button" onClick={handleOpenOrder} className="primary" disabled={isOrderLoading}>
                {isOrderLoading ? 'Processing...' : 'Open Order'}
              </button>
            </div>
          </section>

          {orderResult && (
            <section className="results">
              <h2>Order Result</h2>
              <pre>{JSON.stringify(orderResult, null, 2)}</pre>
            </section>
          )}
        </>
      )}

      {tab === 'faucet' && <Faucet />}
    </div>
  )
}

export default App
