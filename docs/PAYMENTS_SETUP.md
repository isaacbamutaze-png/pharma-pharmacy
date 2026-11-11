# Live payments + AI: setup guide

PHARMA never holds payment secrets. The app talks to a small **payments server** (`/server`) that
asks Flutterwave / PayPal directly and only reports **SUCCESS** after the provider confirms the
payment for the right amount and currency.

```
Cashier taps MTN/Airtel ──▶ PHARMA app ──▶ payments server ──▶ Flutterwave ──▶ customer's phone
                                                  ▲                               (PIN prompt)
         app polls every 3s  ◀──── verified status ┴── webhook + direct verify ◀── provider
```

| Customer action | Result in PHARMA |
|---|---|
| Enters PIN, has enough money | **SUCCESS**: money goes to your account, sale completes |
| Wrong PIN / insufficient funds | **FAILED** (reason shown) |
| Refuses the prompt | **DECLINED** |
| Does nothing for ~4 min | **TIMEOUT / EXPIRED**; a late approval is still recovered by re-checking |
| Pays less than the amount | **FAILED** (amount mismatch), never accepted |

## 1. Deploy the server (Render, free)
1. Render dashboard > **New > Blueprint** > pick this repo (it reads `render.yaml`).
2. Set the secrets it asks for (below). Render generates `PHARMA_API_KEY` and `FLW_SECRET_HASH` for you.
3. Set `PUBLIC_BASE_URL` to the service URL, e.g. `https://pharma-payments.onrender.com`.
4. Free instances sleep when idle; the first payment after a quiet period takes ~30 s to wake. Use a paid
   instance or a keep-alive ping on `/health` for a busy shop.
5. The free disk is temporary. That is fine: the provider is always the source of truth.

## 2. Flutterwave (MTN, Airtel, card, bank)
1. Create a Flutterwave business account, complete verification, enable **Uganda Mobile Money**.
2. Dashboard > Settings > API: copy the **Secret key** into `FLW_SECRET_KEY` (use `FLWSECK_TEST-...` first).
3. Dashboard > Settings > Webhooks: URL `https://<your-server>/webhooks/flutterwave`,
   **Secret hash** = the `FLW_SECRET_HASH` value. Tick "Receive webhooks".
4. Test with sandbox, then switch to the live secret key.

## 3. PayPal
1. developer.paypal.com > Apps & Credentials > create an app: copy Client ID/Secret to
   `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`. `PAYPAL_ENV=sandbox` for tests, `live` for real money.
2. PayPal cannot charge UGX, so PHARMA converts at `PAYPAL_UGX_PER_USD` (update it to the current rate).
3. Optional: add a webhook to `https://<your-server>/webhooks/paypal` (events `PAYMENT.CAPTURE.COMPLETED`)
   and put its id in `PAYPAL_WEBHOOK_ID`.

## 4. AI assistant (online mode)
Set `ANTHROPIC_API_KEY` on the server. The assistant then answers in natural language when online;
**offline it automatically uses the built-in engine** on the device. It can read but never change records.

## 5. Connect the app
Open PHARMA as admin > **Settings > Payments Server**: enter the server URL and the `PHARMA_API_KEY` value,
press **Test connection** (green ticks show what is configured), then **Save**.
For a fleet of devices you can instead bake the defaults in with `VITE_PAYMENTS_SERVER_URL` and
`VITE_PAYMENTS_SERVER_KEY` at build time (Netlify > Site settings > Environment).

## Testing without real money
Settings > Payment Gateways > set a provider's **Mode** to *Demo simulation*. That uses the old
simulator and is clearly labelled; live mode never simulates.

## Run the server tests
`node server/test/run.mjs` (mock Flutterwave/PayPal/AI, no network, no dependencies).
