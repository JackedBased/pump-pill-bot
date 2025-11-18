// PumpPill Whale Dump Bot – Helius + Render – $1M–$10M range – DexScreener version
const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json({ limit: '10mb' }));

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

let cache = {};  // simple in-memory cache

app.post('/webhook', async (req, res) => {
  try {
    const events = req.body || [];
    for (const event of events) {
      if (event.type !== "SWAP") continue;

      const transfers = event.tokenTransfers || [];
      const bigSells = transfers.filter(t => parseFloat(t.tokenAmount || 0) > 100000);
      if (bigSells.length === 0 || bigSells.length > 2) continue;

      const mint = bigSells[0].tokenMint?.toLowerCase();
      if (!mint) continue;

      // === DEXSCREENER MARKET CAP + SYMBOL (real-time) ===
      if (!cache[mint] || Date.now() - cache[mint].ts > 300000) {  // 5 min cache
        const ds = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${mint}`).catch(() => ({}));
        const pair = ds.data?.pairs?.find(p => p.baseToken.address.toLowerCase() === mint);
        if (pair && pair.fdv) {
          cache[mint] = {
            mc: parseFloat(pair.fdv),
            symbol: pair.baseToken.symbol || "???",
            ts: Date.now()
          };
        } else {
          cache[mint] = { mc: 0, symbol: "???", ts: Date.now() };
        }
      }
      const { mc, symbol } = cache[mint];
      if (mc < 1000000 || mc > 10000000) continue;  // $1M–$10M range

      // === 20%+ DROP CHECK (Birdeye) ===
      const now = Math.floor(Date.now() / 1000);
      const bd = await axios.get(`https://public-api.birdeye.so/defi/history_price?address=${mint}&time_from=${now-1800}&type=30m`).catch(() => ({}));
      if (!bd.data?.success || bd.data.data.items.length < 2) continue;
      const prices = bd.data.data.items;
      const drop = ((prices[0].value - prices[prices.length-1].value) / prices[0].value) * 100;
      if (drop < 20) continue;

      // === SEND ALERT ===
      const totalSold = bigSells.reduce((s, t) => s + parseFloat(t.tokenAmount), 0).toFixed(0);
      const wallets = bigSells.map(t => t.fromUserAccount.slice(0,10) + '...').join(', ');

      const text = `WHALE DUMP DETECTED 🐋

${symbol} • $${(mc/1000000).toFixed(2)}M MC
-${drop.toFixed(1)}% in 30 min
${bigSells.length} whale(s) dumped ${totalSold} tokens
Wallets: ${wallets}
https://dexscreener.com/solana/${mint}`;

      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: CHAT_ID,
        text,
        disable_web_page_preview: true
      });
    }
    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.sendStatus(200);
  }
});

app.get('/', (req, res) => res.send('PumpPill Bot Running'));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Bot live on Render!'));
