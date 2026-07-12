/**
 * End-to-end verification of the phase-lock guarantee, in a real browser.
 *
 * Serves the built app, loads the demo stems, and asserts (among other things)
 * that every AudioBufferSourceNode is scheduled at the SAME start time — a
 * machine-checkable proof that tracks cannot drift or fall out of phase.
 *
 * Usage:
 *   npm run build
 *   npm i -D playwright   # if not already available
 *   PLAYWRIGHT_BROWSERS_PATH=... node scripts/verify-phase-lock.mjs
 */

import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = 4173;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGE EXCEPTION:', e.message));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

await page.getByRole('button', { name: '데모 스템 로드' }).click();
await page.waitForFunction(() => window.__mmEngine.getSnapshot().tracks.length > 0);
check('demo stems loaded', (await page.evaluate(() => window.__mmEngine.getSnapshot().tracks.length)) === 4);

await page.locator('button.play').click();
await page.waitForFunction(() => window.__mmEngine.getDebugSchedule().isPlaying);
const starts = (await page.evaluate(() => window.__mmEngine.getDebugSchedule())).sources.map((s) => s.scheduledStart);
check('all sources share one start time (phase lock)', starts.every((s) => s === starts[0] && s !== null), JSON.stringify(starts));

const t1 = await page.evaluate(() => window.__mmEngine.currentTime);
await page.waitForTimeout(600);
const t2 = await page.evaluate(() => window.__mmEngine.currentTime);
check('currentTime advances with clock', t2 > t1 + 0.4 && t2 < t1 + 0.9, `${t1.toFixed(3)} -> ${t2.toFixed(3)}`);

await page.evaluate(() => window.__mmEngine.stop());
const gains = await page.evaluate(() => {
  const e = window.__mmEngine;
  const ids = e.getSnapshot().tracks.map((t) => t.id);
  e.toggleSolo(ids[0]);
  const g = e.getExportData().tracks.map((t) => t.gain);
  e.toggleSolo(ids[0]);
  return g;
});
check('solo silences other tracks', gains[0] > 0 && gains.slice(1).every((g) => g === 0), JSON.stringify(gains));

const loop = await page.evaluate(async () => {
  const e = window.__mmEngine;
  e.setLoop({ start: 1, end: 2 });
  e.setLoopEnabled(true);
  await e.play();
  await new Promise((r) => setTimeout(r, 1500));
  const out = { pos: e.currentTime, playing: e.getDebugSchedule().isPlaying };
  e.stop();
  e.setLoop(null);
  e.setLoopEnabled(false);
  return out;
});
check('loop wraps within region and keeps playing', loop.playing && loop.pos >= 1 && loop.pos < 2, `pos=${loop.pos.toFixed(3)}`);

// The metronome click is scheduled at the very same t0 as the tracks.
const metro = await page.evaluate(async () => {
  const e = window.__mmEngine;
  e.setMetronomeBpm(120);
  e.setMetronomeEnabled(true);
  await e.play();
  const d = e.getDebugSchedule();
  const trackStart = d.sources[0].scheduledStart;
  const out = {
    ok: d.metronome.enabled && d.metronome.scheduledStart === trackStart && d.sources.every((s) => s.scheduledStart === trackStart),
    trackStart,
    metroStart: d.metronome.scheduledStart,
  };
  e.stop();
  e.setMetronomeEnabled(false);
  return out;
});
check('metronome shares tracks t0 (phase lock)', metro.ok, `track=${metro.trackStart} metro=${metro.metroStart}`);

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
