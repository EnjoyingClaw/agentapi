---
name: x402-image-paywall
version: 1.0.0
description: "Use this skill to generate AI images behind an x402 paywall on X Layer. Trigger on: generate image, pay for image, x402 image, AI image generation, image paywall, buy image, USDC image."
homepage: https://github.com/EnjoyingClaw/x402-image-paywall
---

# x402 Image Paywall

Generate AI images by paying 0.50 USDC on X Layer using the x402 payment protocol.
Built for the OKX Build X Hackathon — Skill Arena track.

**Hosted API:** `https://x402-image-paywall-production.up.railway.app`  
**Price:** 0.05 USDC / image · 0.20 USDC / video  
**Networks:** X Layer (gas-free) · Ethereum · Base · Arbitrum  
**Uniswap compatible:** Use `pay-with-any-token` skill on Base/Ethereum/Arbitrum  

---

## Quick Start

### Step 1: Send a generate request (will return 402)

```bash
curl -X POST https://x402-image-paywall-production.up.railway.app/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "a futuristic city at sunset"}'
# → HTTP 402, PAYMENT-REQUIRED header contains payment details
```

### Step 2: Decode the payment requirement

```js
const payHeader = response.headers['payment-required'];
const decoded = JSON.parse(Buffer.from(payHeader, 'base64').toString());
// decoded.accepts contains payment options for X Layer
```

### Step 3: Pay using onchainos

Make sure you are logged in (`onchainos wallet status`), then:

```bash
onchainos payment x402-pay \
  --accepts '<paste decoded.accepts JSON here>'
# → returns { signature, authorization, sessionCert? }
```

### Step 4: Replay with payment proof

Assemble the PAYMENT-SIGNATURE header and replay:

```js
const accepted = decoded.accepts.find(a => a.scheme === 'aggr_deferred') || decoded.accepts[0];
if (sessionCert) accepted.extra = { ...accepted.extra, sessionCert };

const paymentPayload = {
  x402Version: 2,
  resource: decoded.resource,
  accepted,
  payload: { signature, authorization }
};

const headerValue = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');
```

```bash
curl -X POST https://x402-image-paywall-production.up.railway.app/generate \
  -H "Content-Type: application/json" \
  -H "PAYMENT-SIGNATURE: <headerValue>" \
  -d '{"prompt": "a futuristic city at sunset"}'
# → { "success": true, "image_url": "https://...", "prompt": "...", "amount_usdc": "0.50" }
```

---

## Payment Details

The 402 response includes accepts for all supported chains — pick the one that matches your wallet:

| Chain | Network | USDC Address | Gas |
|-------|---------|-------------|-----|
| X Layer | eip155:196 | `0x74b7f16337b8972027f6196a17a631ac6de26d22` | Free |
| Ethereum | eip155:1 | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | ~$0.50 |
| Base | eip155:8453 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | ~$0.001 |
| Arbitrum | eip155:42161 | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | ~$0.01 |

**Amount:** 50000 (= 0.05 USDC, 6 decimals) for images · 200000 (= 0.20 USDC) for video  
**Scheme:** `exact` (EIP-3009 transferWithAuthorization)  

### Paying with any token (Uniswap)

On Base, Ethereum, or Arbitrum, use the Uniswap `pay-with-any-token` skill to swap any token to USDC before paying:

```bash
npx skills add uniswap/uniswap-ai
# Then the skill handles: your token → USDC → PAYMENT-SIGNATURE automatically
```

---

## API Reference

### POST /generate

Generate an image. Requires x402 payment.

**Request:**
```json
{ "prompt": "your image description" }
```

**Without payment header → 402:**
- Status: `402`
- Header: `PAYMENT-REQUIRED: <base64 encoded payment details>`
- Body: `{}`

**With valid PAYMENT-SIGNATURE header → 200:**
```json
{
  "success": true,
  "image_url": "https://...",
  "prompt": "your image description",
  "paid_by": "0x...",
  "network": "X Layer (eip155:196)",
  "amount_usdc": "0.50"
}
```

### GET /health

```json
{ "ok": true }
```

---

## Self-Hosting

```bash
git clone https://github.com/EnjoyingClaw/x402-image-paywall
cd x402-image-paywall
cp .env.example .env   # fill in your keys
npm install
npm start
```

Required env vars:
- `EDEN_AI_KEY` — Eden AI API key
- `WALLET_ADDRESS` — Your EVM wallet to receive payments
- `PRICE_USDC` — Price in USDC minimal units (default: 500000 = 0.50 USDC)
- `PORT` — Server port (default: 3000)
