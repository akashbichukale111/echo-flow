const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 8080;

const proxies = {
  '/echo-flow/api/': { host: '127.0.0.1', port: 5201, prefix: '/api/' },
  '/rahat/api/': { host: '127.0.0.1', port: 8030, prefix: '/api/' },
  '/waterpulse/api/': { host: '127.0.0.1', port: 8000, prefix: '/api/' },
};

const devServers = {
  '/echo-flow/': { host: '127.0.0.1', port: 5174 },
  '/rahat/': { host: '127.0.0.1', port: 5200 },
  '/waterpulse/': { host: '127.0.0.1', port: 5173 }, // waterpulse default vite port
};

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  // 1. API Proxies
  for (const [route, config] of Object.entries(proxies)) {
    if (url.pathname.startsWith(route)) {
      const targetPath = config.prefix + url.pathname.slice(route.length) + url.search;
      
      const headers = { ...req.headers };
      // Inject development token for pilot mode if not present
      if (route === '/waterpulse/api/' && !headers['authorization']) {
        headers['authorization'] = 'Bearer vAWLSeTpkFmwF6TucC8_rMLlm7NaMbdpBrHK4ZTbXho';
      }

      const options = {
        hostname: config.host,
        port: config.port,
        path: targetPath,
        method: req.method,
        headers: headers
      };
      
      const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      });
      
      proxyReq.on('error', (err) => {
        res.writeHead(502);
        res.end('Bad Gateway: ' + err.message);
      });
      
      req.pipe(proxyReq, { end: true });
      return;
    }
  }

  // 2. Frontend Dev Server Proxies
  for (const [route, config] of Object.entries(devServers)) {
    if (url.pathname.startsWith(route)) {
      // In dev mode, Vite handles its own base paths.
      const options = {
        hostname: config.host,
        port: config.port,
        path: req.url,
        method: req.method,
        headers: req.headers
      };
      
      const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      });
      
      proxyReq.on('error', (err) => {
        res.writeHead(502);
        res.end('Bad Gateway: Frontend dev server not running on port ' + config.port);
      });
      
      req.pipe(proxyReq, { end: true });
      return;
    }
  }

  // 3. Main Site Static Files (fallback)
  let staticPath = path.join(__dirname, 'site', url.pathname === '/' ? 'index.html' : url.pathname);
  
  fs.stat(staticPath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    
    const ext = path.extname(staticPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(staticPath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n=========================================`);
  console.log(`ECHO-FLOW PLATFORM UNIFIED DEV SERVER`);
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`=========================================\n`);
  console.log(`Main Site:    http://localhost:${PORT}/`);
  console.log(`Echo-Flow:    http://localhost:${PORT}/echo-flow/`);
  console.log(`Rahat AI:     http://localhost:${PORT}/rahat/`);
  console.log(`WaterPulse:   http://localhost:${PORT}/waterpulse/`);
});
