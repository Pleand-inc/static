# Security

Everything in this repository is public and served as-is through jsDelivr. Nothing secret may be
committed here — not in files, workflow logs, artifacts or commit messages.

## Credentials

| Secret | Used by | Scope | If it leaks | Rotation |
| --- | --- | --- | --- | --- |
| `DATA_GO_KR_SERVICE_KEY` | `.github/workflows/holidays-kr.yml` → `scripts/holidays-kr.mjs` | One 공공데이터포털 (data.go.kr) application: 한국천문연구원 특일 정보 | Someone else can spend the account's call quota. The data itself is public. | Re-issue on data.go.kr → `gh secret set DATA_GO_KR_SERVICE_KEY -R Pleand-inc/static` → run the workflow manually and confirm it is green |

- The key exists only as a GitHub Actions repository secret. The script never prints the key or a
  request URL that contains it, and masks it if it ever appears in an error message.
- The key is issued on an individual member account because the organization account could not be
  verified on data.go.kr. The owner and the re-issue follow-up are recorded in Pleand's internal
  credential registry, not here.
- If the key stops working, the daily job fails before writing any file, so the last published
  holiday data keeps being served (it covers through Dec 31 of next year).

## Repository settings

- Only repository collaborators (currently the organization admins) can push or open pull requests
  (`pull_request_creation_policy: collaborators_only`); there are no outside collaborators, deploy
  keys or webhooks. Issues, wiki, projects and discussions are off.
- Workflow runs from fork pull requests always need approval, and the default workflow token is
  read-only (the holidays job alone gets `contents: write`).
- Only GitHub-owned actions are allowed, and every `uses:` is pinned to a full commit SHA.
- `main` cannot be deleted or force-pushed (ruleset `protect-main`).
- Secret scanning and push protection are on.

## Reporting

Report a security problem privately through the repository's **Security → Report a vulnerability**
form (private vulnerability reporting is on). Only the repository administrators see the report.
