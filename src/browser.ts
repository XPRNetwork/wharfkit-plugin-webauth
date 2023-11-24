// import type { LinkOptions, LinkStorage, LinkTransport, TransactArgs, TransactOptions } from "@proton/link"

import { Deferred } from './utils'

const OPEN_SETTINGS = 'menubar=1,resizable=1,width=400,height=600'

interface Authorization {
  actor: string,
  permission: string
}

function parseErrorMessage(error: any) {
  let errorMessage: string

  if (error.json && error.json.error) {
      error = error.json.error
  }

  if (error.error) {
      error = error.error
  }

  if (error.details) {
      const { code, details, name, what } = error
      if (name === 'eosio_assert_message_exception') {
          errorMessage = details[0].message.replace('assertion failure with message: ', '')
      } else if (details.length > 0) {
          errorMessage = details.map((d) => d.message).join('\n')
      } else {
          errorMessage = what || String(error)
      }
  } else {
      errorMessage = error.message || String(error)
  }

  return errorMessage
}

// Need to keep outside class since it messes with reactivity like Vuex
let _childWindow: Window | null = null

export class BrowserTransport {
  deferredTransact: {
    deferral: Deferred<any>
    transaction: any,
    params: any,
    waitingForOpen: boolean
  } | undefined
  deferredLogin: Deferred<any> | undefined
  scheme: string

  public get childWindow() {
    return _childWindow;
  }

  public set childWindow(window: Window | null) {
    _childWindow = window
  }

  constructor(options: { scheme: string} = { scheme: 'proton' }) {
    this.scheme = options.scheme

    setInterval(() => this.closeChild(), 500)
    window.addEventListener('message', (event) => this.onEvent(event), false)
  }

  childUrl(path: string) {
    const base = this.scheme === 'proton-dev' 
      ? 'https://testnet.webauth.com' 
      : 'https://webauth.com'
    return `${base}${path}`
  }

  closeChild(force = false) {
    if (this.childWindow) {
      if (force) {
        this.childWindow.close()
      }

      if (force || this.childWindow.closed) {
        this.childWindow = null
      }
    }
  }

  async login() {
    if (this.deferredTransact) {
      this.closeChild(true)
      this.deferredTransact.deferral.reject('Trying to login')
      this.deferredTransact = undefined
    }

    this.childWindow = window.open(this.childUrl('/login'), '_blank', OPEN_SETTINGS)
    this.deferredLogin = new Deferred()

    try {
      const auth: {
        actor: string,
        permission: string
      } = await this.deferredLogin.promise
      return {
        inBrowser: auth
      }
    } catch (e) {
      console.error(e)
      throw e
    }
  }

  async transact(args: any /*TransactArgs*/, options?: any /*TransactOptions*/): Promise<any> {
    if (this.deferredLogin) {
      this.closeChild(true)
      this.deferredLogin.reject('Trying to login')
      this.deferredLogin = undefined
    }

    this.deferredTransact = {
      deferral: new Deferred(),
      transaction: args.transaction || { actions: args.actions },
      params: options,
      waitingForOpen: true
    }

    this.childWindow = window.open(this.childUrl('/auth'), '_blank', OPEN_SETTINGS)

    try {
      const res = await this.deferredTransact.deferral.promise
      return res
    } catch (error) {
      throw error
    }
  }

  async onEvent(e: MessageEvent) {
    if (
      e.origin.indexOf('https://webauth.com') !== -1 &&
      e.origin.indexOf('https://testnet.webauth.com') !== -1
    ) {
      return
    }

    let eventData
    try {
      eventData = JSON.parse(e.data)
    } catch (e) {
      return
    }

    try {
      const { type, data, error } = eventData
      if (!type) {
        return
      }

      // Ready to receive transaction
      if (type === 'isReady') {
        if (this.deferredTransact && this.deferredTransact.waitingForOpen) {
          this.deferredTransact.waitingForOpen = false

          this.childWindow!.postMessage(JSON.stringify({
            type: 'transaction',
            data: {
              transaction: this.deferredTransact.transaction,
              params: this.deferredTransact.params
            }
          }), '*')
        }
      }
      // Close child
      else if (type === 'close') {
        this.closeChild(true)

        if (this.deferredTransact) {
          this.deferredTransact.deferral.reject('Closed')
        } else if (this.deferredLogin) {
          this.deferredLogin.reject('Closed')
        }
      }
      // TX Success
      else if (type === 'transactionSuccess') {
        this.closeChild(true)
        console.log('transactionSuccess', error, data);

        if (this.deferredTransact) {
          if (error) {
            const errorMessage = parseErrorMessage(error)
            this.deferredTransact.deferral.reject(errorMessage)
          } else {
            this.deferredTransact.deferral.resolve(data)
          }

          this.deferredTransact = undefined
        }
      }
      // Login success
      else if (type === 'loginSuccess') {
        this.closeChild(true)

        if (this.deferredLogin) {
          this.deferredLogin.resolve(data)
          this.deferredLogin = undefined
        }
      }
    } catch (e) {
      console.error(e)
    }
  }
}
