import {Deferred} from './utils'

const OPEN_SETTINGS = 'menubar=1,resizable=1,width=400,height=600'

function parseErrorMessage(error: any) {
    let errorMessage: string

    if (error.json && error.json.error) {
        error = error.json.error
    }

    if (error.error) {
        error = error.error
    }

    if (error.details) {
        const {details, name, what} = error
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
    deferredTransact:
        | {
              deferral: Deferred<any>
              transaction: any
              params: any
              waitingForOpen: boolean
          }
        | undefined
    deferredLogin: Deferred<any> | undefined
    scheme: string

    public get childWindow() {
        return _childWindow
    }

    public set childWindow(window: Window | null) {
        if (_childWindow !== window) {
            _childWindow = window
            if (!_childWindow && this.closeCheckInterval) {
                clearInterval(this.closeCheckInterval)
            }
            if (_childWindow) {
                this.closeCheckInterval = setInterval(() => this.checkChildWindowClosed(), 500)
            }
        }
    }

    private closeCheckInterval: NodeJS.Timeout | null = null

    constructor(options: {scheme: string} = {scheme: 'proton'}) {
        this.scheme = options.scheme

        if (typeof window !== 'undefined') {
            window.addEventListener('message', (event) => this.onEvent(event), false)
        }
    }

    childUrl(path: string) {
        const base =
            this.scheme === 'proton-dev' ? 'https://testnet.webauth.com' : 'https://webauth.com'
        return `${base}${path}`
    }

    closeChild() {
        if (this.childWindow) {
            if (this.closeCheckInterval) {
                clearInterval(this.closeCheckInterval)
            }
            if (!this.childWindow.closed) {
                this.childWindow.close()
            }
            this.childWindow = null
        }
    }

    async login() {
        if (this.deferredTransact) {
            this.closeChild()
            this.deferredTransact.deferral.reject('Trying to login')
            this.deferredTransact = undefined
        }

        this.childWindow = window.open(this.childUrl('/login'), '_blank', OPEN_SETTINGS)
        this.deferredLogin = new Deferred()

        try {
            const auth: {
                actor: string
                permission: string
            } = await this.deferredLogin.promise
            return {
                inBrowser: auth,
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(e)
            throw e
        }
    }

    async transact(args: any /*TransactArgs*/, options?: any /*TransactOptions*/): Promise<any> {
        if (this.deferredLogin) {
            this.closeChild()
            this.deferredLogin.reject('Trying to login')
            this.deferredLogin = undefined
        }

        this.deferredTransact = {
            deferral: new Deferred(),
            transaction: args.transaction || {actions: args.actions},
            params: options,
            waitingForOpen: true,
        }

        this.childWindow = window.open(this.childUrl('/auth'), '_blank', OPEN_SETTINGS)

        // eslint-disable-next-line no-useless-catch
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
            const {type, data, error} = eventData
            if (!type) {
                return
            }

            // Ready to receive transaction
            if (type === 'isReady') {
                if (this.deferredTransact && this.deferredTransact.waitingForOpen) {
                    this.deferredTransact.waitingForOpen = false

                    this.childWindow!.postMessage(
                        JSON.stringify({
                            type: 'transaction',
                            data: {
                                transaction: this.deferredTransact.transaction,
                                params: this.deferredTransact.params,
                            },
                        }),
                        '*'
                    )
                }
            }
            // Close child
            else if (type === 'close') {
                this.closeChild()

                if (this.deferredTransact) {
                    this.deferredTransact.deferral.reject('Closed')
                } else if (this.deferredLogin) {
                    this.deferredLogin.reject('Closed')
                }
            }
            // TX Success
            else if (type === 'transactionSuccess') {
                this.closeChild()

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
                this.closeChild()

                if (this.deferredLogin) {
                    this.deferredLogin.resolve(data)
                    this.deferredLogin = undefined
                }
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(e)
        }
    }

    private checkChildWindowClosed() {
        if (this.childWindow && this.childWindow.closed) {
            if (typeof window !== 'undefined') {
                window.postMessage(
                    JSON.stringify({
                        type: 'close',
                    }),
                    '*'
                )
            }
        }
    }
}
