import { useState, useEffect, useMemo } from 'react'

import './App.css'

import WebRenderer from '@wharfkit/web-renderer';
import SessionKit, { Session } from '@wharfkit/session';
import { WalletPluginWebAuth } from "../../"

const webRenderer = new WebRenderer()

const sessionKit = new SessionKit({
  appName: "wharfkit",
  chains: [
    {
      id: "71ee83bcf52142d61019d95f9cc5427ba6a0d7ff8accd9e2088ae2abeaf3d3dd",
      url: "https://proton-testnet.eoscafeblock.com",
    },
  ],
  ui: webRenderer,
  walletPlugins: [
    new WalletPluginWebAuth({
      scheme: 'proton-dev'
    }),
  ],
})

function App() {
  const [sess, setSession] = useState<Session | undefined>(undefined)
  const [to, setTo] = useState<string>('')
  const [quantity, setQuantity] = useState<string>('')
  const [broadcast, setBroadcast] = useState<boolean>(true)

  useEffect(() => {
    const restoreSession = async () => {
      const session = await sessionKit.restore()
      setSession(session);
    }

    restoreSession().catch(console.error);
  }, [])

  async function login() {
    const { session } = await sessionKit.login()
    setSession(session)
  }

  async function logout() {
    if(sess) {
      await sessionKit.logout()
      setSession(undefined);
    }
  }

  const actorName = useMemo(() => {
    return sess ? sess.actor.toString() : ''
  }, [sess])

  const canTransfer = useMemo(() => (+quantity > 0) && to !== '', [quantity, to])
  
  const handleTo = (event: React.FormEvent<HTMLInputElement>) => {
    setTo(event.currentTarget.value);
  }

  const handleQuantity = (event: React.FormEvent<HTMLInputElement>) => {
    setQuantity(event.currentTarget.value);
  }

  const handleBroadcast = (event: React.FormEvent<HTMLInputElement>) => {
    setBroadcast(event.currentTarget.checked);
  }
  
  async function doTransfer() {
    if(sess) {
      const data: any = {
        account: "eosio.token",
        name: "transfer",
        authorization: [sess.permissionLevel],
        data: {
          from: sess.actor,
          to: to,
          quantity: `${(+quantity).toFixed(4)} XPR`,
          memo: "",
        },
      }

      const result2 = await sess.transact({ action: data }, { broadcast })
      console.log('Transact result: ', result2);
    }
  }

  return (
    <>
    <div className="min-h-screen px-3">
      <div className="py-2 flex flex-row items-center"> 
        <div className="ml-auto">
        { sess ? (
          <>
          <span className="mr-2 font-bold">{ actorName }</span>
          <button type="button" 
                  className="cursor-pointer whitespace-nowrap text-white bg-purple-700 hover:bg-purple-800 focus:ring-4 focus:ring-purple-300 font-medium rounded-lg text-sm px-5 py-2.5 me-2 mb-2 focus:outline-none" 
                  onClick={logout}>Logout</button>
          </>
        ) : (
          <button type="button" 
                  className="cursor-pointer whitespace-nowrap text-white bg-purple-700 hover:bg-purple-800 focus:ring-4 focus:ring-purple-300 font-medium rounded-lg text-sm px-5 py-2.5 me-2 mb-2 focus:outline-none" 
                  onClick={login}>Login</button>
        )}
        </div>
      </div>
      <div className="py-2 border-t-2 border-zinc-300">
        {
           sess && (
            <>
              <div className="mb-2">
                <div>
                  <label htmlFor="to" className="flex text-sm font-medium text-gray-700">To</label>
                  <div className="mt-1">
                    <input
                      type="text"
                      name="to"
                      id="to"
                      className="outline-none block w-full rounded-md border-0 py-1.5 px-2 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-purple-600"
                      placeholder="e.g. token.burn"
                      value={to}
                      onChange={handleTo}
                    />
                  </div>
                </div>
              </div>

              <div className="mb-2">
                <label htmlFor="quantity" className="flex text-sm font-medium text-gray-700">Amount</label>
                <div className="mt-1">
                  <input
                    type="text"
                    name="quantity"
                    id="quantity"
                    className="outline-none block w-full rounded-md border-0 py-1.5 px-2 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-purple-600"
                    placeholder="e.g. 1.3"
                    value={quantity}
                    onChange={handleQuantity}
                  />
                </div>
              </div>

              <div className="mb-2">
                  <input
                    type="checkbox"
                    name="broadcast"
                    id="broadcast"
                    checked={broadcast}
                    onChange={handleBroadcast}
                  />
                  <label htmlFor="broadcast" className="text-sm font-medium text-gray-700 ml-2">Broadcast</label>
              </div>

              { !broadcast && 
                <div className="mt-1 mb-2 italic">
                  Broadcasting disabled. Check transaction info in console.
                </div>
              }

              <div>
                <button type="button"
                  className="cursor-pointer whitespace-nowrap bg-purple-100 border border-transparent rounded-md py-2 px-4 inline-flex items-center justify-center text-base font-medium text-purple-600 hover:bg-purple-200 disabled:bg-zinc-100 disabled:text-zinc-500"
                  onClick={doTransfer}
                  disabled={!canTransfer}
                >
                  Transfer
                </button>
              </div>
            </>
           )
        }
      </div>
    </div>
    
    </>
  )
}

export default App
