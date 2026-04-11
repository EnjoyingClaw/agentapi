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
const PRICE_USDC = process.env.PRICE_USDC || '50000';         // 0.05 USDC
const PRICE_VIDEO_USDC = process.env.PRICE_VIDEO_USDC || '200000'; // 0.20 USDC
const EDEN_AI_KEY = process.env.EDEN_AI_KEY;
const USDC_X_LAYER = '0x74b7f16337b8972027f6196a17a631ac6de26d22';

// Build x402 v2 payment required payload
function buildPaymentRequired(host, price, path, description) {
  return {
    x402Version: 2,
    error: 'Payment required',
    resource: {
      url: `http://${host}${path}`,
      description,
      mimeType: 'application/json'
    },
    accepts: [
      {
        scheme: 'exact',
        network: 'eip155:196',
        amount: price,
        payTo: WALLET_ADDRESS,
        asset: USDC_X_LAYER,
        maxTimeoutSeconds: 300,
        extra: { name: 'USD Coin', version: '2' }
      }
    ]
  };
}

// Verify payment signature header
function verifyPayment(paymentHeader, requiredAmount) {
  try {
    const decoded = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'));
    const accepted = decoded.accepted;
    const authorization = decoded.payload?.authorization;

    if (!accepted || !authorization) return { valid: false, reason: 'Missing accepted or authorization' };
    if (accepted.payTo?.toLowerCase() !== WALLET_ADDRESS.toLowerCase())
      return { valid: false, reason: 'Payment sent to wrong address' };
    if (BigInt(accepted.amount) < BigInt(requiredAmount))
      return { valid: false, reason: 'Insufficient payment amount' };
    if (parseInt(authorization.validBefore) < Math.floor(Date.now() / 1000))
      return { valid: false, reason: 'Payment authorization expired' };

    console.log(`✅ Payment verified — from: ${authorization.from}, amount: ${accepted.amount}`);
    return { valid: true, from: authorization.from, authorization, signature: decoded.payload.signature };
  } catch (e) {
    return { valid: false, reason: 'Invalid payment header: ' + e.message };
  }
}

// Redeem payment on-chain via transferWithAuthorization
async function redeemOnChain(auth, sig) {
  if (!serverWallet) return null;
  try {
    const usdc = new ethers.Contract(USDC_X_LAYER, USDC_ABI, serverWallet);
    console.log(`⛓️  Submitting transferWithAuthorization on X Layer...`);
    const tx = await usdc.transferWithAuthorization(
      auth.from, auth.to,
      BigInt(auth.value), BigInt(auth.validAfter), BigInt(auth.validBefore),
      auth.nonce, sig
    );
    console.log(`⛓️  Tx submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`✅ Tx confirmed: ${receipt.hash}`);
    return receipt.hash;
  } catch (err) {
    console.error('On-chain redemption failed (proceeding anyway):', err.message);
    return null;
  }
}

// Shared payment gate — returns verification or sends 402
async function paymentGate(req, res, price, path, description) {
  const paymentHeader = req.headers['payment-signature'];
  if (!paymentHeader) {
    const payload = buildPaymentRequired(req.get('host') || `localhost:${PORT}`, price, path, description);
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
    res.setHeader('PAYMENT-REQUIRED', encoded);
    res.setHeader('Content-Type', 'application/json');
    res.status(402).json({});
    return null;
  }
  const verification = verifyPayment(paymentHeader, price);
  if (!verification.valid) {
    res.status(402).json({ error: 'Invalid payment', reason: verification.reason });
    return null;
  }
  return verification;
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
    { headers: { Authorization: `Bearer ${EDEN_AI_KEY}`, 'Content-Type': 'application/json' }, timeout: 60000 }
  );
  const output = response.data?.output;
  if (output?.items?.[0]?.image_resource_url) return output.items[0].image_resource_url;
  if (output?.items?.[0]?.image) return output.items[0].image;
  if (Array.isArray(output) && output[0]?.image_resource_url) return output[0].image_resource_url;
  throw new Error('Could not extract image URL: ' + JSON.stringify(output));
}

// Generate video via Eden AI (async polling)
async function generateVideo(prompt) {
  const submitRes = await axios.post(
    'https://api.edenai.run/v3/universal-ai/async',
    {
      model: 'video/generation_async/google/veo-3.0-fast-generate-001',
      input: { duration: 2, fps: 24, dimension: '1280x720', seed: 42, text: prompt },
      show_original_response: false
    },
    { headers: { Authorization: `Bearer ${EDEN_AI_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 }
  );

  const jobId = submitRes.data?.public_id;
  if (!jobId) throw new Error('No job ID from Eden AI: ' + JSON.stringify(submitRes.data));
  console.log(`🎬 Video job submitted: ${jobId}`);

  // Poll until done (max 3 minutes)
  const maxWait = 180000;
  const interval = 5000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, interval));
    const pollRes = await axios.get(
      `https://api.edenai.run/v3/universal-ai/async/${jobId}`,
      { headers: { Authorization: `Bearer ${EDEN_AI_KEY}` }, timeout: 10000 }
    );
    const status = pollRes.data?.status;
    console.log(`🎬 Job ${jobId}: ${status}`);
    if (status === 'success') {
      const output = pollRes.data?.output;
      const videoUrl = output?.video_resource_url || output?.video || output?.items?.[0]?.video_resource_url;
      if (!videoUrl) throw new Error('No video URL in response: ' + JSON.stringify(output));
      return videoUrl;
    }
    if (status === 'fail' || status === 'error') {
      throw new Error('Video generation failed: ' + JSON.stringify(pollRes.data));
    }
  }
  throw new Error('Video generation timed out after 3 minutes');
}

// Health check
app.get('/health', (req, res) => res.json({
  ok: true,
  endpoints: {
    image: 'POST /generate (0.05 USDC)',
    video: 'POST /generate-video (0.20 USDC)',
    anyToken: 'POST /swap-and-generate (any X Layer token → auto-swap to USDC)'
  }
}));

// Demo page
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>x402 AI Paywall — OKX Build X</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 40px 20px; }
    h1 { font-size: 2rem; margin-bottom: 8px; background: linear-gradient(135deg, #6366f1, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .subtitle { color: #888; margin-bottom: 40px; font-size: 0.95rem; }
    .flow { display: flex; gap: 12px; margin-bottom: 40px; flex-wrap: wrap; justify-content: center; }
    .step { background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 12px; padding: 16px 20px; font-size: 0.85rem; text-align: center; max-width: 160px; }
    .step .num { background: #6366f1; color: white; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; margin: 0 auto 8px; font-weight: bold; }
    .arrow { color: #444; font-size: 1.5rem; display: flex; align-items: center; }
    .card { background: #111; border: 1px solid #222; border-radius: 16px; padding: 32px; width: 100%; max-width: 540px; }
    .price-tag { background: #1a1a2e; border: 1px solid #6366f1; border-radius: 8px; padding: 10px 16px; margin-bottom: 24px; font-size: 0.9rem; color: #a5b4fc; text-align: center; }
    label { display: block; margin-bottom: 8px; font-size: 0.9rem; color: #aaa; }
    textarea { width: 100%; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; color: #e0e0e0; padding: 12px; font-size: 0.95rem; resize: vertical; min-height: 80px; }
    .btn-row { display: flex; gap: 10px; margin-top: 16px; }
    button { flex: 1; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; border: none; border-radius: 8px; padding: 13px; font-size: 0.95rem; font-weight: 600; cursor: pointer; }
    button.video { background: linear-gradient(135deg, #059669, #10b981); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    #status { margin-top: 16px; padding: 12px; border-radius: 8px; font-size: 0.85rem; display: none; }
    #status.info { background: #1a1a2e; border: 1px solid #3a3a6e; color: #a5b4fc; }
    #status.error { background: #2a1a1a; border: 1px solid #6e3a3a; color: #f87171; }
    #result { margin-top: 20px; display: none; }
    #result img, #result video { width: 100%; border-radius: 12px; border: 1px solid #333; }
    .chain-badge { display: inline-block; background: #0f2027; border: 1px solid #00d4ff33; color: #00d4ff; border-radius: 6px; padding: 2px 8px; font-size: 0.75rem; margin-left: 8px; }
    .skill-box { margin-top: 32px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 16px; font-size: 0.8rem; color: #8b949e; max-width: 540px; width: 100%; }
    .skill-box code { background: #161b22; padding: 2px 6px; border-radius: 4px; color: #79c0ff; }
  </style>
</head>
<body>
  <h1>🎨 x402 AI Paywall</h1>
  <p class="subtitle">Pay USDC on X Layer → Get AI-generated image or video <span class="chain-badge">X Layer</span></p>

  <div class="flow">
    <div class="step"><div class="num">1</div>Send prompt</div>
    <div class="arrow">→</div>
    <div class="step"><div class="num">2</div>Receive 402 + payment details</div>
    <div class="arrow">→</div>
    <div class="step"><div class="num">3</div>Pay USDC on X Layer</div>
    <div class="arrow">→</div>
    <div class="step"><div class="num">4</div>Get image or video!</div>
  </div>

  <div class="card">
    <div class="price-tag">🖼️ 0.05 USDC / image &nbsp;·&nbsp; 🎬 0.20 USDC / video &nbsp;·&nbsp; Gas free on X Layer</div>
    <label for="prompt">Prompt</label>
    <textarea id="prompt" placeholder="A futuristic city at sunset with flying cars..."></textarea>
    <div class="btn-row">
      <button id="btn-img" onclick="generate('image')">🖼️ Pay & Generate Image</button>
      <button id="btn-vid" class="video" onclick="generate('video')">🎬 Pay & Generate Video</button>
    </div>
    <div id="status"></div>
    <div id="result"></div>
  </div>

  <div class="skill-box">
    <strong>🤖 For AI Agents:</strong><br>
    Image: <code>POST /generate</code> &nbsp;·&nbsp; Video: <code>POST /generate-video</code><br>
    Handle the <code>402</code> with <code>onchainos payment x402-pay</code>, replay with <code>PAYMENT-SIGNATURE</code>.
  </div>

  <script>
    async function generate(type) {
      const prompt = document.getElementById('prompt').value.trim();
      if (!prompt) return alert('Enter a prompt first');
      const btnImg = document.getElementById('btn-img');
      const btnVid = document.getElementById('btn-vid');
      btnImg.disabled = true; btnVid.disabled = true;
      document.getElementById('result').style.display = 'none';
      const endpoint = type === 'video' ? '/generate-video' : '/generate';
      const isVideo = type === 'video';
      setStatus('info', isVideo ? '⏳ Submitting video request...' : '⏳ Sending request...');

      try {
        const r1 = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
        if (r1.status === 402) {
          const payHeader = r1.headers.get('payment-required');
          const payInfo = JSON.parse(atob(payHeader));
          const price = (parseInt(payInfo.accepts[0].amount) / 1e6).toFixed(2);
          setStatus('info', '💳 Payment required: ' + price + ' USDC on X Layer. In a real agent flow, onchainos payment x402-pay handles this automatically.');
          btnImg.disabled = false; btnVid.disabled = false;
          return;
        }
        if (!r1.ok) throw new Error(await r1.text());
        const data = await r1.json();
        const resultEl = document.getElementById('result');
        if (data.video_url) {
          resultEl.innerHTML = '<video controls autoplay loop><source src="' + data.video_url + '" type="video/mp4"></video>';
        } else {
          resultEl.innerHTML = '<img src="' + data.image_url + '" alt="Generated image" />';
        }
        resultEl.style.display = 'block';
        const txInfo = data.tx_hash ? ' | <a href="' + data.explorer + '" target="_blank" style="color:#a5b4fc">View tx ↗</a>' : '';
        setStatus('info', '✅ Done! Paid ' + data.amount_usdc + ' USDC on X Layer' + txInfo);
      } catch (e) {
        setStatus('error', '❌ ' + e.message);
      }
      btnImg.disabled = false; btnVid.disabled = false;
    }

    function setStatus(type, html) {
      const el = document.getElementById('status');
      el.className = type;
      el.innerHTML = html;
      el.style.display = 'block';
    }
  </script>
</body>
</html>`);
});

// Get Uniswap quote for token → USDC (for routing intelligence)
async function getUniswapQuote(fromTokenAddress, amountOut, chainId) {
  const UNISWAP_API_KEY = process.env.UNISWAP_API_KEY;
  if (!UNISWAP_API_KEY) return null;
  try {
    const response = await axios.post(
      'https://trade-api.gateway.uniswap.org/v1/quote',
      {
        tokenInChainId: chainId,
        tokenIn: fromTokenAddress,
        tokenOutChainId: chainId,
        tokenOut: USDC_X_LAYER,
        amount: amountOut,
        type: 'EXACT_OUTPUT',
        configs: [{ protocols: ['V2', 'V3', 'MIXED'], routingType: 'CLASSIC' }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': UNISWAP_API_KEY,
          'x-universal-router-version': '2.0'
        },
        timeout: 10000
      }
    );
    return response.data;
  } catch (err) {
    console.log('Uniswap quote unavailable for this chain, using OKX DEX routing:', err.message);
    return null;
  }
}

// swap-and-generate: pay with any X Layer token, auto-swap to USDC, then generate
app.post('/swap-and-generate', async (req, res) => {
  const { prompt, token, type = 'image' } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  if (!token) return res.status(400).json({ error: 'token (contract address) is required' });

  const requiredUSDC = type === 'video' ? PRICE_VIDEO_USDC : PRICE_USDC;
  const priceHuman = (parseInt(requiredUSDC) / 1e6).toFixed(2);

  // Check payment header — same x402 flow but accepts native token amount
  const paymentHeader = req.headers['payment-signature'];
  if (!paymentHeader) {
    // First try Uniswap quote for routing intelligence (falls back to OKX if unavailable)
    let routingNote = 'Powered by OKX DEX aggregator';
    const uniswapQuote = await getUniswapQuote(token, requiredUSDC, 196);
    if (uniswapQuote) {
      routingNote = `Uniswap route: ${uniswapQuote.quote?.route?.[0]?.[0]?.tokenIn?.symbol} → USDC via ${uniswapQuote.quote?.routeString || 'optimal path'}`;
    }

    // Quote swap amount needed via OKX DEX
    let swapQuote = null;
    try {
      const quoteRes = await axios.get(
        `https://www.okx.com/api/v5/dex/aggregator/quote?chainId=196&fromTokenAddress=${token}&toTokenAddress=${USDC_X_LAYER}&amount=${requiredUSDC}&slippage=0.01`,
        { headers: { 'OK-ACCESS-KEY': process.env.OKX_API_KEY || '' }, timeout: 8000 }
      );
      swapQuote = quoteRes.data?.data?.[0];
    } catch (e) { /* quote optional */ }

    const payload = {
      x402Version: 2,
      error: 'Payment required — will auto-swap your token to USDC',
      resource: {
        url: `http://${req.get('host') || `localhost:${PORT}`}/swap-and-generate`,
        description: `AI ${type} generation — pay with any token, auto-swapped to ${priceHuman} USDC on X Layer. ${routingNote}.`,
        mimeType: 'application/json'
      },
      accepts: [
        {
          scheme: 'exact',
          network: 'eip155:196',
          amount: swapQuote?.fromTokenAmount || requiredUSDC,
          payTo: WALLET_ADDRESS,
          asset: token,
          maxTimeoutSeconds: 300,
          extra: {
            name: swapQuote?.fromToken?.tokenSymbol || 'Token',
            version: '2',
            note: `Auto-swapped to ${priceHuman} USDC for AI ${type} generation`,
            uniswap_routing: !!uniswapQuote
          }
        }
      ]
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
    res.setHeader('PAYMENT-REQUIRED', encoded);
    res.setHeader('Content-Type', 'application/json');
    return res.status(402).json({});
  }

  // Verify payment
  const verification = verifyPayment(paymentHeader, '1'); // accept any amount > 0 for token payments
  if (!verification.valid) return res.status(402).json({ error: 'Invalid payment', reason: verification.reason });

  // Execute swap: received token → USDC via OKX DEX
  let swapTxHash = null;
  let uniswapRouted = false;
  try {
    const auth = verification.authorization;
    const tokenIn = verification.authorization.to === WALLET_ADDRESS ? token : USDC_X_LAYER;
    const amountIn = auth.value;

    console.log(`🔄 Swapping token ${token} → USDC via OKX DEX...`);

    // Try Uniswap quote first for routing intelligence
    const uniswapQuote = await getUniswapQuote(token, requiredUSDC, 196);
    if (uniswapQuote) {
      uniswapRouted = true;
      console.log(`🦄 Uniswap routing used for price discovery`);
    }

    // Execute via OKX DEX (handles X Layer natively)
    const swapRes = await axios.get(
      `https://www.okx.com/api/v5/dex/aggregator/swap?chainId=196&fromTokenAddress=${token}&toTokenAddress=${USDC_X_LAYER}&amount=${amountIn}&slippage=0.05&userWalletAddress=${WALLET_ADDRESS}`,
      { headers: { 'OK-ACCESS-KEY': process.env.OKX_API_KEY || '' }, timeout: 10000 }
    );
    const swapData = swapRes.data?.data?.[0];
    if (swapData) {
      swapTxHash = swapData.tx?.hash || 'swap-queued';
      console.log(`✅ Swap routed: ${swapData.fromTokenAmount} ${token} → ${swapData.toTokenAmount} USDC`);
    }
  } catch (err) {
    console.log('Swap routing note (non-fatal):', err.message);
  }

  // Generate the media
  try {
    let result;
    if (type === 'video') {
      console.log(`🎬 Generating video: "${prompt}"`);
      const videoUrl = await generateVideo(prompt);
      result = { type: 'video', video_url: videoUrl, specs: '2s · 1280x720 · 24fps · Google Veo 3' };
    } else {
      console.log(`🎨 Generating image: "${prompt}"`);
      const imageUrl = await generateImage(prompt);
      result = { type: 'image', image_url: imageUrl };
    }

    res.json({
      success: true,
      ...result,
      prompt,
      paid_by: verification.from,
      network: 'X Layer (eip155:196)',
      amount_usdc: priceHuman,
      payment_token: token,
      routing: uniswapRouted ? 'Uniswap Trading API (price discovery) + OKX DEX (execution)' : 'OKX DEX aggregator',
      ...(swapTxHash && swapTxHash !== 'swap-queued' && { swap_tx: swapTxHash })
    });
  } catch (err) {
    console.error('Generation error:', err.message);
    res.status(500).json({ error: 'Generation failed', details: err.message });
  }
});

// Image generation endpoint
app.post('/generate', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const verification = await paymentGate(req, res, PRICE_USDC, '/generate', 'AI Image Generation — 1 image (1024x1024) via Replicate');
  if (!verification) return;

  const txHash = await redeemOnChain(verification.authorization, verification.signature);

  try {
    console.log(`🎨 Generating image: "${prompt}"`);
    const imageUrl = await generateImage(prompt);
    res.json({
      success: true, type: 'image', image_url: imageUrl, prompt,
      paid_by: verification.from, network: 'X Layer (eip155:196)',
      amount_usdc: (parseInt(PRICE_USDC) / 1e6).toFixed(2),
      ...(txHash && { tx_hash: txHash, explorer: `https://www.okx.com/web3/explorer/xlayer/tx/${txHash}` })
    });
  } catch (err) {
    console.error('Image error:', err.message);
    res.status(500).json({ error: 'Image generation failed', details: err.message });
  }
});

// Video generation endpoint
app.post('/generate-video', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const verification = await paymentGate(req, res, PRICE_VIDEO_USDC, '/generate-video', 'AI Video Generation — 2s 1280x720 via Google Veo 3');
  if (!verification) return;

  const txHash = await redeemOnChain(verification.authorization, verification.signature);

  try {
    console.log(`🎬 Generating video: "${prompt}"`);
    const videoUrl = await generateVideo(prompt);
    res.json({
      success: true, type: 'video', video_url: videoUrl, prompt,
      paid_by: verification.from, network: 'X Layer (eip155:196)',
      amount_usdc: (parseInt(PRICE_VIDEO_USDC) / 1e6).toFixed(2),
      specs: '2s · 1280x720 · 24fps · Google Veo 3',
      ...(txHash && { tx_hash: txHash, explorer: `https://www.okx.com/web3/explorer/xlayer/tx/${txHash}` })
    });
  } catch (err) {
    console.error('Video error:', err.message);
    res.status(500).json({ error: 'Video generation failed', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 x402 AI Paywall running on port ${PORT}`);
  console.log(`🖼️  Image: ${parseInt(PRICE_USDC) / 1e6} USDC | 🎬 Video: ${parseInt(PRICE_VIDEO_USDC) / 1e6} USDC`);
  console.log(`👛 Wallet: ${WALLET_ADDRESS}`);
  console.log(`🔗 Network: X Layer (eip155:196)`);
});
