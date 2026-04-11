require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { ethers } = require('ethers');

// X Layer RPC
const XLAYER_RPC = 'https://rpc.xlayer.tech';
const provider = new ethers.JsonRpcProvider(XLAYER_RPC);

// Server wallet (submits redemption txs on-chain)
const SERVER_PRIVATE_KEY = process.env.SERVER_PRIVATE_KEY;
const serverWallet = SERVER_PRIVATE_KEY ? new ethers.Wallet(SERVER_PRIVATE_KEY, provider) : null;

// USDC EIP-3009 transferWithAuthorization ABI
const USDC_ABI = [
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes calldata signature) external',
  'function balanceOf(address) view returns (uint256)'
];

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS || '0xe5a24a32eafa471845f658f95118dcdfcc9ecc2a';
const PRICE_USDC = process.env.PRICE_USDC || '500000'; // 0.50 USDC (6 decimals)
const EDEN_AI_KEY = process.env.EDEN_AI_KEY;
const USDC_X_LAYER = '0x74b7f16337b8972027f6196a17a631ac6de26d22';

// Build x402 v2 payment required payload
function buildPaymentRequired(host) {
  return {
    x402Version: 2,
    error: 'Payment required to generate image',
    resource: {
      url: `http://${host}/generate`,
      description: 'AI Image Generation — 1 image (1024x1024) via Replicate',
      mimeType: 'application/json'
    },
    accepts: [
      {
        scheme: 'exact',
        network: 'eip155:196',
        amount: PRICE_USDC,
        payTo: WALLET_ADDRESS,
        asset: USDC_X_LAYER,
        maxTimeoutSeconds: 300,
        extra: { name: 'USD Coin', version: '2' }
      }
    ]
  };
}

// Verify payment signature header
function verifyPayment(paymentHeader) {
  try {
    const decoded = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'));
    const accepted = decoded.accepted;
    const authorization = decoded.payload?.authorization;

    if (!accepted || !authorization) return { valid: false, reason: 'Missing accepted or authorization' };
    if (accepted.payTo?.toLowerCase() !== WALLET_ADDRESS.toLowerCase())
      return { valid: false, reason: 'Payment sent to wrong address' };
    if (BigInt(accepted.amount) < BigInt(PRICE_USDC))
      return { valid: false, reason: 'Insufficient payment amount' };
    if (parseInt(authorization.validBefore) < Math.floor(Date.now() / 1000))
      return { valid: false, reason: 'Payment authorization expired' };

    console.log(`✅ Payment verified — from: ${authorization.from}, amount: ${accepted.amount}, scheme: ${accepted.scheme}`);
    return { valid: true, from: authorization.from };
  } catch (e) {
    return { valid: false, reason: 'Invalid payment header: ' + e.message };
  }
}

// Generate image via Eden AI
async function generateImage(prompt) {
  const response = await axios.post(
    'https://api.edenai.run/v3/universal-ai/',
    {
      model: 'image/generation/replicate/classic',
      input: { num_images: 1, resolution: '1024x1024', text: prompt },
      show_original_response: false
    },
    {
      headers: {
        Authorization: `Bearer ${EDEN_AI_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    }
  );

  // Extract image URL from response
  const output = response.data?.output;
  if (output?.items?.[0]?.image_resource_url) return output.items[0].image_resource_url;
  if (output?.items?.[0]?.image) return output.items[0].image;
  if (Array.isArray(output) && output[0]?.image_resource_url) return output[0].image_resource_url;

  throw new Error('Could not extract image URL from Eden AI response: ' + JSON.stringify(output));
}

// Health check
app.get('/health', (req, res) => res.json({ ok: true }));

// Demo page
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>x402 Image Paywall — OKX Build X</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 40px 20px; }
    h1 { font-size: 2rem; margin-bottom: 8px; background: linear-gradient(135deg, #6366f1, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .subtitle { color: #888; margin-bottom: 40px; font-size: 0.95rem; }
    .flow { display: flex; gap: 12px; margin-bottom: 40px; flex-wrap: wrap; justify-content: center; }
    .step { background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 12px; padding: 16px 20px; font-size: 0.85rem; text-align: center; max-width: 160px; }
    .step .num { background: #6366f1; color: white; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; margin: 0 auto 8px; font-weight: bold; }
    .arrow { color: #444; font-size: 1.5rem; display: flex; align-items: center; }
    .card { background: #111; border: 1px solid #222; border-radius: 16px; padding: 32px; width: 100%; max-width: 520px; }
    .price-tag { background: #1a1a2e; border: 1px solid #6366f1; border-radius: 8px; padding: 10px 16px; margin-bottom: 24px; font-size: 0.9rem; color: #a5b4fc; text-align: center; }
    label { display: block; margin-bottom: 8px; font-size: 0.9rem; color: #aaa; }
    textarea { width: 100%; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; color: #e0e0e0; padding: 12px; font-size: 0.95rem; resize: vertical; min-height: 80px; }
    button { width: 100%; margin-top: 16px; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; border: none; border-radius: 8px; padding: 14px; font-size: 1rem; font-weight: 600; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    #status { margin-top: 16px; padding: 12px; border-radius: 8px; font-size: 0.85rem; display: none; }
    #status.info { background: #1a1a2e; border: 1px solid #3a3a6e; color: #a5b4fc; }
    #status.error { background: #2a1a1a; border: 1px solid #6e3a3a; color: #f87171; }
    #result { margin-top: 20px; display: none; }
    #result img { width: 100%; border-radius: 12px; border: 1px solid #333; }
    .chain-badge { display: inline-block; background: #0f2027; border: 1px solid #00d4ff33; color: #00d4ff; border-radius: 6px; padding: 2px 8px; font-size: 0.75rem; margin-left: 8px; }
    .skill-box { margin-top: 32px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 16px; font-size: 0.8rem; color: #8b949e; max-width: 520px; width: 100%; }
    .skill-box code { background: #161b22; padding: 2px 6px; border-radius: 4px; color: #79c0ff; }
  </style>
</head>
<body>
  <h1>🎨 x402 Image Paywall</h1>
  <p class="subtitle">Pay 0.50 USDC on X Layer → Get AI-generated image <span class="chain-badge">X Layer</span></p>

  <div class="flow">
    <div class="step"><div class="num">1</div>Send prompt</div>
    <div class="arrow">→</div>
    <div class="step"><div class="num">2</div>Receive 402 + payment details</div>
    <div class="arrow">→</div>
    <div class="step"><div class="num">3</div>Pay 0.50 USDC on X Layer</div>
    <div class="arrow">→</div>
    <div class="step"><div class="num">4</div>Get your image!</div>
  </div>

  <div class="card">
    <div class="price-tag">💳 0.50 USDC per image · Settled on X Layer (gas free)</div>
    <label for="prompt">Image prompt</label>
    <textarea id="prompt" placeholder="A futuristic city at sunset with flying cars..."></textarea>
    <button id="btn" onclick="generate()">🔐 Pay & Generate</button>
    <div id="status"></div>
    <div id="result"><img id="img" src="" alt="Generated image" /></div>
  </div>

  <div class="skill-box">
    <strong>🤖 For AI Agents:</strong> Install this skill:<br>
    <code>npx skills add okx/x402-image-paywall</code><br><br>
    Or call the API directly — send <code>POST /generate</code>, handle the <code>402</code> with <code>onchainos payment x402-pay</code>, then replay with <code>PAYMENT-SIGNATURE</code> header.
  </div>

  <script>
    async function generate() {
      const prompt = document.getElementById('prompt').value.trim();
      if (!prompt) return alert('Enter a prompt first');
      const btn = document.getElementById('btn');
      const status = document.getElementById('status');
      const result = document.getElementById('result');
      btn.disabled = true;
      result.style.display = 'none';
      setStatus('info', '⏳ Sending request...');

      try {
        // Step 1: send without payment
        const r1 = await fetch('/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
        if (r1.status === 402) {
          const payHeader = r1.headers.get('payment-required');
          const payInfo = JSON.parse(atob(payHeader));
          const price = (parseInt(payInfo.accepts[0].amount) / 1e6).toFixed(2);
          setStatus('info', \`💳 Payment required: \${price} USDC on X Layer. In a real agent flow, onchainos payment x402-pay handles this automatically. (Demo: this page simulates the 402 flow)\`);
          btn.disabled = false;
          return;
        }
        if (!r1.ok) throw new Error(await r1.text());
        const data = await r1.json();
        document.getElementById('img').src = data.image_url;
        result.style.display = 'block';
        setStatus('info', '✅ Image generated!');
      } catch (e) {
        setStatus('error', '❌ ' + e.message);
      }
      btn.disabled = false;
    }

    function setStatus(type, msg) {
      const el = document.getElementById('status');
      el.className = type;
      el.textContent = msg;
      el.style.display = 'block';
    }
  </script>
</body>
</html>`);
});

// Main generate endpoint
app.post('/generate', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const paymentHeader = req.headers['payment-signature'];

  // No payment header → return 402
  if (!paymentHeader) {
    const payload = buildPaymentRequired(req.get('host') || `localhost:${PORT}`);
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
    res.setHeader('PAYMENT-REQUIRED', encoded);
    res.setHeader('Content-Type', 'application/json');
    return res.status(402).json({});
  }

  // Verify payment
  const verification = verifyPayment(paymentHeader);
  if (!verification.valid) {
    return res.status(402).json({ error: 'Invalid payment', reason: verification.reason });
  }

  // Redeem payment on-chain (transferWithAuthorization)
  let txHash = null;
  if (serverWallet) {
    try {
      const paymentData = JSON.parse(Buffer.from(paymentHeader, 'base64').toString());
      const auth = paymentData.payload.authorization;
      const sig = paymentData.payload.signature;
      const usdc = new ethers.Contract(USDC_X_LAYER, USDC_ABI, serverWallet);
      console.log(`⛓️  Submitting transferWithAuthorization on X Layer...`);
      console.log(`   from: ${auth.from}, to: ${auth.to}, value: ${auth.value}`);
      const tx = await usdc.transferWithAuthorization(
        auth.from,
        auth.to,
        BigInt(auth.value),
        BigInt(auth.validAfter),
        BigInt(auth.validBefore),
        auth.nonce,
        sig
      );
      console.log(`⛓️  Tx submitted: ${tx.hash}`);
      const receipt = await tx.wait();
      txHash = receipt.hash;
      console.log(`✅ Tx confirmed: ${txHash}`);
    } catch (err) {
      console.error('On-chain redemption failed (proceeding anyway):', err.message);
    }
  }

  // Generate image
  try {
    console.log(`🎨 Generating image for prompt: "${prompt}"`);
    const imageUrl = await generateImage(prompt);
    res.json({
      success: true,
      image_url: imageUrl,
      prompt,
      paid_by: verification.from,
      network: 'X Layer (eip155:196)',
      amount_usdc: (parseInt(PRICE_USDC) / 1e6).toFixed(2),
      ...(txHash && { tx_hash: txHash, explorer: `https://www.okx.com/web3/explorer/xlayer/tx/${txHash}` })
    });
  } catch (err) {
    console.error('Image generation error:', err.message);
    res.status(500).json({ error: 'Image generation failed', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 x402 Image Paywall running on port ${PORT}`);
  console.log(`💳 Price: ${parseInt(PRICE_USDC) / 1e6} USDC per image`);
  console.log(`👛 Wallet: ${WALLET_ADDRESS}`);
  console.log(`🔗 Network: X Layer (eip155:196)`);
});
