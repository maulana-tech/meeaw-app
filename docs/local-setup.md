# Local Setup

Run Mawee on your machine against Monad testnet, from a fresh clone to signing
in on the dashboard. Plan on about 20 minutes.

Without this setup the landing page still renders, but **Create your payment
link** cannot sign you in: sign-in needs Privy, accounts need MongoDB, and
payments need deployed contracts.

## What you need

| Requirement | Why | Where |
| --- | --- | --- |
| Node 20+ and pnpm 10+ | Runs the app and the deploy script | [nodejs.org](https://nodejs.org), `npm i -g pnpm` |
| Docker (or a MongoDB Atlas cluster) | Stores accounts and payment links | [docker.com](https://www.docker.com) |
| A Privy app | Email/Google sign-in and the embedded wallet | [dashboard.privy.io](https://dashboard.privy.io) |
| A **new** test wallet with MON | Pays gas to deploy the contracts | [faucet.monad.xyz](https://faucet.monad.xyz) |

{% hint style="warning" %}
Use a throwaway wallet for every private key in this guide. Never use a wallet
that holds real funds, and never commit or share `web/.env.local`.
{% endhint %}

## 1. Install dependencies

```sh
git clone <repo-url> mawee-app
cd mawee-app
pnpm install
```

## 2. Start MongoDB

The quickest option is a local container:

```sh
docker run -d --name mawee-mongo -p 27017:27017 mongo:7
```

It keeps running in the background. Later, start it again with
`docker start mawee-mongo`.

To use MongoDB Atlas instead, create a free cluster and copy its connection
string for step 4.

## 3. Create a Privy app

1. Sign in at [dashboard.privy.io](https://dashboard.privy.io) and create an
   app.
2. **Login methods:** turn on Email and/or Google.
3. **Embedded wallets:** turn on Ethereum wallets and set them to be created on
   login for users without a wallet.
4. **Allowed origins:** add `http://localhost:3000`.
5. From **App settings**, copy the **App ID** (exactly 25 characters) and the
   **App secret**.

## 4. Create `web/.env.local`

```sh
cp web/.env.example web/.env.local
```

Open `web/.env.local` and fill in:

```sh
NEXT_PUBLIC_PRIVY_APP_ID=<your Privy app id>
PRIVY_APP_ID=<your Privy app id>
PRIVY_APP_SECRET=<your Privy app secret>

# Local container from step 2 (keep the default) or your Atlas string.
MONGODB_URI=mongodb://localhost:27017/mawee

# Any long random string, e.g. the output of `openssl rand -hex 32`.
CRON_SECRET=<random string>
```

Leave the contract addresses empty. The next step fills them in.

## 5. Deploy the contracts to Monad testnet

1. Create a new wallet in MetaMask or Rabby and copy its private key.
2. Get testnet MON for it at [faucet.monad.xyz](https://faucet.monad.xyz).
3. Deploy:

```sh
cd contracts
DEPLOYER_PRIVATE_KEY=0x<test wallet key> pnpm deploy:testnet
cd ..
```

The script deploys the Poseidon library, the three Groth16 verifiers,
`MaweeRegistry`, `MaweePool`, and a `MockUSDC` that anyone can mint. It then
writes these values into `web/.env.local` for you:

- `NEXT_PUBLIC_MAWEE_REGISTRY_ADDRESS`
- `NEXT_PUBLIC_MAWEE_POOL_ADDRESS`
- `NEXT_PUBLIC_MAWEE_POOL_DEPLOY_BLOCK`
- `NEXT_PUBLIC_USDC_ADDRESS`, `NEXT_PUBLIC_USDC_DECIMALS`,
  `NEXT_PUBLIC_USDC_MINTABLE`

It also updates the addresses and start block in `indexer/config.yaml`.

Typing the key inline keeps it out of any file. It is still saved in your shell
history, so use a test wallet only.

## 6. Prepare the database and start the app

```sh
pnpm --filter web migrate:up
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). If the dev server was
already running, restart it: Next.js reads `.env.local` only at startup.

## 7. Sign in and try a payment

1. Click **Create your payment link** and sign in with Privy.
2. Pick a username, for example `dinar`.
3. Protect your keys with a **passkey** (recommended) or a **6-digit PIN**.
4. On the dashboard, open **Add funds** and mint test USDC.
5. Open `http://localhost:3000/pay/<username>` in another browser or a private
   window, connect a different wallet, and pay.
6. Back on your dashboard, the payment appears in your private balance.
   **Withdraw** sends it to any Monad address.

## Optional extras

### Gasless mode

With a relayer, payers and recipients only sign; the relayer submits each
transaction and pays the MON gas.

```sh
# A second throwaway wallet funded from the faucet. Keep its balance small.
RELAYER_PRIVATE_KEY=0x<relayer key>

# Optional dedicated RPC, e.g. Alchemy.
RELAYER_RPC_URL=https://monad-testnet.g.alchemy.com/v2/<your key>
```

When `RELAYER_PRIVATE_KEY` is empty, each user pays their own gas, which is
fine for local testing.

### Envio indexer

When `ENVIO_GRAPHQL_URL` is empty, the app reads pool events straight from the
Monad RPC and caches them in MongoDB. To use Envio HyperIndex instead, deploy
`indexer/` (see [indexer/README.md](../indexer/README.md)) and set:

```sh
ENVIO_GRAPHQL_URL=https://<your envio endpoint>/v1/graphql
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Sign-in popup errors or never opens | Check `NEXT_PUBLIC_PRIVY_APP_ID` is the 25-character App ID and `http://localhost:3000` is an allowed origin in Privy. Restart `pnpm dev`. |
| `MongoServerSelectionError` or `ECONNREFUSED 27017` | MongoDB is not running. Run `docker start mawee-mongo`. |
| Deploy fails with `insufficient funds` | The deployer wallet has no MON. Use the faucet and retry. |
| `Privy server credentials are not configured.` | Set `PRIVY_APP_ID` and `PRIVY_APP_SECRET` (server-only, no `NEXT_PUBLIC_` prefix) and restart `pnpm dev`. |
| Payments or Add funds fail right after deploying | The deploy did not write the addresses. Confirm `NEXT_PUBLIC_MAWEE_POOL_ADDRESS` and `NEXT_PUBLIC_USDC_ADDRESS` are set in `web/.env.local`, then restart `pnpm dev`. |
| Changes to `.env.local` have no effect | Restart `pnpm dev`. |
| A payment does not appear right away | Wait a few seconds and refresh. The pool cache resyncs on its own. |

## Reference

Every variable is described in [web/.env.example](../web/.env.example) and the
[Developer Reference](reference.md).
