# x402 AI Paywall

> One API suite for agent AI tools with pay-per-use on-chain payments.  
> Built for **OKX Build X Hackathon (Skill Arena)**.

Your agent should not need humans to manage API keys and billing for every tool.
This project gives agents a single, consistent interface: request a tool, sign one x402 payment, receive the result.

## What It Does

### Live endpoints

| Endpoint | Price | Output |
|---|---:|---|
| `POST /generate` | `0.05 USDC` | 1024×1024 image |
| `POST /generate-video` | `0.20 USDC` | 2s, 1280×720, 24fps video |
| `POST /swap-and-generate` | varies | pay with token input, auto-route to generation |

### Why agents use it

- No subscription lock-in
- No per-provider API-key setup
- Usage-based cost model (pay only when needed)
- Same payment/request pattern across tools

## Chain Support

**Primary:**
- X Layer (`eip155:196`) — gas-free and preferred path

**Also supported:**
- Base (`eip155:8453`)
- Ethereum (`eip155:1`)
- Arbitrum (`eip155:42161`)

Flow is compatible with **Uniswap AI** patterns for non-X Layer token/payment workflows.

## How the Flow Works

1. Agent calls endpoint (`/generate` or `/generate-video`)
2. Server returns `HTTP 402` + `PAYMENT-REQUIRED` header (x402 v2)
3. Agent signs payment with OnchainOS:
4. Agent replays request with `PAYMENT-SIGNATURE`
5. Server verifies payment and settles on-chain via EIP-3009 `transferWithAuthorization`
6. Server returns media URL + transaction reference

## Proof (On-Chain)

- Wallet: `0xe5a24a32eafa471845f658f95118dcdfcc9ecc2a`
- X Layer tx: https://www.okx.com/web3/explorer/xlayer/tx/0x54a6c05ad7dae2f32eaf1f4c6de923e3907a1608a29f3dbcabf255981ab5f0a5
- Base tx: `0x763e356071a4f1f3e3e1b9544e584a156d15572287d4037d6c68274920d62171`

## How Agents Call AgentAPI



1. Connect this repo in Railway
2. Set required env vars
3. Deploy

Live example:  
https://x402-image-paywall-production.up.railway.app

## Coming Next

Using the same pay-per-use rail:
- Speech-to-text / text-to-speech
- OCR + document parsing
- Detection/moderation endpoints
- Translation
- RAG + forecasting

## License

MIT
