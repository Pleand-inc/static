import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ApiError,
  encodeServiceKey,
  kstYear,
  locdateToIso,
  mergeDays,
  parseRestDeInfo,
  toPublicDays,
  validateExtraClosures,
} from './lib/holidays-kr-core.mjs';

// Error bodies below are verbatim responses observed from apis.data.go.kr (2026-10-02).
const ERR_JSON_NOT_REGISTERED = `{
  "OpenAPI_ServiceResponse": {
    "cmmMsgHeader": {
      "errMsg": "SERVICE_KEY_IS_NOT_REGISTERED_ERROR",
      "returnAuthMsg": "등록되지 않은 서비스키",
      "returnReasonCode": "30"
    }
  }
}`;
const ERR_XML_NOT_REGISTERED = `<?xml version="1.0" encoding="UTF-8"?>
<OpenAPI_ServiceResponse>
<cmmMsgHeader>
  <errMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</errMsg>
  <returnAuthMsg>등록되지 않은 서비스키</returnAuthMsg>
  <returnReasonCode>30</returnReasonCode>
</cmmMsgHeader>
</OpenAPI_ServiceResponse>`;

// Success bodies below are verbatim getRestDeInfo responses (_type=json) observed in the
// first workflow run (2026-10-02): 2026-01 (single object), 2026-02 (array), 2026-04 (empty).
const REAL_2026_01 =
  '{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE."},"body":{"items":{"item":{"dateKind":"01","dateName":"1월1일","isHoliday":"Y","locdate":20260101,"seq":1}},"numOfRows":100,"pageNo":1,"totalCount":1}}}';
const REAL_2026_02 =
  '{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE."},"body":{"items":{"item":[{"dateKind":"01","dateName":"설날","isHoliday":"Y","locdate":20260216,"seq":1},{"dateKind":"01","dateName":"설날","isHoliday":"Y","locdate":20260217,"seq":1},{"dateKind":"01","dateName":"설날","isHoliday":"Y","locdate":20260218,"seq":1}]},"numOfRows":100,"pageNo":1,"totalCount":3}}}';
const REAL_2026_04 =
  '{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE."},"body":{"items":"","numOfRows":100,"pageNo":1,"totalCount":0}}}';

// Synthetic success body for cases the real API did not produce (isHoliday N, pagination).
function ok(items, totalCount) {
  return JSON.stringify({
    response: {
      header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
      body: { items, numOfRows: 100, pageNo: 1, totalCount },
    },
  });
}

const GAECHEON = { dateKind: '01', dateName: '개천절', isHoliday: 'Y', locdate: 20261003, seq: 1 };
const HANGUL = { dateKind: '01', dateName: '한글날', isHoliday: 'Y', locdate: 20261009, seq: 1 };

test('items.item as an array (real 2026-02)', () => {
  assert.deepEqual(toPublicDays(parseRestDeInfo(200, REAL_2026_02)), [
    { date: '2026-02-16', name: '설날', kind: 'public' },
    { date: '2026-02-17', name: '설날', kind: 'public' },
    { date: '2026-02-18', name: '설날', kind: 'public' },
  ]);
});

test('items.item as a single object (real 2026-01)', () => {
  assert.deepEqual(toPublicDays(parseRestDeInfo(200, REAL_2026_01)), [
    { date: '2026-01-01', name: '1월1일', kind: 'public' },
  ]);
});

test('items as empty string when the month has no holidays (real 2026-04)', () => {
  assert.deepEqual(parseRestDeInfo(200, REAL_2026_04), []);
});

test('isHoliday N is dropped', () => {
  const items = parseRestDeInfo(200, ok({ item: [GAECHEON, { ...HANGUL, isHoliday: 'N' }] }, 2));
  assert.deepEqual(
    toPublicDays(items).map((d) => d.date),
    ['2026-10-03'],
  );
});

test('XML error envelope fails with errMsg and reason code', () => {
  assert.throws(
    () => parseRestDeInfo(403, ERR_XML_NOT_REGISTERED),
    (e) => e instanceof ApiError && /SERVICE_KEY_IS_NOT_REGISTERED_ERROR/.test(e.message) && /returnReasonCode=30/.test(e.message),
  );
});

test('XML error envelope fails even with HTTP 200', () => {
  assert.throws(() => parseRestDeInfo(200, ERR_XML_NOT_REGISTERED), /SERVICE_KEY_IS_NOT_REGISTERED_ERROR/);
});

test('JSON error envelope fails with errMsg', () => {
  assert.throws(
    () => parseRestDeInfo(403, ERR_JSON_NOT_REGISTERED),
    (e) => e instanceof ApiError && /SERVICE_KEY_IS_NOT_REGISTERED_ERROR/.test(e.message),
  );
});

test('non-00 resultCode fails', () => {
  const body = JSON.stringify({ response: { header: { resultCode: '22', resultMsg: 'LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR.' } } });
  assert.throws(() => parseRestDeInfo(200, body), /resultCode=22/);
});

test('non-2xx with an unrecognized body fails', () => {
  assert.throws(() => parseRestDeInfo(500, 'Internal error'), ApiError);
});

test('totalCount larger than received items fails (pagination)', () => {
  assert.throws(() => parseRestDeInfo(200, ok({ item: [GAECHEON] }, 15)), /paginated/);
});

test('locdate as number or string', () => {
  assert.equal(locdateToIso(20261003), '2026-10-03');
  assert.equal(locdateToIso('20270101'), '2027-01-01');
  assert.throws(() => locdateToIso('2026-10-03'));
});

// The API really returns 2026-05-01 as "노동절" (isHoliday Y), the same date as the
// 근로자의 날 entry in extra-closures.json — the API entry must win.
test('merge: API day wins over an extra closure on the same date, sorted, range-limited', () => {
  const publicDays = [
    { date: '2026-10-09', name: '한글날', kind: 'public' },
    { date: '2026-05-01', name: '노동절', kind: 'public' },
    { date: '2026-10-03', name: '개천절', kind: 'public' },
    { date: '2028-01-01', name: '1월1일', kind: 'public' },
  ];
  const extra = [
    { date: '2026-05-01', name: '근로자의 날', kind: 'logistics' },
    { date: '2026-08-14', name: '택배 없는 날', kind: 'logistics' },
    { date: '2025-08-14', name: '택배 없는 날', kind: 'logistics' },
  ];
  assert.deepEqual(mergeDays(publicDays, extra, '2026-01-01', '2027-12-31'), [
    { date: '2026-05-01', name: '노동절', kind: 'public' },
    { date: '2026-08-14', name: '택배 없는 날', kind: 'logistics' },
    { date: '2026-10-03', name: '개천절', kind: 'public' },
    { date: '2026-10-09', name: '한글날', kind: 'public' },
  ]);
});

test('merge: duplicate API dates keep one entry', () => {
  const publicDays = [
    { date: '2026-06-03', name: 'A', kind: 'public' },
    { date: '2026-06-03', name: 'B', kind: 'public' },
  ];
  assert.deepEqual(mergeDays(publicDays, [], '2026-01-01', '2026-12-31'), [{ date: '2026-06-03', name: 'A', kind: 'public' }]);
});

test('extra-closures.json in the repo is valid', async () => {
  const { readFile } = await import('node:fs/promises');
  const list = JSON.parse(await readFile(new URL('../holidays/kr/extra-closures.json', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => validateExtraClosures(list));
});

test('validateExtraClosures rejects bad entries', () => {
  assert.throws(() => validateExtraClosures([{ date: '2026-5-1', name: 'x', kind: 'logistics' }]), /invalid date/);
  assert.throws(() => validateExtraClosures([{ date: '2026-05-01', name: '', kind: 'logistics' }]), /name/);
  assert.throws(() => validateExtraClosures([{ date: '2026-05-01', name: 'x', kind: 'public' }]), /kind/);
});

test('kstYear flips at 15:00 UTC on Dec 31', () => {
  assert.equal(kstYear(new Date('2026-12-31T14:59:59Z')), 2026);
  assert.equal(kstYear(new Date('2026-12-31T15:00:00Z')), 2027);
});

test('service key: already-encoded key is kept, raw key is encoded, empty fails', () => {
  assert.equal(encodeServiceKey('abc%2Bdef%3D%3D'), 'abc%2Bdef%3D%3D');
  assert.equal(encodeServiceKey('abc+def=='), 'abc%2Bdef%3D%3D');
  assert.throws(() => encodeServiceKey(''), /not set/);
  assert.throws(() => encodeServiceKey(undefined), /not set/);
});
