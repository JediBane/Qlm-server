import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';

const app = express();
const PORT = process.env.PORT || 3000;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });
const FINNHUB_KEY = process.env.FINNHUB_KEY;
const FINNHUB_BASE = 'https://finnhub.io/api/v1';

// ─── GMAIL TRANSPORTER ────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'QLM Server',
    endpoints: ['/api/chat', '/api/quote', '/api/quotes', '/api/market-status', '/api/news', '/api/send-assessment']
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

// ─── SEND ASSESSMENT EMAIL  POST /api/send-assessment ─────────────────────
// Body: { candidate, trade, score, verdict, recruiter, yoe, certs, date, fullReport }
app.post('/api/send-assessment', async (req, res) => {
  const { candidate, trade, score, verdict, recruiter, yoe, certs, date, fullReport } = req.body;

  if (!fullReport) return res.status(400).json({ error: 'fullReport is required' });

  const REPORT_TO = 'luallen.daniel@icloud.com';
  const scoreColor = score >= 75 ? '#15803d' : score >= 55 ? '#a16207' : '#b91c1c';
  const verdictColor = verdict && verdict.toLowerCase().includes('fail') ? '#b91c1c'
    : verdict && verdict.toLowerCase().includes('pass') ? '#15803d' : '#a16207';

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:system-ui,-apple-system,sans-serif;">
  <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1);margin-top:24px;margin-bottom:24px;">

    <!-- Header -->
    <div style="background:#003a52;padding:24px 32px;display:flex;align-items:center;gap:14px;">
      <div style="background:#0099d8;color:#fff;font-weight:700;font-size:1rem;letter-spacing:2px;padding:6px 14px;border-radius:4px;">QLM</div>
      <div>
        <div style="color:#b8dff0;font-size:.85rem;letter-spacing:1px;">Quality Labor Management</div>
        <div style="color:#fff;font-size:.75rem;letter-spacing:2px;text-transform:uppercase;opacity:.7;margin-top:2px;">Skilled Trades Assessment Report</div>
      </div>
    </div>
    <div style="height:4px;background:#0099d8;"></div>

    <!-- Score Banner -->
    <div style="background:#f4f7fb;padding:24px 32px;display:flex;align-items:center;gap:24px;border-bottom:1px solid #b8dff0;">
      <div style="text-align:center;flex-shrink:0;">
        <div style="width:80px;height:80px;border-radius:50%;border:6px solid ${scoreColor};display:flex;align-items:center;justify-content:center;margin:0 auto;">
          <div>
            <div style="font-size:1.6rem;font-weight:700;color:${scoreColor};line-height:1;">${score}</div>
            <div style="font-size:.6rem;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Score</div>
          </div>
        </div>
        <div style="margin-top:8px;display:inline-block;padding:4px 14px;border-radius:20px;font-size:.72rem;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${verdictColor};background:${verdictColor}18;border:1px solid ${verdictColor}44;">${verdict || 'Pending'}</div>
      </div>
      <div>
        <div style="font-size:1.1rem;font-weight:700;color:#003a52;margin-bottom:4px;">${candidate || 'Candidate'}</div>
        <div style="font-size:.85rem;color:#64748b;line-height:1.7;">
          <strong>Trade:</strong> ${trade || '—'}<br>
          <strong>Experience Claimed:</strong> ${yoe || 'Not specified'}<br>
          <strong>Certifications:</strong> ${certs || 'None listed'}<br>
          <strong>Recruiter:</strong> ${recruiter || 'Not specified'}<br>
          <strong>Date:</strong> ${date || new Date().toLocaleDateString()}
        </div>
      </div>
    </div>

    <!-- Full Report -->
    <div style="padding:24px 32px;">
      <div style="font-size:.68rem;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#0077a8;margin-bottom:12px;">Full Assessment Report</div>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-left:3px solid #0099d8;border-radius:8px;padding:16px;font-size:.85rem;line-height:1.8;color:#2a4a5a;white-space:pre-wrap;font-family:monospace;">${fullReport.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
    </div>

    <!-- Footer -->
    <div style="background:#003a52;padding:16px 32px;text-align:center;">
      <div style="color:rgba(255,255,255,.5);font-size:.72rem;line-height:1.8;">
        QLM — Quality Labor Management &nbsp;·&nbsp; Safety · Productivity · Quality<br>
        info@myqlm.com &nbsp;·&nbsp; 855-756-9675 &nbsp;·&nbsp; myqlm.com<br>
        <span style="font-size:.65rem;opacity:.6;">This report was generated automatically by the QLM SPQ Assessment Tool</span>
      </div>
    </div>

  </div>
</body>
</html>`;

  const textBody = [
    'QLM SKILLED TRADES ASSESSMENT REPORT',
    '=====================================',
    `Candidate:   ${candidate || '—'}`,
    `Trade:       ${trade || '—'}`,
    `Score:       ${score}`,
    `Verdict:     ${verdict || '—'}`,
    `Experience:  ${yoe || 'Not specified'}`,
    `Certs:       ${certs || 'None listed'}`,
    `Recruiter:   ${recruiter || 'Not specified'}`,
    `Date:        ${date || new Date().toLocaleDateString()}`,
    '',
    '─────────────────────────────────────',
    'FULL REPORT',
    '─────────────────────────────────────',
    fullReport
  ].join('\n');

  try {
    await transporter.sendMail({
      from: `"QLM Assessment Tool" <${process.env.GMAIL_USER}>`,
      to: REPORT_TO,
      subject: `QLM Assessment: ${candidate || 'Candidate'} — ${trade || 'Unknown Trade'} — Score: ${score} (${verdict || 'Pending'})`,
      text: textBody,
      html: htmlBody,
    });

    console.log(`Assessment email sent for ${candidate} — ${trade} — Score: ${score}`);
    res.json({ success: true, message: 'Report emailed successfully' });
  } catch (err) {
    console.error('Email error:', err.message);
    res.status(500).json({ error: 'Failed to send email: ' + err.message });
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
