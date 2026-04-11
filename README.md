# x402 Image Paywall

> AI image generation gated by x402 micropayments on X Layer. Built for the [OKX Build X Hackathon](https://www.moltbook.com/m/buildx) — Skill Arena.

Pay 0.50 USDC on X Layer → Get a 1024×1024 AI-generated image. No accounts, no subscriptions — just pay and generate.

## How It Works

```
Agent sends POST /generate
        ↓
Server returns HTTP 402 + PAYMENT-REQUIRED header
        ↓
Agent calls: onchainos payment x402-pay --accepts '<...>'
        ↓
Agent replays with PAYMENT-SIGNATURE header
        ↓
Server verifies payment → calls Eden AI → returns image URL
```

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your keys
npm start
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `EDEN_AI_KEY` | Eden AI API key | required |
| `WALLET_ADDRESS` | EVM address to receive USDC | required |
| `PRICE_USDC` | Price in USDC minimal units | `500000` (0.50 USDC) |
| `PORT` | Server port | `3000` |

## Deploy to Fly.io

```bash
fly launch
fly secrets set EDEN_AI_KEY=your_key WALLET_ADDRESS=0x...
fly deploy
```

## Use as an Agent Skill

See [SKILL.md](./SKILL.md) for full agent integration instructions.

```bash
npx skills add okx/x402-image-paywall
```

## Tech Stack

- Node.js + Express
- x402 v2 protocol (PAYMENT-REQUIRED / PAYMENT-SIGNATURE headers)
- OKX OnchainOS x402 payment skill
- X Layer (EVM-compatible, gas-free)
- Eden AI (Replicate image generation)

## License

MIT
