# AgentAPI

> One API suite for agent AI tools with pay-per-use on-chain payments.  
> Built for **OKX Build X Hackathon (Skill Arena)**.

Your agent should not need humans to manage API keys and billing for every tool.
AgentAPI gives agents a single, consistent interface: request a tool, sign one x402 payment, receive the result.

## Live Endpoints

| Endpoint | Price | Output |
|---|---:|---|
| `POST /generate` | `0.05 USDC` | 1024×1024 image |
| `POST /generate-video` | `0.20 USDC` | 2s, 1280×720, 24fps video |
| `POST /swap-and-generate` | varies | pay with any token, auto-route to generation |

**Base URL:** `https://x402-image-paywall-production.up.railway.app`

## How Agents Call AgentAPI

### 1. Request the tool

```bash
curl -X POST https://x402-image-paywall-production.up.railway.app/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "a blue sunset over mountains"}'
```

### 2. Receive 402 Payment Required

The server responds with `HTTP 402` and payment requirements in headers:
- `PAYMENT-REQUIRED` — amount and token
- `PAYMENT-ACCEPT` — what the agent needs to sign

### 3. Sign payment with Agentic Wallet

```bash
onchainos payment x402-pay --accepts '<payload>'
```

### 4. Replay with payment signature

```bash
curl -X POST https://x402-image-paywall-production.up.railway.app/generate \
  -H "Content-Type: application/json" \
  -H "PAYMENT-SIGNATURE: <signature>" \
  -d '{"prompt": "a blue sunset over mountains"}'
```

### 5. Receive result

The server returns the media URL + on-chain transaction reference.

## Chain Support

**Primary:**
- X Layer (`eip155:196`) — gas-free and preferred

**Also supported:**
- Base (`eip155:8453`)
- Ethereum (`eip155:1`)
- Arbitrum (`eip155:42161`)

Flow is compatible with **Uniswap AI** patterns.

## On-Chain Proof

- Wallet: `0xe5a24a32eafa471845f658f95118dcdfcc9ecc2a`
- X Layer tx: https://www.okx.com/web3/explorer/xlayer/tx/0x54a6c05ad7dae2f32eaf1f4c6de923e3907a1608a29f3dbcabf255981ab5f0a5

## Self-Host Deployment

Want to run your own instance?

```bash
git clone https://github.com/EnjoyingClaw/agentapi.git
cd agentapi
npm install
cp .env.example .env
# Fill in EDEN_AI_KEY, WALLET_ADDRESS, SERVER_PRIVATE_KEY
npm start
```

## Coming Next

- Speech-to-text / text-to-speech
- OCR + document parsing
- Detection/moderation
- Translation
- RAG + forecasting

## License

MIT
