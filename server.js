import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });
const FINNHUB_KEY = process.env.FINNHUB_KEY;
const FINNHUB_BASE = 'https://finnhub.io/api/v1';

app.use(cors());
app.use(express.json());

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'QLM Server',
    endpoints: ['/api/chat', '/api/quote', '/api/quotes', '/api/market-status', '/api/news']
  });
});

// ─── ANTHROPIC CHAT PROXY ─────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { model, max_tokens, messages, system } = req.body;
    const response = await anthropic.messages.create({
      model: model || 'claude-haiku-4-5-20251001',
      max_tokens: max_tokens || 1000,
      messages,
      ...(system ? { system } : {}),
    });
    res.json(response);
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── SINGLE QUOTE  /api/quote?symbol=AAPL ─────────────────────────────────
app.get('/api/quote', async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  if (!FINNHUB_KEY) return res.status(500).json({ error: 'FINNHUB_KEY not set on server' });

  try {
    const [quoteRes, profileRes] = await Promise.all([
      fetch(`${FINNHUB_BASE}/quote?symbol=${symbol}&token=${FINNHUB_KEY}`),
      fetch(`${FINNHUB_BASE}/stock/profile2?symbol=${symbol}&token=${FINNHUB_KEY}`)
    ]);
    const quote = await quoteRes.json();
    const profile = await profileRes.json();

    if (!quote.c || quote.c === 0) {
      return res.status(404).json({ error: `No data for ${symbol}` });
    }

    res.json({
      symbol: symbol.toUpperCase(),
      name: profile.name || symbol,
      price: quote.c,
      change: quote.d,
      changePercent: quote.dp,
      high: quote.h,
      low: quote.l,
      open: quote.o,
      prevClose: quote.pc,
      currency: profile.currency || 'USD',
      exchange: profile.exchange || '',
      logo: profile.logo || '',
      industry: profile.finnhubIndustry || '',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Quote error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── BATCH QUOTES  POST /api/quotes  { symbols: ['AAPL','NVDA',...] } ─────
app.post('/api/quotes', async (req, res) => {
  const { symbols } = req.body;
  if (!symbols || !Array.isArray(symbols)) {
    return res.status(400).json({ error: 'symbols array required' });
  }
  if (!FINNHUB_KEY) return res.status(500).json({ error: 'FINNHUB_KEY not set on server' });

  try {
    const results = await Promise.all(
      symbols.map(async (sym) => {
        try {
          const r = await fetch(`${FINNHUB_BASE}/quote?symbol=${sym}&token=${FINNHUB_KEY}`);
          const q = await r.json();
          return {
            symbol: sym.toUpperCase(),
            price: q.c || 0,
            change: q.d || 0,
            changePercent: q.dp || 0,
            high: q.h || 0,
            low: q.l || 0,
            open: q.o || 0,
            prevClose: q.pc || 0,
            ok: !!q.c && q.c !== 0
          };
        } catch {
          return { symbol: sym.toUpperCase(), price: 0, change: 0, changePercent: 0, ok: false };
        }
      })
    );
    res.json({ quotes: results, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Batch quotes error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── MARKET STATUS  /api/market-status ────────────────────────────────────
app.get('/api/market-status', async (req, res) => {
  if (!FINNHUB_KEY) return res.status(500).json({ error: 'FINNHUB_KEY not set' });
  try {
    const r = await fetch(`${FINNHUB_BASE}/stock/market-status?exchange=US&token=${FINNHUB_KEY}`);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── COMPANY NEWS  /api/news?symbol=AAPL ──────────────────────────────────
app.get('/api/news', async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  if (!FINNHUB_KEY) return res.status(500).json({ error: 'FINNHUB_KEY not set' });
  try {
    const today = new Date().toISOString().split('T')[0];
    const week = new Date(Date.now() - 7*24*60*60*1000).toISOString().split('T')[0];
    const r = await fetch(`${FINNHUB_BASE}/company-news?symbol=${symbol}&from=${week}&to=${today}&token=${FINNHUB_KEY}`);
    const news = await r.json();
    res.json({ news: (news || []).slice(0, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`QLM Server running on port ${PORT}`));
