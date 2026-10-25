// Mini-serveur statique sans dépendance : `npm start` ou utilisé par les tests e2e.
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml'
};

export function startServer(root, port = 8000) {
  const base = resolve(root);
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = normalize(join(base, path === '/' ? 'index.html' : path));
    if (file !== base && !file.startsWith(base + sep)) { response.writeHead(403).end(); return; }
    try {
      if (!statSync(file).isFile()) throw new Error('pas un fichier');
    } catch {
      response.writeHead(404).end('Introuvable'); return;
    }
    response.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolvePromise({ url: `http://localhost:${server.address().port}/`, close: () => server.close() }));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const { url } = await startServer(root, Number(process.env.PORT) || 8000);
  console.log(`ReTiss disponible sur ${url} (Ctrl+C pour arrêter)`);
}
