import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
export function serve(root, port = 4174) {
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };
  const server = http.createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405).end();
      return;
    }
    if (!['127.0.0.1', 'localhost'].includes((request.headers.host ?? '').split(':')[0])) {
      response.writeHead(403).end();
      return;
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!target.startsWith(path.resolve(root) + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      if (!(await stat(target)).isFile()) {
        response.writeHead(404).end();
        return;
      }
      const data = await readFile(target);
      response.writeHead(200, { 'Content-Type': mime[path.extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self'; connect-src 'self' http://127.0.0.1:4317; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" });
      response.end(request.method === 'HEAD' ? undefined : data);
    }
    catch {
      response.writeHead(404).end('Not found');
    }
  });
  server.listen(port, '127.0.0.1', () => console.log(`WitWitty demo: http://127.0.0.1:${server.address().port}`));
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  serve(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist'), Number(process.env.PORT ?? 4174));
