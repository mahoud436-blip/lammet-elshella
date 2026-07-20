#!/usr/bin/env node
/*
  لمّة الشلة — تجميعة ألعاب القعدة (تحدي الشلة + حبر سري)
  - لوكال على نفس الشبكة:  node server.js
  - أو على أي استضافة Node (بيقرأ PORT من البيئة تلقائيًا)
*/
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const GAMES = {
  tahadi: require('./server/tahadi/engine'),
  wisper: require('./server/wisper/engine'),
};

const PUB = path.join(__dirname, 'public');
const ENV_PORT = parseInt(process.env.PORT || '', 10);
const BASE_PORT = Number.isInteger(ENV_PORT) ? ENV_PORT : 3000;
const HOSTED = Number.isInteger(ENV_PORT);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.json': 'application/json',
};

function localIPs() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) for (const n of nets[name] || []) if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  return out;
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 200 * 1024) { reject(new Error('big')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function serveFile(res, fp, method) {
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(method === 'HEAD' ? undefined : data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname;
  try {
    // ---- API: /api/<game>/<create|join|action|stream> ----
    const m = pathname.match(/^\/api\/(tahadi|wisper)\/(create|join|action|stream)$/);
    if (m) {
      const engine = GAMES[m[1]];
      const op = m[2];
      if (op === 'stream' && req.method === 'GET') {
        engine.stream(req, res, url.searchParams.get('code') || '', url.searchParams.get('token') || '');
        return;
      }
      if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
      const body = await readBody(req);
      const out = op === 'create' ? engine.create(body) : op === 'join' ? engine.join(body) : engine.action(body);
      return json(res, out.status, out.body);
    }

    // ---- ملفات ثابتة + SPA fallback لكل لعبة ----
    if (req.method === 'GET' || req.method === 'HEAD') {
      let fp = pathname === '/' ? '/index.html' : pathname;
      if (fp === '/tahadi' ) return (res.writeHead(302, { Location: '/tahadi/' }), res.end());
      if (fp === '/wisper') return (res.writeHead(302, { Location: '/wisper/' }), res.end());
      if (fp === '/tahadi/') fp = '/tahadi/index.html';
      if (fp === '/wisper/') fp = '/wisper/index.html';
      const full = path.normalize(path.join(PUB, fp));
      if (!full.startsWith(PUB)) { res.writeHead(403); return res.end(); }
      fs.access(full, fs.constants.R_OK, (err) => {
        if (!err) return serveFile(res, full, req.method);
        // SPA fallback حسب المسار
        let fb = 'index.html';
        if (pathname.startsWith('/tahadi/')) fb = 'tahadi/index.html';
        else if (pathname.startsWith('/wisper/')) fb = 'wisper/index.html';
        serveFile(res, path.join(PUB, fb), req.method);
      });
      return;
    }
    res.writeHead(405); res.end();
  } catch (e) {
    try { json(res, 500, { ok: false, error: 'حصلت مشكلة في السيرفر' }); } catch (_) {}
  }
});

setInterval(() => { for (const k of Object.keys(GAMES)) GAMES[k].tick(); }, 15000);

let NET_IPS = localIPs();
function pushNet(port) {
  const net = { ips: NET_IPS, port, hosted: HOSTED };
  for (const k of Object.keys(GAMES)) GAMES[k].setNet(net);
}
function listen(port, attempt) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && !HOSTED && attempt < 10) listen(port + 1, attempt + 1);
    else { console.error('تعذر تشغيل السيرفر:', err.message); process.exit(1); }
  });
  server.listen(port, '0.0.0.0', () => {
    NET_IPS = localIPs();
    pushNet(port);
    console.log('');
    console.log('  🎪 لمّة الشلة شغّالة! (تحدي الشلة + حبر سري)');
    console.log('  ──────────────────────────────');
    if (HOSTED) {
      console.log('  السيرفر شغّال على بورت ' + port + ' (وضع الاستضافة)');
    } else {
      console.log('  افتح انت من الجهاز ده:  http://localhost:' + port);
      if (NET_IPS.length) {
        console.log('  وصحابك على نفس الشبكة يدخلوا من:');
        for (const ip of NET_IPS) console.log('     👉 http://' + ip + ':' + port);
      } else {
        console.log('  ⚠️ مش لاقي IP محلي — اتأكد إنك متوصل بشبكة أو شغّل هوت سبوت.');
      }
      console.log('  💡 لو ويندوز سألك عن الفايروول اضغط Allow access');
    }
    console.log('  ──────────────────────────────');
    console.log('');
    if (!HOSTED && !process.env.NO_OPEN && process.env.NODE_ENV !== 'test') {
      const u = 'http://localhost:' + port;
      const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', u]]
        : process.platform === 'darwin' ? ['open', [u]] : ['xdg-open', [u]];
      try { require('child_process').spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).on('error', () => {}); } catch (e) {}
    }
  });
}
listen(BASE_PORT, 0);
