// Pure logic for holidays/kr generation: response parsing, normalization, merge.
// No network, no filesystem — everything here is covered by node --test.

/** Thrown when the API answers with an error (HTTP status, resultCode, or error envelope). */
export class ApiError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ApiError';
  }
}

function xmlTag(text, tag) {
  const m = text.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1].trim() : undefined;
}

function describeError(fields) {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
}

/**
 * Parse one getRestDeInfo response body into a list of raw items.
 * Throws ApiError for any error shape: non-2xx, XML body, OpenAPI_ServiceResponse
 * envelope (JSON or XML), resultCode other than "00", or totalCount larger than
 * the number of items received (pagination would silently drop days).
 *
 * @param {number} status HTTP status
 * @param {string} text   raw response body
 * @returns {Array<object>} raw `item` objects (possibly empty)
 */
export function parseRestDeInfo(status, text) {
  const body = String(text ?? '').trim();

  if (body.startsWith('<')) {
    throw new ApiError(
      `API returned XML (HTTP ${status}): ` +
        (describeError({
          errMsg: xmlTag(body, 'errMsg'),
          returnAuthMsg: xmlTag(body, 'returnAuthMsg'),
          returnReasonCode: xmlTag(body, 'returnReasonCode'),
          resultCode: xmlTag(body, 'resultCode'),
          resultMsg: xmlTag(body, 'resultMsg'),
        }) || 'unrecognized XML body'),
    );
  }

  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new ApiError(`API returned a non-JSON body (HTTP ${status}, ${body.length} bytes)`);
  }

  const envelope = json?.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (envelope) {
    throw new ApiError(
      `API error (HTTP ${status}): ` +
        describeError({
          errMsg: envelope.errMsg,
          returnAuthMsg: envelope.returnAuthMsg,
          returnReasonCode: envelope.returnReasonCode,
        }),
    );
  }

  if (status < 200 || status >= 300) {
    throw new ApiError(`API returned HTTP ${status}`);
  }

  const header = json?.response?.header;
  if (!header) throw new ApiError('API response has no response.header');
  if (String(header.resultCode) !== '00') {
    throw new ApiError(
      `API error: ${describeError({ resultCode: header.resultCode, resultMsg: header.resultMsg })}`,
    );
  }

  const resBody = json.response.body;
  if (!resBody) throw new ApiError('API response has no response.body');

  // items is "" when there are no holidays; item is an object when there is exactly one.
  const rawItem = resBody.items === '' || resBody.items == null ? undefined : resBody.items.item;
  const items = rawItem === undefined || rawItem === '' ? [] : Array.isArray(rawItem) ? rawItem : [rawItem];

  const total = Number(resBody.totalCount ?? items.length);
  if (Number.isFinite(total) && total > items.length) {
    throw new ApiError(`API paginated the result: totalCount=${total} but received ${items.length}`);
  }
  return items;
}

/** 20261003 (number or string) → "2026-10-03" */
export function locdateToIso(locdate) {
  const s = String(locdate);
  if (!/^\d{8}$/.test(s)) throw new ApiError(`unexpected locdate: ${s}`);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** Keep isHoliday === "Y" and map to { date, name, kind: "public" }. */
export function toPublicDays(items) {
  return items
    .filter((it) => String(it.isHoliday).toUpperCase() === 'Y')
    .map((it) => ({ date: locdateToIso(it.locdate), name: String(it.dateName).trim(), kind: 'public' }));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate extra-closures.json content; throws on any malformed entry. */
export function validateExtraClosures(list) {
  if (!Array.isArray(list)) throw new Error('extra-closures.json must be a JSON array');
  for (const [i, e] of list.entries()) {
    if (!e || !ISO_DATE.test(e.date) || Number.isNaN(Date.parse(`${e.date}T00:00:00Z`))) {
      throw new Error(`extra-closures.json[${i}]: invalid date`);
    }
    if (typeof e.name !== 'string' || e.name.trim() === '') {
      throw new Error(`extra-closures.json[${i}]: name is required`);
    }
    if (e.kind !== 'logistics') throw new Error(`extra-closures.json[${i}]: kind must be "logistics"`);
  }
  return list;
}

/**
 * Merge API public days with hand-maintained closures for [from, to].
 * One entry per date: an API day wins over an extra closure on the same date;
 * among several API days on one date the first is kept.
 */
export function mergeDays(publicDays, extraClosures, from, to) {
  const byDate = new Map();
  const inRange = (d) => d.date >= from && d.date <= to;
  for (const d of publicDays.filter(inRange)) {
    if (!byDate.has(d.date)) byDate.set(d.date, d);
  }
  for (const e of extraClosures.filter(inRange)) {
    if (!byDate.has(e.date)) byDate.set(e.date, { date: e.date, name: e.name, kind: 'logistics' });
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Calendar year in Asia/Seoul (UTC+9, no DST). */
export function kstYear(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).getUTCFullYear();
}

/** Stable file content: 2-space JSON + trailing newline. */
export function toFileContent(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Key from the portal may be the "Encoding" (already %-escaped) or "Decoding" variant. */
export function encodeServiceKey(key) {
  const k = String(key ?? '').trim();
  if (k === '') throw new Error('DATA_GO_KR_SERVICE_KEY is empty or not set');
  return k.includes('%') ? k : encodeURIComponent(k);
}
