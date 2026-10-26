import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startServer } from './helpers/server.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('serveur local', () => {
  let server;
  before(async () => { server = await startServer(ROOT, 0); });
  after(() => server.close());

  it('sert la page avec les en-têtes de vercel.json', async () => {
    const response = await fetch(server.url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
  });

  it('[D-39] répond 400 à une adresse mal formée au lieu de planter', async () => {
    const response = await fetch(`${server.url}%E0%A4%A`);
    assert.equal(response.status, 400);
    assert.equal((await fetch(server.url)).status, 200, 'le serveur ne répond plus');
  });

  it('refuse de sortir du dossier du projet et répond 404 aux fichiers absents', async () => {
    assert.notEqual((await fetch(`${server.url}..%2F..%2Fsecret.txt`)).status, 200);
    assert.equal((await fetch(`${server.url}absent.html`)).status, 404);
  });
});
