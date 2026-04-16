import http from 'http';
import https from 'https';
import nodemailer from 'nodemailer';

const PORT           = process.env.PORT || 3000;
const API_KEY        = process.env.ANTHROPIC_KEY;
const FINNHUB_KEY    = process.env.FINNHUB_KEY;
const GMAIL_USER     = process.env.GMAIL_USER;
const GMAIL_PASS     = process.env.GMAIL_PASS;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const REPORT_TO      = 'luallen.daniel@icloud.com';

// ─── CORS ─────────────────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ─── SIMPLE HTTPS GET (no dependencies needed) ────────────────────────────
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

// ─── EMAIL ────────────────────────────────────────────────────────────────
const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_PASS }
});

// ─── SERVER ───────────────────────────────────────────────────────────────
http.createServer((req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = req.url.split('?')[0];
  const qs  = Object.fromEntries(new URLSearchParams(req.url.split('?')[1] || ''));

  // ── GET routes ────────────────────────────────────────────────────────
  if (req.method === 'GET') {

    if (url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'QLM Server' }));
      return;
    }

    if (url === '/api/quote') {
      const sym = (qs.symbol || '').toUpperCase();
      if (!sym || !FINNHUB_KEY) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'symbol or key missing'})); return; }
      const fb = 'https://finnhub.io/api/v1';
      Promise.all([
        httpsGet(`${fb}/quote?symbol=${sym}&token=${FINNHUB_KEY}`),
        httpsGet(`${fb}/stock/profile2?symbol=${sym}&token=${FINNHUB_KEY}`)
      ]).then(([q, p]) => {
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ symbol:sym, name:p.name||sym, price:q.c, change:q.d, changePercent:q.dp, high:q.h, low:q.l, open:q.o, prevClose:q.pc, logo:p.logo||'', industry:p.finnhubIndustry||'', timestamp:new Date().toISOString() }));
      }).catch(e => { res.writeHead(500,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); });
      return;
    }

    if (url === '/api/market-status') {
      if (!FINNHUB_KEY) { res.writeHead(500,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:'FINNHUB_KEY not set'})); return; }
      httpsGet(`https://finnhub.io/api/v1/stock/market-status?exchange=US&token=${FINNHUB_KEY}`)
        .then(d => { res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(d)); })
        .catch(e => { res.writeHead(500,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); });
      return;
    }

    if (url === '/api/news') {
      const sym = (qs.symbol || '').toUpperCase();
      if (!sym || !FINNHUB_KEY) { res.writeHead(400,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:'symbol or key missing'})); return; }
      const today = new Date().toISOString().split('T')[0];
      const week  = new Date(Date.now() - 7*864e5).toISOString().split('T')[0];
      httpsGet(`https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${week}&to=${today}&token=${FINNHUB_KEY}`)
        .then(d => { res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({news:(d||[]).slice(0,10)})); })
        .catch(e => { res.writeHead(500,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); });
      return;
    }

    res.writeHead(404); res.end('Not found'); return;
  }

  // ── POST routes ───────────────────────────────────────────────────────
  if (req.method !== 'POST') { res.writeHead(405); res.end('POST only'); return; }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {

    // Batch quotes
    if (url === '/api/quotes') {
      if (!FINNHUB_KEY) { res.writeHead(500,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:'FINNHUB_KEY not set'})); return; }
      try {
        const { symbols } = JSON.parse(body);
        const results = await Promise.all(symbols.map(sym =>
          httpsGet(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_KEY}`)
            .then(q => ({ symbol:sym.toUpperCase(), price:q.c||0, change:q.d||0, changePercent:q.dp||0, high:q.h||0, low:q.l||0, open:q.o||0, prevClose:q.pc||0, ok:!!q.c&&q.c!==0 }))
            .catch(() => ({ symbol:sym.toUpperCase(), price:0, change:0, changePercent:0, ok:false }))
        ));
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ quotes:results, timestamp:new Date().toISOString() }));
      } catch(e) { res.writeHead(500,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
      return;
    }

    // Assessment email
    if (url === '/api/send-assessment') {
      try {
        const { candidate, trade, score, verdict, recruiter, yoe, certs, date, fullReport } = JSON.parse(body);
        const sc = score >= 75 ? '#15803d' : score >= 55 ? '#a16207' : '#b91c1c';
        const vc = (verdict||'').toLowerCase().includes('fail') ? '#b91c1c' : (verdict||'').toLowerCase().includes('pass') ? '#15803d' : '#a16207';
        const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f7fb;font-family:system-ui,sans-serif;"><div style="max-width:680px;margin:24px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1);"><div style="background:#003a52;padding:20px 28px;display:flex;align-items:center;gap:12px;"><div style="background:#0099d8;color:#fff;font-weight:700;font-size:.9rem;letter-spacing:2px;padding:5px 12px;border-radius:4px;">QLM</div><div style="color:#b8dff0;font-size:.82rem;">Quality Labor Management &mdash; Assessment Report</div></div><div style="height:4px;background:#0099d8;"></div><div style="background:#f4f7fb;padding:20px 28px;border-bottom:1px solid #b8dff0;display:flex;align-items:center;gap:20px;"><div style="text-align:center;flex-shrink:0;"><div style="width:72px;height:72px;border-radius:50%;border:6px solid ${sc};display:flex;align-items:center;justify-content:center;margin:0 auto;"><span style="font-size:1.4rem;font-weight:700;color:${sc};">${score}</span></div><div style="margin-top:6px;padding:3px 12px;border-radius:20px;font-size:.65rem;font-weight:700;text-transform:uppercase;color:${vc};background:${vc}18;border:1px solid ${vc}44;display:inline-block;">${verdict||'Pending'}</div></div><div style="font-size:.85rem;color:#2a4a5a;line-height:1.8;"><strong style="font-size:1rem;color:#003a52;">${candidate||'—'}</strong><br><b>Trade:</b> ${trade||'—'}<br><b>Experience:</b> ${yoe||'N/A'} &nbsp;|&nbsp; <b>Certs:</b> ${certs||'None'}<br><b>Recruiter:</b> ${recruiter||'N/A'} &nbsp;|&nbsp; <b>Date:</b> ${date||''}</div></div><div style="padding:20px 28px;"><div style="font-size:.65rem;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#0077a8;margin-bottom:10px;">Full Report</div><pre style="background:#f8fafc;border:1px solid #e2e8f0;border-left:3px solid #0099d8;border-radius:6px;padding:14px;font-size:.78rem;line-height:1.7;color:#2a4a5a;white-space:pre-wrap;font-family:monospace;">${(fullReport||'').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre></div><div style="background:#003a52;padding:12px 28px;text-align:center;color:rgba(255,255,255,.4);font-size:.65rem;">QLM &mdash; Quality Labor Management &middot; myqlm.com</div></div></body></html>`;
        await mailer.sendMail({
          from: `"QLM Assessment" <${GMAIL_USER}>`,
          to: REPORT_TO,
          subject: `QLM Assessment: ${candidate||'Candidate'} — ${trade||'Unknown'} — Score: ${score} (${verdict||'Pending'})`,
          html,
          text: `Candidate: ${candidate}\nTrade: ${trade}\nScore: ${score}\nVerdict: ${verdict}\nRecruiter: ${recruiter}\nDate: ${date}\n\n${fullReport||''}`
        });
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ success: true }));
      } catch(e) {
        console.error('Email error:', e.message);
        res.writeHead(500,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // ── Lead search with web_search tool  POST /api/lead-search ─────────
    // Injects the web_search_20250305 tool so Claude can browse live job boards.
    // Aggregates multi-turn tool_use/tool_result exchanges and returns final text.
    if (url === '/api/lead-search') {
      if (!API_KEY) {
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ error: { message: 'ANTHROPIC_KEY not set on server.' } }));
        return;
      }

      let parsed;
      try { parsed = JSON.parse(body); } catch(e) {
        res.writeHead(400, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }));
        return;
      }

      const prompt = parsed.prompt || '';
      if (!prompt) {
        res.writeHead(400, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ error: { message: 'prompt field required' } }));
        return;
      }

      // Helper: make one Anthropic call, return parsed response body
      function anthropicCall(messages) {
        return new Promise((resolve, reject) => {
          const requestBody = JSON.stringify({
            model:      'claude-haiku-4-5-20251001',
            max_tokens: 4000,
            tools: [{ type: 'web_search_20250305', name: 'web_search' }],
            messages
          });
          const options = {
            hostname: 'api.anthropic.com',
            path:     '/v1/messages',
            method:   'POST',
            headers: {
              'Content-Type':      'application/json',
              'anthropic-version': '2023-06-01',
              'x-api-key':         API_KEY,
              'Content-Length':    Buffer.byteLength(requestBody),
            }
          };
          let data = '';
          const req2 = https.request(options, r => {
            r.on('data', chunk => data += chunk);
            r.on('end', () => {
              try { resolve(JSON.parse(data)); }
              catch(e) { reject(new Error('Failed to parse Anthropic response: ' + data.slice(0,200))); }
            });
          });
          req2.on('error', reject);
          req2.write(requestBody);
          req2.end();
        });
      }

      try {
        // Agentic loop: keep calling until stop_reason is 'end_turn' (no more tool calls)
        let messages = [{ role: 'user', content: prompt }];
        let finalText = '';
        let iterations = 0;
        const MAX_ITER = 8; // safety cap

        while (iterations < MAX_ITER) {
          iterations++;
          const response = await anthropicCall(messages);

          if (response.error) throw new Error(response.error.message || JSON.stringify(response.error));

          const content = response.content || [];

          // Collect any text from this turn
          const textBlocks = content.filter(b => b.type === 'text').map(b => b.text).join('');
          if (textBlocks) finalText = textBlocks; // keep latest text

          // Check if done
          if (response.stop_reason === 'end_turn') break;

          // Handle tool_use blocks — build tool_result messages
          const toolUseBlocks = content.filter(b => b.type === 'tool_use');
          if (!toolUseBlocks.length) break; // no tools called, we're done

          // Add assistant message with tool_use content
          messages.push({ role: 'assistant', content });

          // Add user message with tool_result for each tool call
          // (web_search results are returned by Anthropic automatically in the response,
          //  but we need to feed them back as tool_result blocks)
          const toolResults = toolUseBlocks.map(tu => ({
            type:        'tool_result',
            tool_use_id: tu.id,
            content:     tu.type === 'web_search' ? (tu.output || '') : ''
          }));
          messages.push({ role: 'user', content: toolResults });
        }

        // Return final text to the client
        res.writeHead(200, {
          'Content-Type':                'application/json',
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        });
        res.end(JSON.stringify({
          content: [{ type: 'text', text: finalText }],
          iterations
        }));

      } catch(e) {
        console.error('Lead search error:', e.message);
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ error: { message: e.message } }));
      }
      return;
    }

    // Anthropic AI proxy  POST / or POST /api/chat
    if (url === '/' || url === '/api/chat') {
      if (!API_KEY) {
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ error: { message: 'ANTHROPIC_KEY not set on server.' } }));
        return;
      }
      try {
        const parsed = JSON.parse(body);
        parsed.model = 'claude-haiku-4-5-20251001';
        body = JSON.stringify(parsed);
      } catch(e) {}

      const options = {
        hostname: 'api.anthropic.com',
        path:     '/v1/messages',
        method:   'POST',
        headers: {
          'Content-Type':      'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key':         API_KEY,
          'Content-Length':    Buffer.byteLength(body),
        }
      };
      const proxy = https.request(options, apiRes => {
        res.writeHead(apiRes.statusCode, {
          'Content-Type':                'application/json',
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        });
        apiRes.pipe(res);
      });
      proxy.on('error', e => {
        res.writeHead(500,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ error: { message: e.message } }));
      });
      proxy.write(body);
      proxy.end();
      return;
    }

    res.writeHead(404); res.end('Not found');
  });

}).listen(PORT, () => console.log(`QLM Server running on port ${PORT}`));
