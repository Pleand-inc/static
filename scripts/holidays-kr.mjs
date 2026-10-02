#!/usr/bin/env node
// Generate holidays/kr/*.json from the KASI special-day API (getRestDeInfo).
// Node 20+, no dependencies. Usage: DATA_GO_KR_SERVICE_KEY=... node scripts/holidays-kr.mjs
//
// Env:
//   DATA_GO_KR_SERVICE_KEY  required. "Encoding" or "Decoding" key; never printed.
//   HOLIDAYS_DEBUG=1        print raw API bodies and compare whole-year vs month-by-month.
//
// All years are fetched and validated before any file is written, so a failed
// request never leaves partial data behind.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  encodeServiceKey,
  kstYear,
  mergeDays,
  parseRestDeInfo,
  toFileContent,
  toPublicDays,
  validateExtraClosures,
} from './lib/holidays-kr-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'holidays', 'kr');
const ENDPOINT = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';
const DEBUG = process.env.HOLIDAYS_DEBUG === '1';

const rawKey = process.env.DATA_GO_KR_SERVICE_KEY;
const serviceKey = encodeServiceKey(rawKey);

/** Remove any form of the key from text before it can reach a log. */
function redact(text) {
  let out = String(text);
  for (const k of [rawKey, serviceKey, decodeSafe(rawKey)]) {
    if (k && k.length >= 8) out = out.split(k).join('[REDACTED]');
  }
  return out;
}
function decodeSafe(s) {
  try {
    return decodeURIComponent(String(s ?? ''));
  } catch {
    return '';
  }
}

async function request(year, month) {
  const label = month ? `${year}-${String(month).padStart(2, '0')}` : `${year} (whole year)`;
  // Built by hand: URLSearchParams would re-encode an already-encoded key.
  const query = [`serviceKey=${serviceKey}`, `solYear=${year}`, `numOfRows=100`, `pageNo=1`, `_type=json`];
  if (month) query.push(`solMonth=${String(month).padStart(2, '0')}`);
  const url = `${ENDPOINT}?${query.join('&')}`;

  for (let attempt = 1; ; attempt++) {
    let res;
    let text;
    try {
      res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
      text = await res.text();
    } catch (err) {
      // Never include the URL; undici errors carry only a code in `cause`.
      const reason = err?.cause?.code ?? err?.name ?? 'unknown';
      if (attempt < 3) {
        console.log(`  ${label}: network error (${reason}), retrying`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      throw new Error(`${label}: request failed (${reason})`);
    }
    if (res.status >= 500 && attempt < 3) {
      console.log(`  ${label}: HTTP ${res.status}, retrying`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    if (DEBUG) console.log(`--- raw ${label} HTTP ${res.status} ${res.headers.get('content-type')}\n${redact(text)}`);
    try {
      return parseRestDeInfo(res.status, text);
    } catch (err) {
      throw new Error(`${label}: ${redact(err.message)}`);
    }
  }
}

async function fetchYearByMonth(year) {
  const items = [];
  for (let m = 1; m <= 12; m++) items.push(...(await request(year, m)));
  return items;
}

async function main() {
  const year = kstYear();
  const years = [year, year + 1];

  const extra = validateExtraClosures(JSON.parse(await readFile(join(OUT_DIR, 'extra-closures.json'), 'utf8')));

  // One whole-year request per year (solMonth omitted). Verified on 2026-10-02 to return
  // exactly the same days as 12 month-by-month requests for 2026 and 2027; numOfRows=100
  // plus the totalCount check in parseRestDeInfo guards against silent pagination.
  // HOLIDAYS_DEBUG=1 re-runs that comparison.
  const publicByYear = new Map();
  for (const y of years) {
    const items = await request(y);
    const days = toPublicDays(items);
    console.log(`${y}: ${items.length} items from API, ${days.length} with isHoliday=Y`);
    publicByYear.set(y, days);

    if (DEBUG) {
      const byMonth = toPublicDays(await fetchYearByMonth(y));
      const a = days.map((d) => `${d.date}:${d.name}`).join(',');
      const b = byMonth.map((d) => `${d.date}:${d.name}`).join(',');
      console.log(`debug ${y}: whole-year=${days.length} month-by-month=${byMonth.length} identical=${a === b}`);
    }
  }

  const files = new Map();
  for (const y of years) {
    const from = `${y}-01-01`;
    const to = `${y}-12-31`;
    files.set(`${y}.json`, { from, to, days: mergeDays(publicByYear.get(y), extra, from, to) });
  }
  const from = `${years[0]}-01-01`;
  const to = `${years[1]}-12-31`;
  const allPublic = years.flatMap((y) => publicByYear.get(y));
  files.set('upcoming.json', { from, to, days: mergeDays(allPublic, extra, from, to) });
  files.set('meta.json', { checkedAt: new Date().toISOString() });

  await mkdir(OUT_DIR, { recursive: true });
  for (const [name, value] of files) {
    await writeFile(join(OUT_DIR, name), toFileContent(value));
  }

  for (const d of files.get('upcoming.json').days) console.log(`  ${d.date} ${d.kind.padEnd(9)} ${d.name}`);
  console.log(`wrote ${[...files.keys()].join(', ')}`);
}

main().catch((err) => {
  console.error(`::error::${redact(err?.message ?? err)}`);
  process.exit(1);
});
