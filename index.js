// PumpPill Bot – QuickNode Free Polling – $1M–$10M range – Render $7/month
const express = require('express');
const axios = require('axios');
const app = express();

// Hidden in Render Environment Variables
const QUICKNODE = process.env.QUICKNODE_URL;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

let lastSig = null;
let cache = {};

async function poll() {
  try {
    // Poll Raydium program for latest SWAP signatures
    const sigResp = await axios.post(QUICKNODE, {
      jsonrpc: "2.0",
      id: 1,
      method: "getSignaturesForAddress",
      params: ["675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", { limit: 30 }]
    });

    const sigs = sigResp.data.result || [];
    if (sigs.length === 0) return;
    if (!lastSig) {
      lastSig = sigs[0].signature;
      return;
    }

    for (const item of sigs) {
      if (item.signature === lastSig) break;

      const txResp = await axios.post(QUICKNODE, {
        jsonrpc: "2.0",
        id: 1,
        method: "getParsedTransaction",
        params: [item.signature, { maxSupportedTransactionVersion: 0 }]
      });

      const data = txResp.data.result;
      if (!data || data.meta?.err) continue;

      const transfers = data.transaction.message.instructions
        .flatMap(i => i.parsed?.info?.tokenTransfers || [])
        .filter(t => parseFloat(t.tokenAmount || 0) > 100000);

      if (transfers.length === 0 || transfers.length > 2) continue;

      const mint = transfers[0].mint?.toLowerCase();
      if (!mint) continue;

      // DexScreener MC + symbol
      if (!cache[mint] || Date.now() - cache[mint].ts > 300000) {
        const ds = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${mint}`).catch(() => ({}));
        const pair = ds.data?.pairs?.find(p => p.baseToken.address.toLowerCase() === mint);
        cache[mint] = {
          mc: pair ? parseFloat(pair.fdv) : 0,
          symbol: pair?.baseToken.symbol || "???"
        };
      }
      const { mc, symbol } = cache[mint];
      if (mc < 1000000 || mc > 10000000) continue;

      // 20% drop (Birdeye)
      const now = Math.floor(Date.now() / 1000);
      const bd = await axios.get(`https://public-api.birdeye.so/defi/history_price?address=${mint}&time_from=${now-1800}&type=30m`).catch(() => ({}));
      if (!bd.data?.success || bd.data.data.items.length < 2) continue;
      const prices = bd.data.data.items;
      const drop = ((prices[0].value - prices[prices.length-1].value) / prices[0].value) * 100;
      if (drop < 20) continue;

      const totalSold = transfers.reduce((s, t) => s + parseFloat(t.tokenAmount), 0).toFixed(0);

      const text = `WHALE DUMP DETECTED 🐋

${symbol} • $${(mc/1000000).toFixed(2)}M MC
-${drop.toFixed(1)}% drop
${transfers.length} whale(s) dumped ${totalSold} tokens
https://dexscreener.com/solana/${mint}`;

      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: CHAT_ID,
        text
      });
    }

    lastSig = sigs[0].signature;
  } catch (e) {
    console.error("Poll error:", e.message);
  }
}

setInterval(poll, 25000); // every 25 seconds (safe for free tier)
poll();

app.get('/', (req, res) => res.send('PumpPill QuickNode Bot Running'));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Bot polling QuickNode every 25s'));
