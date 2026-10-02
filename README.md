# static

Static files served via [jsDelivr](https://www.jsdelivr.com/) for Pleand services.
Everything here is public. Contents:

- `holidays/kr` — Korean public holidays plus parcel-delivery closures, used to compute shipping
  departure dates.
- `fonts` — self-hosted web fonts (copied from `jasonKRR/custom-fonts`, same folder layout).

Secrets and repository settings: [SECURITY.md](SECURITY.md).

## holidays/kr

| File | URL |
| --- | --- |
| This year + next year | `https://cdn.jsdelivr.net/gh/Pleand-inc/static@main/holidays/kr/upcoming.json` |
| One year | `https://cdn.jsdelivr.net/gh/Pleand-inc/static@main/holidays/kr/2026.json` |

`upcoming.json` covers a **fixed** range — Jan 1 of the current year (KST) through Dec 31 of the
next year — so it changes only when the data changes or the year rolls over.

```json
{
  "from": "2026-01-01",
  "to": "2027-12-31",
  "days": [
    { "date": "2026-08-14", "name": "택배 없는 날", "kind": "logistics" },
    { "date": "2026-10-03", "name": "개천절", "kind": "public" }
  ]
}
```

- `days` is sorted by date, one entry per date.
- `kind: "public"` — a day the API marks as a holiday (`isHoliday = Y`), including substitute and
  temporary holidays once the API publishes them. `name` is the API's `dateName` as-is.
- `kind: "logistics"` — a day the API does not list but parcel carriers close, from
  [`holidays/kr/extra-closures.json`](holidays/kr/extra-closures.json).
- Data files contain no timestamps. `meta.json` (`checkedAt`) exists only for the keepalive below.

### Source

공공데이터포털 (data.go.kr) — 한국천문연구원 특일 정보 (`SpcdeInfoService/getRestDeInfo`).

### extra-closures.json

Edited by hand: `{ "date": "YYYY-MM-DD", "name": "...", "kind": "logistics" }`. The job merges it
into the year files; if the API returns the same date, the API entry wins. Add a date once it is
announced — e.g. 택배 없는 날 for 2027 has not been announced yet and is not listed.

### Update job

`.github/workflows/holidays-kr.yml` runs daily at 03:00 KST (and on manual dispatch):

1. `node --test`, then `scripts/holidays-kr.mjs` fetches each year with one request. Any API
   error fails the run before any file is written. Manual dispatch with `debug` prints the raw
   API bodies and cross-checks the whole-year result against month-by-month requests.
2. Commits only when a data file changed. If nothing changed but the last commit is 25+ days
   old, it commits `meta.json` so GitHub does not disable the schedule (60 days of inactivity).
3. After a push, purges each changed file from jsDelivr
   (`https://purge.jsdelivr.net/gh/Pleand-inc/static@main/<path>`).

The job needs one API key, kept as a repository secret — see [SECURITY.md](SECURITY.md).

## fonts

Each folder holds a stylesheet and its `woff2` files; the stylesheet references the fonts with
relative URLs, so it works from any path.

| Family | Stylesheet |
| --- | --- |
| GmarketSans | `https://cdn.jsdelivr.net/gh/Pleand-inc/static@main/fonts/GmarketSans/GmarketSans.css` |
| Happiness Sans | `https://cdn.jsdelivr.net/gh/Pleand-inc/static@main/fonts/Happiness-Sans/Happiness-Sans.css` |
| NanumGothic | `https://cdn.jsdelivr.net/gh/Pleand-inc/static@main/fonts/NanumGothic/NanumGothic.css` |
| NanumBarunGothic | `https://cdn.jsdelivr.net/gh/Pleand-inc/static@main/fonts/nanumbarungothic/nanumbarungothic.css` |
