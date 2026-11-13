const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
try {
  process.loadEnvFile(path.join(root, '.env.local'));
}
catch (error) {
  if(error.code !== 'ENOENT') throw error;
}
const api = require('./lib/wedding-api').createApi();
// Serve only public UI files. Configuration, tokens, logs and source archives
// must never be downloadable through the preview server.
const publicFiles = new Map([ ['/', ['index.html', 'text/html; charset=utf-8']], ['/index.html', ['index.html', 'text/html; charset=utf-8']], ['/styles.css', ['styles.css', 'text/css; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ]);
http.createServer((req, res) => {
  let pathname; try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  }
  catch {
    res.writeHead(400); return res.end('Bad request');
  }
  if (pathname.startsWith('/api/')) return api(req, res); const entry = publicFiles.get(pathname); if (!entry) {
    res.writeHead(404); return res.end('Not found');
  }
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405); return res.end();
  }
  fs.readFile(path.join(root, entry[0]), (err, data) => {
    if (err) {
      res.writeHead(404); return res.end('Not found');
    }
    res.setHeader('Content-Type', entry[1]); res.setHeader('X-Content-Type-Options', 'nosniff'); res.end(req.method === 'HEAD' ? undefined : data);
  });
}).listen(Number(process.env.PORT)||5173, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${Number(process.env.PORT)||5173}`));
