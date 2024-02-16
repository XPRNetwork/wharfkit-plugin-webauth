import {CallbackPayload} from '@wharfkit/session'

export interface inBrowserPayload {
    inBrowser: {
        actor: string
        permission: string
    }
}

export function isInBrowserPayload(v: CallbackPayload | inBrowserPayload): v is inBrowserPayload {
    return (v as inBrowserPayload).inBrowser !== undefined
}
