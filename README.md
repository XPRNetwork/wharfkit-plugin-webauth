# @proton/wallet-plugin-webauth

A Session Kit wallet plugin for the [WebAuth](https://xprnetwork.org/wallet) wallet.

## Usage

Include this wallet plugin while initializing the SessionKit.

Mobile device and browser authentications are supported

**NOTE**: This wallet plugin will only work with the SessionKit and requires a browser-based environment.

```ts
import {WalletPluginWebAuth} from '@proton/wallet-plugin-webauth'

const kit = new SessionKit({
    // ... your other options
    walletPlugins: [new WalletPluginWebAuth()],
})
```

Main and test networks are supported

```ts

import {WalletPluginWebAuth} from '@proton/wallet-plugin-webauth'

const kit = new SessionKit({
    // ... your other options
    walletPlugins: [
        new WalletPluginWebAuth({
            scheme: 'proton-dev' // 'esr' | 'proton' | 'proton-dev'
        }),
    ],
    })
```

Custom buoy url and websocket class are supported.

```ts
import WebSocket from 'isomorphic-ws'
import {WalletPluginWebAuth} from '@proton/wallet-plugin-webauth'

const kit = new SessionKit({
    // ... your other options
    walletPlugins: [
        new WalletPluginWebAuth({
            buoyUrl: 'https://cb.anchor.link',
            buoyWs: Websocket,
        }),
    ],
    })
```

## Example

You can find working example in `examples` folder

## Developing

You need [Make](https://www.gnu.org/software/make/), [node.js](https://nodejs.org/en/) and [yarn](https://classic.yarnpkg.com/en/docs/install) installed.

Clone the repository and run `make` to checkout all dependencies and build the project. See the [Makefile](./Makefile) for other useful targets. Before submitting a pull request make sure to run `make lint`.
