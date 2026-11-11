# MzaziCare — Security Console

The administrator dashboard for the MzaziCare authentication service: security
event visualisation, anomaly review, and the response actions an administrator
takes after reviewing them.

React 19 + Vite, talking to the `auth-service` REST API. No mock data — every
figure on screen is a row the detection layers wrote.

## Requirements

- Node.js 20 or newer
- The `auth-service` running, with its PostgreSQL and Redis
- An **administrator** account on that service

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

The dev server proxies `/api` to `http://127.0.0.1:3000`. Point it elsewhere with
`AUTH_SERVICE_URL`. Copy `.env.example` to `.env` if you need to change anything;
nothing in it is required for a local run.

```bash
npm run build        # production bundle into dist/
npm run preview      # serve that bundle
```

## You need an administrator account

Administrators are never self-registered — `POST /auth/register` only accepts
`family` and `caregiver` roles — so the account has to be provisioned directly:

```sql
INSERT INTO users (phone_number, full_name, role, account_status, phone_verified, consent_at)
VALUES ('+254700000001', 'Ops Administrator', 'administrator', 'active', TRUE, NOW())
ON CONFLICT (phone_number) DO UPDATE
  SET role = 'administrator', account_status = 'active', phone_verified = TRUE;
```

With `OTP_DEV_MODE=true` the service prints the login code to its own console
instead of sending an SMS, which is what makes this usable without a live
Africa's Talking account.

## Signing in

Three steps, because the service has three:

1. **The number.** The service answers identically whether or not it is
   registered, so the console cannot be used to discover which numbers exist —
   and the wording on screen matches that.
2. **The code.** Six digits, valid for five minutes.
3. **A second code**, when the risk engine is not satisfied — which it will not
   be the first time you sign in from a given machine. This is not an error. The
   device is remembered afterwards, so it is a one-off per workstation.

A sign-in from this console is scored and recorded exactly like any other, by
the same risk engine. The console is not exempt from the system it monitors.

### Non-administrators are refused

A family member or caregiver can sign in to the auth service legitimately and
receive a valid token; they are simply not entitled to this application. The
console asks the service who it just signed in, and if the answer is not an
administrator it **ends the session it just created** and says so.

That check is a courtesy, not the security boundary. The boundary is the service
re-reading the role from the database on every `/admin` request and refusing a
token whose account has since been suspended. Bypassing the browser-side guard
gets you an empty shell whose every request returns 403.

## Where the tokens live

**In memory. Not localStorage, not sessionStorage, not a readable cookie.**

Anything a script can read, a script injected into this page can read too — and
what it would be reading is an administrator's token for the endpoints that
freeze accounts and end other people's sessions. Of the places a token can sit,
a module variable is the only one that dies with the tab.

The cost is real and worth stating plainly: **a page reload returns you to the
login screen.** Persisting the refresh token anywhere reachable by script would
trade that inconvenience for exactly the exposure this avoids.

The upgrade that removes the cost without reintroducing the risk is an
httpOnly, `SameSite=Strict` refresh cookie issued by the service. That is a
change on the API side; the refresh call is funnelled through one function in
`src/api/client.js` so that when the cookie exists, it stops sending a body and
nothing else in the dashboard changes.

Two things *are* kept in `localStorage`, both deliberately: the theme
preference, and a random per-installation device id. Neither is a credential. A
device id proves nothing on its own — presenting it still requires the phone
that receives the code — and the service treats a recognised device as one weak
signal among five. Without it, the console would be an unrecognised device on
every sign-in, which means a step-up challenge every time and a permanently
inflated risk score for the one account that reviews risk scores.

## Token expiry

The access token lasts fifteen minutes and is refreshed about a minute before it
expires, rather than after a request has already failed. A dashboard with
several panels open would otherwise discover the expiry as four simultaneous
401s.

`src/api/client.js` keeps a single in-flight refresh promise, because the
service rotates the refresh token on every use and treats a second use of the
old one as a replay. Two parallel refreshes would end the session rather than
extend it. The reactive path — refresh once on `TOKEN_EXPIRED`, then replay the
request — remains as the safety net for a token that expires while the tab is
asleep and the timer never fires.

Only `TOKEN_EXPIRED` is retried. `SESSION_ENDED` means someone ended this
session deliberately, and refreshing past that would be the dashboard arguing
with a revocation.

## Colour

The data palette is **validated, not chosen by eye.** `src/styles/tokens.css`
records the measurements: the eight categorical slots clear the colour-vision
separation threshold on every adjacent pair in both light and dark mode, and the
three light-mode slots that fall below 3:1 against the surface carry the
obligation that comes with that result — every chart using them ships a legend,
direct labels, and the same figures as a table.

Dark mode is a selected set of steps, not an inversion.

Severity never relies on colour. Stacking the four severity colours as a chart
series was measured and **rejected**: high against medium separates by less than
the threshold at which ordinary colour vision can distinguish two fills, so
those bands would be indistinguishable to everyone. Severity therefore appears
as a badge carrying its own word, and the event timeline splits by event type,
which uses the validated categorical palette.

## Layout

```
src/
  api/
    client.js        the only place tokens live; expiry, refresh, error shaping
    endpoints.js     every call the dashboard makes, named once
  auth/
    AuthContext.jsx  the three-step sign-in, the role check, refresh scheduling
    ProtectedRoute.jsx
    LoginPage.jsx
    deviceId.js      a stable, non-tracking id for this workstation
  layout/
    DashboardLayout.jsx   the one layout every signed-in route renders inside
    Sidebar.jsx  TopBar.jsx  nav.js  theme.js  icons.jsx
  components/
    States.jsx     loading / empty / error, kept distinct on purpose
    Badge.jsx      severity, decisions, statuses — always colour plus word
  pages/           one per sidebar entry
  styles/
    tokens.css     every colour, with its validation results
    base.css       reset, type, and the shared component set
```

`nav.js` is the single source for the sidebar, the page headings and the
document title, so a page cannot disagree with the menu item that leads to it.

## Accessibility

Keyboard first: a security console is operated by keyboard more than most
interfaces. The focus ring is never removed, only replaced with a clearer one.
There is a skip link past the sidebar, Escape closes the mobile navigation, and
sortable table headers are real buttons.

Loading, empty and error states are announced rather than only drawn. The three
are kept distinct because "nothing matched your filters", "we could not reach
the service" and "you are not allowed to see this" need different things from
the person reading the screen.
