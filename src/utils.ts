import {ReceiveOptions} from '@greymass/buoy'
import {
    BuoySession,
    generateReturnUrl,
    getUserAgent,
    IdentityRequestResponse,
    prepareCallback,
    uuid,
} from '@wharfkit/protocol-esr'
import {Checksum256, LoginContext, PrivateKey, SigningRequest} from '@wharfkit/session'

export function checkMultiChain(context: LoginContext) {
    return !(context.chain || context.chains.length === 1)
}

export function getChainId(context: LoginContext): Checksum256 | undefined {
    if (checkMultiChain(context)) {
        return context.chains[0].id
    } else {
        return context.chain?.id
    }
}

/**
 * createIdentityRequest
 *
 * @param context LoginContext
 * @returns
 */
export async function createIdentityRequest(
    context: LoginContext,
    buoyUrl: string
): Promise<IdentityRequestResponse> {
    // Create a new private key and public key to act as the request key
    const privateKey = PrivateKey.generate('K1')
    const requestKey = privateKey.toPublic()

    // Create a new BuoySession struct to be used as the info field
    const createInfo = BuoySession.from({
        session_name: String(context.appName),
        request_key: requestKey,
        user_agent: getUserAgent(),
    })

    // Determine based on the options whether this is a multichain request
    const isMultiChain = checkMultiChain(context)

    // Create the callback
    const callbackChannel = prepareCallbackChannel(buoyUrl)

    // Create the request
    const request = SigningRequest.createSync(
        {
            callback: prepareCallback(callbackChannel),
            chainId: isMultiChain ? null : context.chain?.id,
            chainIds: isMultiChain ? context.chains.map((c) => c.id) : undefined,
            info: {
                link: createInfo,
                scope: String(context.appName),
            },
            identity: {
                permission: undefined,
            },
            broadcast: false,
        },
        context.esrOptions
    )

    request.setInfoKey('req_account', String(context.appName))

    const sameDeviceRequest = request.clone()
    const returnUrl = generateReturnUrl()
    sameDeviceRequest.setInfoKey('same_device', true)
    sameDeviceRequest.setInfoKey('return_path', returnUrl)

    // Return the request and the callback data
    return {
        callback: callbackChannel,
        request,
        requestKey,
        privateKey,
        sameDeviceRequest,
    }
}

export class Deferred<T> {
    promise: Promise<T>
    reject: any
    resolve!: (value: T | PromiseLike<T>) => void

    constructor() {
        this.promise = new Promise<T>((resolve, reject) => {
            this.reject = reject
            this.resolve = resolve
        })
    }
}

function prepareCallbackChannel(buoyUrl): ReceiveOptions {
    return {
        service: buoyUrl,
        channel: uuid(),
    }
}

export function isAndroid(): boolean {
    return /Android/.test(navigator.userAgent)
}
