import { ReceiveOptions } from '@greymass/buoy'
import { v4 as uuid } from 'uuid'
import zlib from 'pako'
import { ChainId, LinkChain, LinkCreate, SigningRequest } from '@proton/link'
import { LoginContext, PrivateKey, PublicKey } from '@wharfkit/session'

export interface IdentityRequestResponse {
    callback
    request: SigningRequest
    requestKey: PublicKey
    privateKey: PrivateKey
}

export function getUserAgent(): string {
    const version = '__ver'
    let agent = `AnchorLink/${version}`
    if (typeof navigator !== 'undefined') {
        agent += ` BrowserTransport/${version} ` + navigator.userAgent
    }
    return agent
}

function prepareCallbackChannel(buoyUrl): ReceiveOptions {
    return {
        service: buoyUrl,
        channel: uuid(),
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

    const createInfo = LinkCreate.from({
        session_name: String(context.appName),
        request_key: requestKey,
        user_agent: getUserAgent(),
    })
    
    // Create the callback
    const callbackChannel = prepareCallbackChannel(buoyUrl)

    const isMultiChain = !(context.chain || context.chains.length === 1)
    let request: SigningRequest;
    let lchain: LinkChain;
    if (!isMultiChain) {
        const c = context.chain || context.chains[0]
        const a = ChainId.from(c.id as any);
        lchain = new LinkChain(a, c.url)
        request = await SigningRequest.create(
            {
                identity: {
                    permission: undefined,
                },
                info: {
                    link: createInfo,
                    scope: String(context.appName),
                },
                chainId: lchain.chainId,
                broadcast: false,
            },
            {abiProvider: lchain, zlib, scheme: 'proton-dev'}
        )
    } else {
        // multi-chain request
        lchain = new LinkChain(ChainId.from(context.chains[0].id as any), context.chains[0].url)
        request = await SigningRequest.create(
            {
                identity: { 
                    permission: undefined,
                },
                info: {
                    link: createInfo,
                    scope: String(context.appName),
                },
                chainId: null,
                chainIds: context.chains.map((c) =>  ChainId.from(c.id as any)),
                broadcast: false,
            },
            // abi's will be pulled from the first chain and assumed to be identical on all chains
            {abiProvider: lchain, zlib, scheme: 'proton-dev'}
        )
    }
    
    request.setInfoKey('req_account', String(context.appName));
    request.setCallback(`${callbackChannel.service}/${callbackChannel.channel}`, true)

    // Return the request and the callback data
    return {
        callback: callbackChannel,
        request,
        requestKey,
        privateKey,
    }
}