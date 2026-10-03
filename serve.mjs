// 이 폴더를 http://127.0.0.1:47831 로 연다. 유튜브 플레이어는 파일로 연 페이지에서는 재생을 막아서 필요하다.
// 이 컴퓨터 안에서만 열리고(127.0.0.1), 이 폴더 밖 파일은 내주지 않는다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 47831;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}).on('error', (e) => {
  // 이미 열려 있으면 그대로 쓴다
  if (e.code === 'EADDRINUSE') process.exit(0);
  throw e;
}).listen(PORT, '127.0.0.1', () => console.log(`Spincard: http://127.0.0.1:${PORT}/`));
