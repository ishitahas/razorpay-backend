# Razorpay Minimal Backend

Node.js + Express backend with Razorpay integration:

- Order creation (`POST /api/orders`)
- Payment signature verification (`POST /api/payments/verify`)
- Callback (redirect) signature verification (`POST /api/payments/callback`)
- Webhook signature verification (`POST /api/webhook`)
- Order status lookup (`GET /api/orders/:id`)

## Setup

```bash
npm install
cp .env.example .env     # then fill in your Razorpay TEST keys
npm start
```

Open http://localhost:3000, enter an amount and pay using Razorpay test credentials
(e.g. test card `4111 1111 1111 1111`, any future expiry, any CVV, OTP `1234` where asked, or test UPI `success@razorpay`).

## Running without a Razorpay account (mock mode)

Set `MOCK_MODE=true` in `.env` (see `.env.example`, Option B). Orders are then created locally
instead of calling Razorpay, and the signature verification code is exactly the same.
With the server running, in a second terminal run:

```bash
node test-verify.js
```

It creates an order, sends a correctly signed payment (accepted) and a tampered one (rejected).
For the real integration set `MOCK_MODE=false` and use Razorpay Test Mode keys.

## How signature verification works

| Flow | Signature = HMAC-SHA256 of | Secret |
|------|----------------------------|--------|
| Payment / callback | `razorpay_order_id + "|" + razorpay_payment_id` | `RAZORPAY_KEY_SECRET` |
| Webhook | raw request body | `RAZORPAY_WEBHOOK_SECRET` |

The server recomputes the HMAC and compares it with the received signature using a
constant-time comparison (`crypto.timingSafeEqual`). An order is marked `paid` only if it matches.

## API

| Method | Route | Body | Purpose |
|--------|-------|------|---------|
| POST | `/api/orders` | `{ "amount": 100 }` (INR) | Create Razorpay order |
| POST | `/api/payments/verify` | `razorpay_order_id, razorpay_payment_id, razorpay_signature` | Verify checkout success |
| POST | `/api/payments/callback` | same (form-encoded) | Verify `callback_url` redirect flow |
| POST | `/api/webhook` | Razorpay event JSON | Verify webhook + mark paid |
| GET | `/api/orders/:id` | - | Order status |

## Webhook (optional)

Expose your local server with a tunnel (e.g. ngrok), add `https://<tunnel>/api/webhook` in
Razorpay Dashboard -> Settings -> Webhooks, enable `payment.captured` / `order.paid`,
and put the webhook secret in `.env`.
