import {send} from '@greymass/buoy'
import {
    AbstractWalletPlugin,
    CallbackPayload,
    Cancelable,
    Canceled,
    Checksum256,
    LoginContext,
    Logo,
    PackedTransaction,
    PermissionLevel,
    PrivateKey,
    PromptResponse,
    PublicKey,
    ResolvedSigningRequest,
    Serializer,
    TransactContext,
    WalletPluginConfig,
    WalletPluginLoginResponse,
    WalletPluginMetadata,
    WalletPluginSignResponse,
} from '@wharfkit/session'
import {
    extractSignaturesFromCallback,
    generateReturnUrl,
    isAppleHandheld,
    isCallback,
    LinkInfo,
    sealMessage,
    setTransactionCallback,
    verifyLoginCallbackResponse,
    waitForCallback,
} from '@wharfkit/protocol-esr'

import WebSocket from 'isomorphic-ws'
import {createIdentityRequest, Deferred, fixAndroidUrl, getChainId, isAndroid} from './utils'
import {BrowserTransport} from './browser'
import {inBrowserPayload, isInBrowserPayload} from './types'

import defaultTranslations from './translations'

type ProtonScheme = 'esr' | 'proton' | 'proton-dev'

interface WalletPluginOptions {
    buoyUrl?: string
    buoyWs?: WebSocket
    scheme?: ProtonScheme
}
export class WalletPluginWebAuth extends AbstractWalletPlugin {
    chain: Checksum256 | undefined
    auth: PermissionLevel | undefined
    requestKey: PublicKey | undefined
    privateKey: PrivateKey | undefined
    signerKey: PublicKey | undefined
    channelUrl: string | undefined
    channelName: string | undefined
    buoyUrl: string
    buoyWs: WebSocket | undefined
    scheme: ProtonScheme = 'proton'

    private browserTransport?: BrowserTransport

    /**
     * The unique identifier for the wallet plugin.
     */
    id = 'webauth'

    /**
     * The translations for this plugin
     */
    translations = defaultTranslations

    constructor(options?: WalletPluginOptions) {
        super()

        this.buoyUrl = options?.buoyUrl || 'https://cb.anchor.link'
        this.buoyWs = options?.buoyWs
        if (options?.scheme) {
            this.scheme = options.scheme
        }

        this.browserTransport = new BrowserTransport({scheme: this.scheme})
    }

    /**
     * The logic configuration for the wallet plugin.
     */
    readonly config: WalletPluginConfig = {
        // Should the user interface display a chain selector?
        requiresChainSelect: false,
        // Should the user interface display a permission selector?
        requiresPermissionSelect: false,
    }
    /**
     * The metadata for the wallet plugin to be displayed in the user interface.
     */
    readonly metadata: WalletPluginMetadata = WalletPluginMetadata.from({
        name: 'WebAuth',
        description: '',
        logo: Logo.from({
            dark: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNjAiIGhlaWdodD0iMTYwIiB2aWV3Qm94PSIwIDAgMTAwMCAxMDAwIiB4bWw6c3BhY2U9InByZXNlcnZlIj48ZyBmaWxsPSIjZmZmIj48cGF0aCBkPSJNMzIxLjM5NSAyNDguNzA4YzI0LjAxNyAwIDQwLjk4MSAyMy41MzMgMzMuMzg0IDQ2LjMyMmwtNzEuODggMjE1LjY0MWMtNS45NTMgMTcuODYzIDMuNyAzNy4xNjcgMjEuNTYzIDQzLjExOSAxNy44NjMgNS45NTggMzcuMTY4LTMuNjk3IDQzLjEyNi0yMS41Nmw4Ni40ODctMjU5LjQ1OGM0Ljc4NS0xNC4zNyAxOC4yMzUtMjQuMDY0IDMzLjM4NC0yNC4wNjRoODIuNjg1YzE1LjE0OCAwIDI4LjU5OSA5LjY5MyAzMy4zOSAyNC4wNjRsODYuNDggMjU5LjQ1OWM1Ljk1OSAxNy44NjIgMjUuMjYzIDI3LjUxNyA0My4xMjYgMjEuNTU5IDE3Ljg2Mi01Ljk1MiAyNy41MTctMjUuMjU2IDIxLjU2NS00My4xMTlMNjYyLjgyNCAyOTUuMDNjLTcuNTk4LTIyLjc4OSA5LjM2Ny00Ni4zMjIgMzMuMzg0LTQ2LjMyMmgxMzIuNzU4YzE4Ljk2MyAwIDM1Ljc5IDEyLjE1IDQxLjc1NSAzMC4xNWw0My45OTcgMTMyLjcyN2E5NC41NjUgOTQuNTY1IDAgMCAxLTQuNDUgNzAuNTY2TDc5MS4xMSA3MzEuMjkyYTM1LjE5MiAzNS4xOTIgMCAwIDEtMzEuNzQ2IDIwLjAwNkg2MzYuNDZjLTE1LjE0OCAwLTI4LjU5OS05LjY4OC0zMy4zOS0yNC4wNjNMNTMyLjQyNCA0NzUuNzJsLS4wNTktLjE5NmMtLjAzMi0uMDk5LS4wNjUtLjE5LS4wOTgtLjI4OS0uMDU5LS4xNzctLjEyNC0uMzQ3LS4xODMtLjUyNGEzMy45MTIgMzMuOTEyIDAgMCAwLTguMzg0LTEyLjk3MyAzMy44OTggMzMuODk4IDAgMCAwLTEwLjkyLTcuMDkyIDM0LjA2MiAzNC4wNjIgMCAwIDAtMTIuNzc3LTIuNDkgMzQuMTggMzQuMTggMCAwIDAtMjMuNjk2IDkuNTgyIDMzLjg2MyAzMy44NjMgMCAwIDAtOC4zODQgMTIuOTczYy0uMTE4LjMzNC0uMjM2LjY2OC0uMzQ3IDEuMDFsLTcwLjY0MyAyNTEuNTE0Yy00Ljc4NSAxNC4zNzUtMTguMjM2IDI0LjA2My0zMy4zODQgMjQuMDYzSDI0MC42NDRhMzUuMTkyIDM1LjE5MiAwIDAgMS0zMS43NDgtMjAuMDA2TDg5Ljc0MiA0ODIuMTUxYTk0LjU3NyA5NC41NzcgMCAwIDEtNC40NTItNzAuNTY2bDQzLjk5OS0xMzIuNzI4YzUuOTY2LTE3Ljk5OCAyMi43OTQtMzAuMTQ5IDQxLjc1NS0zMC4xNDl6Ii8+PHBhdGggZD0iTTQ3OS4wNzIgNTk2LjI3NmEyMS45OTcgMjEuOTk3IDAgMCAxIDIwLjk5Ni0xNS40MzdoMi44NTFhMjEuOTkgMjEuOTkgMCAwIDEgMjAuOTkgMTUuNDM3bDguMjUyIDI2LjM5YzQuNDI1IDE0LjE2Ni02LjE1NSAyOC41Ni0yMC45OTYgMjguNTZoLTE5LjM1Yy0xNC44MzQgMC0yNS40Mi0xNC4zOTQtMjAuOTg5LTI4LjU2eiIvPjwvZz48L3N2Zz4=',
            light: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNjAiIGhlaWdodD0iMTYwIiB2aWV3Qm94PSIwIDAgMTAwMCAxMDAwIiB4bWw6c3BhY2U9InByZXNlcnZlIj48cGF0aCBkPSJNMzIxLjM5NSAyNDguNzA4YzI0LjAxNyAwIDQwLjk4MSAyMy41MzMgMzMuMzg0IDQ2LjMyMmwtNzEuODggMjE1LjY0MWMtNS45NTMgMTcuODYzIDMuNyAzNy4xNjcgMjEuNTYzIDQzLjExOSAxNy44NjMgNS45NTggMzcuMTY4LTMuNjk3IDQzLjEyNi0yMS41Nmw4Ni40ODctMjU5LjQ1OGM0Ljc4NS0xNC4zNyAxOC4yMzUtMjQuMDY0IDMzLjM4NC0yNC4wNjRoODIuNjg1YzE1LjE0OCAwIDI4LjU5OSA5LjY5MyAzMy4zOSAyNC4wNjRsODYuNDggMjU5LjQ1OWM1Ljk1OSAxNy44NjIgMjUuMjYzIDI3LjUxNyA0My4xMjYgMjEuNTU5IDE3Ljg2Mi01Ljk1MiAyNy41MTctMjUuMjU2IDIxLjU2NS00My4xMTlMNjYyLjgyNCAyOTUuMDNjLTcuNTk4LTIyLjc4OSA5LjM2Ny00Ni4zMjIgMzMuMzg0LTQ2LjMyMmgxMzIuNzU4YzE4Ljk2MyAwIDM1Ljc5IDEyLjE1IDQxLjc1NSAzMC4xNWw0My45OTcgMTMyLjcyN2E5NC41NjUgOTQuNTY1IDAgMCAxLTQuNDUgNzAuNTY2TDc5MS4xMSA3MzEuMjkyYTM1LjE5MiAzNS4xOTIgMCAwIDEtMzEuNzQ2IDIwLjAwNkg2MzYuNDZjLTE1LjE0OCAwLTI4LjU5OS05LjY4OC0zMy4zOS0yNC4wNjNMNTMyLjQyNCA0NzUuNzJsLS4wNTktLjE5NmMtLjAzMi0uMDk5LS4wNjUtLjE5LS4wOTgtLjI4OS0uMDU5LS4xNzctLjEyNC0uMzQ3LS4xODMtLjUyNGEzMy45MTIgMzMuOTEyIDAgMCAwLTguMzg0LTEyLjk3MyAzMy44OTggMzMuODk4IDAgMCAwLTEwLjkyLTcuMDkyIDM0LjA2MiAzNC4wNjIgMCAwIDAtMTIuNzc3LTIuNDkgMzQuMTggMzQuMTggMCAwIDAtMjMuNjk2IDkuNTgyIDMzLjg2MyAzMy44NjMgMCAwIDAtOC4zODQgMTIuOTczYy0uMTE4LjMzNC0uMjM2LjY2OC0uMzQ3IDEuMDFsLTcwLjY0MyAyNTEuNTE0Yy00Ljc4NSAxNC4zNzUtMTguMjM2IDI0LjA2My0zMy4zODQgMjQuMDYzSDI0MC42NDRhMzUuMTkyIDM1LjE5MiAwIDAgMS0zMS43NDgtMjAuMDA2TDg5Ljc0MiA0ODIuMTUxYTk0LjU3NyA5NC41NzcgMCAwIDEtNC40NTItNzAuNTY2bDQzLjk5OS0xMzIuNzI4YzUuOTY2LTE3Ljk5OCAyMi43OTQtMzAuMTQ5IDQxLjc1NS0zMC4xNDl6Ii8+PHBhdGggZD0iTTQ3OS4wNzIgNTk2LjI3NmEyMS45OTcgMjEuOTk3IDAgMCAxIDIwLjk5Ni0xNS40MzdoMi44NTFhMjEuOTkgMjEuOTkgMCAwIDEgMjAuOTkgMTUuNDM3bDguMjUyIDI2LjM5YzQuNDI1IDE0LjE2Ni02LjE1NSAyOC41Ni0yMC45OTYgMjguNTZoLTE5LjM1Yy0xNC44MzQgMC0yNS40Mi0xNC4zOTQtMjAuOTg5LTI4LjU2eiIvPjwvc3ZnPg==',
        }),
        homepage: 'https://xprnetwork.org/wallet',
        download: 'https://xprnetwork.org/#download',
    })
    /**
     * Performs the wallet logic required to login and return the chain and permission level to use.
     *
     * @param options WalletPluginLoginOptions
     * @returns Promise<WalletPluginLoginResponse>
     */
    login(context: LoginContext): Promise<WalletPluginLoginResponse> {
        return new Promise((resolve, reject) => {
            this.handleLogin(context)
                .then((response) => {
                    resolve(response)
                })
                .catch((error) => {
                    reject(error)
                })
        })
    }

    async handleLogin(context: LoginContext): Promise<WalletPluginLoginResponse> {
        if (!context.ui) {
            throw new Error('No UI available')
        }

        // Retrieve translation helper from the UI, passing the app ID
        const t = context.ui.getTranslate(this.id)

        const browserLogin = new Deferred<inBrowserPayload>()

        // Create the identity request to be presented to the user
        const {callback, request, sameDeviceRequest, requestKey, privateKey} =
            await createIdentityRequest(context, this.buoyUrl)

        // Tell Wharf we need to prompt the user with a QR code and a button
        const promptResponse = context.ui?.prompt({
            title: t('login.title', {default: 'Connect with WebAuth'}),
            body: t('login.body', {
                default:
                    'Scan with WebAuth on your mobile device or click the button below to open on this device.',
            }),
            elements: [
                {
                    type: 'qr',
                    data: request.encode(true, false, `${this.scheme}:`),
                },
                {
                    type: 'link',
                    label: t('login.link', {default: 'Launch WebAuth'}),
                    data: {
                        href: sameDeviceRequest.encode(true, false, `${this.scheme}:`),
                        label: t('login.link', {default: 'Launch WebAuth'}),
                        variant: 'primary',
                    },
                },
                {
                    type: 'button',
                    data: {
                        icon: 'globe',
                        onClick: () => {
                            this.loginWithBrowser(browserLogin)
                        },
                        label: t('login.browser', {default: 'Launch browser'}),
                        variant: 'primary',
                    },
                },
            ],
        })

        promptResponse.catch((error) => {
            // Throw if what we caught was a cancelation
            if (error instanceof Canceled) {
                throw error
            }
        })

        // Await a promise race to wait for either the wallet response or the cancel
        const callbackResponse: CallbackPayload | inBrowserPayload = await Promise.race([
            waitForCallback(callback, this.buoyWs, t),
            browserLogin.promise,
        ])

        if (isInBrowserPayload(callbackResponse)) {
            const chainId = getChainId(context)
            if (!chainId) {
                throw new Error(
                    t('error.no_chain', {
                        default: 'No chain id provided',
                    })
                )
            }

            this.data.inBrowser = true

            this.data.requestKey = undefined
            this.data.privateKey = undefined
            this.data.signerKey = undefined
            this.data.channelUrl = undefined
            this.data.channelName = undefined

            return {
                chain: chainId,
                permissionLevel: PermissionLevel.from({
                    actor: callbackResponse.inBrowser.actor,
                    permission: callbackResponse.inBrowser.permission,
                }),
            }
        } else if (
            callbackResponse.link_ch &&
            callbackResponse.link_key &&
            callbackResponse.link_name &&
            callbackResponse.cid
        ) {
            verifyLoginCallbackResponse(callbackResponse, context)
            this.data.inBrowser = undefined

            this.data.requestKey = requestKey
            this.data.privateKey = privateKey
            this.data.signerKey =
                callbackResponse.link_key && PublicKey.from(callbackResponse.link_key)
            this.data.channelUrl = callbackResponse.link_ch
            this.data.channelName = callbackResponse.link_name

            try {
                if (callbackResponse.link_meta) {
                    const metadata = JSON.parse(callbackResponse.link_meta)
                    this.data.sameDevice = metadata.sameDevice
                    this.data.launchUrl = metadata.launchUrl
                    this.data.triggerUrl = metadata.triggerUrl
                }
            } catch (e) {
                // console.log('Error processing link_meta', e)
            }

            return {
                chain: Checksum256.from(callbackResponse.cid),
                permissionLevel: PermissionLevel.from({
                    actor: callbackResponse.sa,
                    permission: callbackResponse.sp,
                }),
            }
        } else {
            // Close the prompt
            promptResponse.cancel('Invalid response from WebAuth.')

            throw new Error(
                t('error.invalid_response', {
                    default:
                        'Invalid response from WebAuth, must contain link_ch, link_key, link_name and cid flags.',
                })
            )
        }
    }

    /**
     * Performs the wallet logic required to sign a transaction and return the signature.
     *
     * @param chain ChainDefinition
     * @param resolved ResolvedSigningRequest
     * @returns Promise<Signature>
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    sign(
        resolved: ResolvedSigningRequest,
        context: TransactContext
    ): Promise<WalletPluginSignResponse> {
        return this.handleSigningRequest(resolved, context)
    }

    private async handleSigningRequest(
        resolved: ResolvedSigningRequest,
        context: TransactContext
    ): Promise<WalletPluginSignResponse> {
        if (!context.ui) {
            throw new Error('No UI available')
        }

        // Retrieve translation helper from the UI, passing the app ID
        const t = context.ui.getTranslate(this.id)

        // Set expiration time frames for the request
        const expiration = resolved.transaction.expiration.toDate()
        const now = new Date()
        const expiresIn = Math.floor(expiration.getTime() - now.getTime())

        const errorString = t('error.not_completed', {default: 'The request was not completed.'})

        if (this.data.inBrowser && this.browserTransport) {
            // Tell Wharf we need to prompt the user with a QR code and a button
            const promptPromise: Cancelable<PromptResponse> = context.ui.prompt({
                title: t('transact.title', {default: 'Complete using WebAuth'}),
                body: t('transact.body_browser', {
                    default: `Please complete the transaction using the WebAuth popup window.`,
                }),
                elements: [
                    {
                        type: 'countdown',
                        data: {
                            label: t('transact.await', {
                                default: 'Waiting for response from WebAuth',
                            }),
                            end: expiration.toISOString(),
                        },
                    },
                ],
            })

            // Create a timer to test the external cancelation of the prompt, if defined
            const timer = setTimeout(() => {
                if (!context.ui) {
                    throw new Error('No UI available')
                }
                promptPromise.cancel(
                    t('error.expired', {default: 'The request expired, please try again.'})
                )
            }, expiresIn)

            // Clear the timeout if the UI throws (which generally means it closed)
            promptPromise.catch(() => clearTimeout(timer))

            const transactPromise = this.browserTransport.transact(
                {transaction: resolved.resolvedTransaction},
                {
                    broadcast: false,
                }
            )

            // Wait for either the callback or the prompt to resolve
            const callbackResponse = await Promise.race([transactPromise, promptPromise]).finally(
                () => {
                    // Clear the automatic timeout once the race resolves
                    clearTimeout(timer)
                }
            )

            if ('signatures' in callbackResponse && callbackResponse['signatures'].length > 0) {
                const signatures = extractSignaturesFromCallback({
                    sig: callbackResponse['signatures'][0],
                } as CallbackPayload)

                return {
                    signatures,
                    resolved: new ResolvedSigningRequest(
                        resolved.request,
                        PermissionLevel.from(callbackResponse.signer),
                        PackedTransaction.from({
                            packed_trx: callbackResponse.serializedTransaction,
                        }).getTransaction(),
                        callbackResponse.resolvedTransaction,
                        resolved.chainId
                    ),
                }
            }
            promptPromise.cancel(errorString)
        } else {
            // Create a new signing request based on the existing resolved request
            const modifiedRequest = await context.createRequest({transaction: resolved.transaction})

            // Set the expiration on the request LinkInfo
            modifiedRequest.setInfoKey(
                'link',
                LinkInfo.from({
                    expiration,
                })
            )

            // Add the callback to the request
            const callback = setTransactionCallback(modifiedRequest, this.buoyUrl)

            const request = modifiedRequest.encode(true, false, `${this.scheme}:`)

            // Mobile will return true or false, desktop will return undefined
            const isSameDevice =
                isAppleHandheld() || isAndroid() ? true : this.data.sameDevice === true

            // Same device request
            const sameDeviceRequest = modifiedRequest.clone()
            const returnUrl = fixAndroidUrl(generateReturnUrl())
            sameDeviceRequest.setInfoKey('same_device', true)
            sameDeviceRequest.setInfoKey('return_path', returnUrl)

            if (this.data.sameDevice) {
                if (this.data.launchUrl) {
                    window.location.href = this.data.launchUrl
                } else if (isAppleHandheld()) {
                    window.location.href = `${this.scheme}://link`
                }
            }

            const signManually = () => {
                context.ui?.prompt({
                    title: t('transact.sign_manually.title', {default: 'Sign manually'}),
                    body: t('transact.sign_manually.body', {
                        default:
                            'Scan the QR-code with WebAuth on another device or use the button to open it here.',
                    }),
                    elements: [
                        {
                            type: 'qr',
                            data: String(request),
                        },
                        {
                            type: 'link',
                            label: t('transact.sign_manually.link.title', {
                                default: 'Open WebAuth',
                            }),
                            data: {
                                href: String(sameDeviceRequest),
                                label: t('transact.sign_manually.link.title', {
                                    default: 'Open WebAuth',
                                }),
                            },
                        },
                    ],
                })
            }

            // Tell Wharf we need to prompt the user with a QR code and a button
            const promptPromise: Cancelable<PromptResponse> = context.ui.prompt({
                title: t('transact.title', {default: 'Complete using WebAuth'}),
                body: t('transact.body', {
                    channelName: this.data.channelName,
                    default: `Please open your WebAuth Wallet on "${this.data.channelName}" to review and approve this transaction.`,
                }),
                elements: [
                    {
                        type: 'countdown',
                        data: {
                            label: t('transact.await', {
                                default: 'Waiting for response from WebAuth',
                            }),
                            end: expiration.toISOString(),
                        },
                    },
                    {
                        type: 'button',
                        label: t('transact.label', {
                            default: 'Sign manually or with another device',
                        }),
                        data: {
                            onClick: isSameDevice
                                ? () =>
                                      (window.location.href = sameDeviceRequest.encode(
                                          true,
                                          true,
                                          `${this.scheme}:`
                                      ))
                                : signManually,
                            label: t('transact.label', {
                                default: 'Sign manually or with another device',
                            }),
                        },
                    },
                ],
            })

            // Create a timer to test the external cancelation of the prompt, if defined
            const timer = setTimeout(() => {
                if (!context.ui) {
                    throw new Error('No UI available')
                }
                promptPromise.cancel(
                    t('error.expired', {default: 'The request expired, please try again.'})
                )
            }, expiresIn)

            // Clear the timeout if the UI throws (which generally means it closed)
            promptPromise.catch(() => clearTimeout(timer))

            // Wait for the callback from the wallet
            const callbackPromise = waitForCallback(callback, this.buoyWs, t)

            // Assemble and send the payload to the wallet
            if (this.data.channelUrl) {
                const service = new URL(this.data.channelUrl).origin
                const channel = new URL(this.data.channelUrl).pathname.substring(1)
                const sealedMessage = sealMessage(
                    (this.data.sameDevice ? sameDeviceRequest : modifiedRequest).encode(
                        true,
                        false,
                        `${this.scheme}:`
                    ),
                    PrivateKey.from(this.data.privateKey),
                    PublicKey.from(this.data.signerKey)
                )

                send(Serializer.encode({object: sealedMessage}).array, {
                    service,
                    channel,
                })
            } else {
                // If no channel is defined, fallback to the same device request and trigger immediately
                window.location.href = sameDeviceRequest.encode(true, true, `${this.scheme}:`)
            }

            // Wait for either the callback or the prompt to resolve
            const callbackResponse = await Promise.race([callbackPromise, promptPromise]).finally(
                () => {
                    // Clear the automatic timeout once the race resolves
                    clearTimeout(timer)
                }
            )

            const wasSuccessful =
                isCallback(callbackResponse) &&
                extractSignaturesFromCallback(callbackResponse).length > 0

            if (wasSuccessful) {
                // If the callback was resolved, create a new request from the response
                const resolvedRequest = await ResolvedSigningRequest.fromPayload(
                    callbackResponse,
                    context.esrOptions
                )

                // Return the new request and the signatures from the wallet
                return {
                    signatures: extractSignaturesFromCallback(callbackResponse),
                    resolved: resolvedRequest,
                }
            }

            const errorString = t('error.not_completed', {
                default: 'The request was not completed.',
            })

            promptPromise.cancel(errorString)
        }

        // This shouldn't ever trigger, but just in case
        throw new Error(errorString)
    }

    private async loginWithBrowser(callback: Deferred<inBrowserPayload>) {
        if (this.browserTransport) {
            const data = await this.browserTransport.login()
            callback.resolve(data)
        }
    }
}
