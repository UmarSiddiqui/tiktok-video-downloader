import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const VIDEO_PATH = process.env.VIDEO_PATH || new URL('../tmp/test.webm', import.meta.url).pathname;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch();
const page = await browser.newPage();

const requests = [];
page.on('request', (req) => {
  requests.push({ url: req.url(), method: req.method() });
});

await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

// Switch to "Extract Frames" tab
await page.getByRole('tab', { name: /extract frames/i }).click();

// Upload a video file via the hidden input (drag/drop uses same input downstream)
await page.setInputFiles('#video-upload', VIDEO_PATH);

const labelText = await page.locator('#file-label-text').innerText();
assert(labelText && !/choose a video file/i.test(labelText), `Expected filename to be shown, got: "${labelText}"`);

// Run extraction
await page.getByRole('button', { name: /extract frames/i }).click();
await page.getByText(/Extracted \d+ frame/i).waitFor({ timeout: 15000 });

const frameCount = await page.locator('#frames-grid img').count();
assert(frameCount > 0, `Expected at least 1 extracted frame, got ${frameCount}`);

// Ensure extraction didn't require backend API calls
const apiCalls = requests.filter(r => new URL(r.url).pathname.startsWith('/api/'));
assert(apiCalls.length === 0, `Expected no /api/* calls during extractor flow, saw: ${apiCalls.map(c => c.url).join(', ')}`);

await browser.close();

console.log('OK: extractor upload + extraction smoke test passed');

