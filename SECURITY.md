# Security posture — administrator dashboard

A review of the dashboard and the admin API behind it against the OWASP Top 10
(2021), plus the deployment headers that are not the application's to set.

This is written to be checkable rather than reassuring. Where something is not
done, it says so and why; where a control exists because of a property that
could change, it names the property.

---

## A01 — Broken access control

**The boundary is in the service, not the browser.** Every `/admin` route runs
`requireActiveRole`, which re-reads the account's role from PostgreSQL on each
request. A token's own `role` claim is never trusted on its own, so a token
minted before an administrator was suspended stops working immediately rather
than at expiry.

The dashboard's `ProtectedRoute` is a usability measure and is commented as one.
Bypassing it yields an empty shell whose every request returns 403.

| Control | Where |
|---|---|
| Role re-read from the database per request | `middleware/ownership.js` |
| Session liveness checked per request (logout is immediate) | `middleware/auth.js` |
| Every refusal recorded in the audit trail | `requireActiveRole` → `logAccess` |
| Administrators have **no** access to care records | `services/resourceAccess.js` |
| Account detail carries no clinical data | asserted in `runtest.js` §20 |
| Self-action guards (cannot freeze or lock yourself) | `adminController`, `adminAccountController` |
| Administrators cannot freeze each other by default | `SECURITY_ADMINS_CAN_FREEZE_ADMINS` |

**Tested:** every admin endpoint is checked for 403 against a family member and
a caregiver, and 401 unauthenticated, in `runtest.js` §18–20. The E2E suite signs
in as a real family account and confirms the console refuses it.

**Known limitation.** The service connects to PostgreSQL as the database owner,
so the append-only audit trigger guards against application bugs and a
compromised service account — not against someone with superuser access. Moving
the service to a role with `INSERT`/`SELECT` only is the next step and is not
something the application can do to itself.

---

## A02 — Cryptographic failures

- OTPs are stored as HMAC-SHA256 digests, never in plaintext.
- Refresh tokens are stored as SHA-256 digests and rotated on every use; a
  second use of a rotated token is treated as a replay and ends the session.
- Access tokens are HS256 with the algorithm **pinned at verification**, so a
  token's own `alg` header cannot select `none`.
- `JWT_SECRET` and `OTP_SECRET` are refused at startup if shorter than 32
  characters — the service exits rather than starting weak.
- Phone numbers are masked in every list an administrator sees.
- HSTS is set but not preloaded; preloading is effectively irreversible and is a
  deployment decision rather than a library default.

**Token storage in the dashboard:** in memory only. Not `localStorage`, not
`sessionStorage`, not a readable cookie — see `frontend/README.md` for the full
reasoning and the accepted cost (a reload returns to the login screen). A test
in `hardening.test.jsx` scans the source and fails if a token is ever written to
browser storage.

---

## A03 — Injection

**SQL.** Every value reaches PostgreSQL as a bound parameter. Filters are
composed from fragments, each consuming its own placeholder; no user input is
concatenated into SQL anywhere. Sort columns and group-by expressions come from
whitelists keyed by what the client may ask for — an unrecognised key falls back
to a default rather than being interpolated. The `securityLayers` SQL `CASE` is
generated from a constant map and quoted through a whitelist.

**ILIKE wildcards.** `%` and `_` in a search term are escaped, so a search for
`%` looks for a literal `%` instead of matching every row. Tested.

**CSV formula injection.** A cell beginning `=`, `+`, `-` or `@` is prefixed with
a tab. The audit trail is a file full of attacker-influenced strings — a crafted
user agent, a URL from a refused request — that an administrator will open in a
spreadsheet, which makes this the realistic attack on an export feature rather
than a theoretical one. Tested in `runtest.js` §19.

**XSS.** React escapes all interpolated text. Nothing in the dashboard uses
`dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML` or
`document.write`, and no `href` or `src` is built from fetched data — all three
are enforced by a source scan in `hardening.test.jsx` that fails if a future
component breaks the invariant. A render test feeds an `<img onerror=…>` payload
through an audit explanation and asserts no element is created.

---

## A04 — Insecure design

- Detection and response are separated: the detectors say how unusual something
  is, `config/securityPolicy.js` decides what that costs, and it is
  configuration because the right answer differs by deployment.
- Responses are graduated — step-up, temporary lock, freeze — and the interface
  presents them least-severe-first with the cost of each stated. An indefinite
  freeze on a false positive locks a family member out of a relative's care
  record until someone else undoes it.
- Every administrator action requires a reason of at least five characters,
  stored with the action.
- Review verdicts are recorded so the false-positive rate can be measured on
  this deployment's users rather than quoted from the training set, and the rate
  is never reported without its coverage.
- Failure modes are chosen deliberately: ownership checks **fail closed** (503
  on a database error, never allow), velocity checks **fail open** (a Redis
  outage must not become a full outage).

---

## A05 — Security misconfiguration

| Setting | Value |
|---|---|
| CORS | allowlist from `CORS_ORIGINS`; default `localhost:5173`. Previously `cors()` with no arguments, which reflected any origin. |
| CORS credentials | `false` — the browser will not attach cookies even if one is later set |
| CSP (API) | `default-src 'none'`, `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'none'` |
| CSP (dashboard) | injected at build time; `script-src 'self'` with no `unsafe-inline` |
| X-Frame-Options | `DENY`, alongside `frame-ancestors` |
| Referrer-Policy | `no-referrer` (API), `same-origin` (dashboard) |
| `X-Content-Type-Options` | `nosniff`, including explicitly on the CSV export |
| Body size | 10 kB |
| `trust proxy` | a hop count, never `true` — `true` lets anyone spoof `X-Forwarded-For` and bypass per-IP limits |
| Robots | `noindex, nofollow` on the console |

The dashboard's CSP is applied to **builds only**: the dev server needs an
inline script for hot reload, and allowing inline scripts so that development
works would ship the directive that matters most in a weakened state.

`style-src` allows `'unsafe-inline'` because React style props, Recharts and
Leaflet all set inline `style` attributes. An inline style cannot execute code;
this is the directive it is reasonable to relax and `script-src` is the one it is
not.

### Headers the application cannot set

`frame-ancestors` cannot be expressed in a meta tag, and HSTS is not a CSP
directive. Both must come from whatever serves the built files:

```nginx
# The dashboard's static files
location / {
  add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.tile.openstreetmap.org; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" always;
  add_header Strict-Transport-Security "max-age=15552000; includeSubDomains" always;
  add_header X-Frame-Options "DENY" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "same-origin" always;
  try_files $uri /index.html;
}

# Serving the API under the same origin keeps connect-src 'self' true, which is
# what the shipped CSP assumes.
location /api/ {
  proxy_pass http://127.0.0.1:3000/;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  # Must match TRUST_PROXY in the service's environment.
}
```

If the API is served from a different origin, three things must change together:
the service's `CORS_ORIGINS`, the dashboard's `connect-src`, and
`VITE_API_BASE_URL`. They are listed together because changing one and not the
others fails in a way that looks like a bug rather than a misconfiguration.

---

## A06 — Vulnerable and outdated components

`npm audit` reports **0 vulnerabilities** in both packages.

Four high-severity findings were resolved during this milestone:

| Package | Finding | Resolution |
|---|---|---|
| `joi` | 4 high (prototype pollution, ReDoS) | `overrides: joi@18.3.2` — `africastalking` pins a vulnerable exact version |
| `axios` | 12 advisories | `overrides: axios@$axios` — the nested copy now uses the version the service already depends on |
| `body-parser` | DoS via trailing bytes | `overrides: body-parser@2.4.0` — the version express already resolves to |
| `zod` | memory exhaustion on oversized strings | upgraded 3.25.76 → 4.6.7 (major; verified by the full 253-check suite) |

`npm audit fix --force` wanted to downgrade `africastalking` to 0.8.0, a
breaking change to the SMS path. The overrides reach the same patched versions
without touching it — and in two of three cases they deduplicate onto a version
already in the tree rather than introducing anything new.

---

## A07 — Identification and authentication failures

- Two factors: possession of the phone, plus a risk assessment that can demand a
  third (step-up) or refuse outright.
- Login responses do not reveal whether a number is registered — unregistered,
  unverified and locked numbers all get the same answer, and the dashboard's copy
  matches ("if that number belongs to an account").
- Per-IP rate limits, plus per-session and per-user request velocity that flags
  rather than merely throttling above a hard limit.
- Temporary lockout after repeated incorrect codes, with a stated retry time.
- One active session per account by default (`SINGLE_ACTIVE_SESSION`).
- Logout drops the Redis entry as well as updating the database, so a token
  stops working on the next request rather than at expiry.
- **Idle timeout** in the console: 15 minutes by default
  (`VITE_IDLE_TIMEOUT_MINUTES`), with a warning a minute before. Reset by real
  input only — never by the panels' own refresh timer, which is the mistake that
  makes an idle timeout decorative.

---

## A08 — Software and data integrity failures

The audit trail is **append-only at the database level**. A trigger refuses every
`DELETE` and every `UPDATE` except the foreign keys being nulled when an account
or session is deleted. There is no service endpoint that could modify a row, so
the audit viewer has no edit or delete controls — not because they were left
out, but because there is nothing for them to call. An administrator cannot erase
the record of their own action.

Verified in `runtest.js` §20 by attempting an update directly against the table
and asserting it is refused.

The seed script is the one thing that removes audit rows; it disables the trigger
explicitly and re-enables it in a `finally`, and refuses to run against a
database whose name does not look like a development or test one.

---

## A09 — Logging and monitoring failures

This is what the service is for, so the standard is higher than the category.

- Every authentication event, authorization decision (allowed **and** refused),
  detector firing and administrator action is recorded with a plain-language
  explanation, the acting account, the session, the address and the time.
- Reads of the trail are themselves recorded: an administrator cannot inspect an
  account's history without that inspection becoming part of the history.
- `actor_type` distinguishes a freeze the risk engine applied from one an
  administrator chose — after the fact there is no way to infer it from the other
  columns.
- Exports are recorded as their own action, because a copy in a file outlives
  every access control the service has.
- An audit write never throws into the request path, and a live notification is
  never sent for an event that failed to record.

**Deliberately not logged:** a row per dashboard refresh. The console polls, and
a trail that gained an entry per refresh would bury the events it exists to
preserve. Targeted reads — singling out one account or session — are recorded;
broad listings are not.

---

## A10 — Server-side request forgery

The service makes exactly one outbound HTTP request, to the ML engine at
`ML_ENGINE_URL`, with a 1.5-second timeout. The URL comes from the environment
and never from a request. GeoIP resolution is an offline MaxMind database, so
there is no lookup to redirect. No user-supplied URL is fetched anywhere.

---

## CSRF — why there is no token

**CSRF needs a credential the browser attaches by itself.** This service
authenticates only from an `Authorization` header, which a cross-site request
cannot set. A CSRF token would add a round trip and a failure mode while
defending nothing.

That holds because of two properties, so both are enforced rather than assumed:

1. The CORS allowlist means no unknown origin gets a successful preflight.
2. `credentials: false` means the browser will not attach cookies even if
   something later sets one.

**If the refresh token moves into a cookie** — the upgrade described in
`frontend/README.md`, which would survive a page reload — CSRF becomes real. The
defence is then a `SameSite=Strict` cookie plus an origin check on state-changing
routes. The two settings above are where that work starts, and this paragraph is
the note to whoever makes that change.

---

## Test coverage

| Suite | What it covers | Result |
|---|---|---|
| `auth-service/runtest.js` | 253 integration checks against real PostgreSQL and Redis: auth flow, risk scoring, session anomalies, ownership, audit trail, admin API, charts, export, live stream, review and response actions | 253/253 |
| `frontend` Vitest | 58 tests: every view rendered, trend wording, thresholds, signal explanations, XSS escaping, the three error states, destructive-action confirmation, token refresh deduplication, idle timeout, polling pause, and source-level invariants | 58/58 |
| `frontend` Playwright | Sign in (including step-up) → read a flagged sign-in's explanation → resolve it → confirm it in the audit log; shared filter state; non-administrator refused; unauthenticated redirect; no CSP violations on the built page | see `npm run test:e2e` |

### Bugs this work found and fixed

1. **`authController` imported a helper that was never exported.** The committed
   tree could not start from a clean checkout. (`fc677c6`)
2. **A maximum risk score could not be stored.**
   `anomaly_scores.isolation_forest_score` was `NUMERIC(8,6)` — two digits before
   the decimal point — so a score of 100 raised "numeric field overflow". The
   risk engine catches and logs rather than throwing, correctly, so the failure
   was silent and precisely wrong: the `login_events` row was written, the
   `anomaly_scores` row was not, and the dashboard under-reported its own worst
   detections. Widened to `NUMERIC(5,2)` with a 0–100 check constraint.
3. **Range filters shifted by the server's UTC offset.** `::timestamp` discarded
   the offset on a client-supplied bound — three hours of events in Nairobi.
4. **The idle timeout never fired.** The hook listed `onTimeout` in its effect
   dependencies, and most callers pass an inline arrow; every re-render restarted
   the deadline, and the warning itself causes a re-render. The control looked
   present and did nothing.
5. **Chart colours followed rank, not entity.** Filtering one series out
   repainted the survivors, so two screenshots of the same incident looked like
   two different incidents.
6. **Account-detail history showed blank explanations** for routine events,
   because it skipped the generated fallback that the audit endpoint applies.
