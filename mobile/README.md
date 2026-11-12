# LindaCare mobile

React Native (Expo) app for the two people the platform actually serves: the
caregiver who delivers care, and the family member who follows it.

Milestone 7. Built so far: **#41 — registration with role selection** and
**#42 — sign-in and secure session management**. Account recovery (#43), the
caregiver screens (#44), the family screens (#45), role-based navigation (#46)
and the test and build pass (#47) are still to come.

## Running it

```bash
cd mobile
npm install
npm start          # then press 'a' for Android, or scan the QR code
```

The app talks to `auth-service`, which must be running:

```bash
cd auth-service && node index.js
```

### Pointing the app at the service

`app.json` → `expo.extra.apiBaseUrl`. The default, `http://10.0.2.2:3000`, is
the Android emulator's alias for the host machine's localhost.

| Where the app runs | What to set it to |
| --- | --- |
| Android emulator | `http://10.0.2.2:3000` (default) |
| iOS simulator | `http://localhost:3000` |
| Physical device, same wifi | `http://<your-LAN-IP>:3000` |

A physical device also needs the service listening on all interfaces, not just
loopback, and the firewall to allow port 3000.

### Database and environment

Issue #41 extends the `users` table. Apply the migration before registering
anyone:

```bash
psql -d <database> -f auth-service/sql/mobile_registration.sql
```

It adds `national_id_hash`, `national_id_last4`, `county`, `country_code`,
`care_recipient_name` and `relationship_to_recipient`, a uniqueness index on
the ID hash, and three `CHECK` constraints.

`auth-service/.env` needs one new key, which the migration's header explains:

```
NATIONAL_ID_SECRET=<32 random bytes, hex>
```

It has already been generated in your local `.env` and `.env.test`. Those files
are gitignored, so anyone else cloning this repo generates their own:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Registration throws rather than falling back to an unkeyed hash if it is
missing. A silent fallback would produce a column that looks protected and is
not.

## Layout

```
App.jsx                     splash gate, providers, navigation container
src/
  api/        client.js     fetch wrapper, timeouts, ApiError, refresh interceptor
              endpoints.js  every call the app makes, named once
  auth/       session.js    the tokens: in memory and in the keychain
              AuthContext   restoring / signedOut / signedIn, and the three verbs
              errors.js     a refusal from the service, turned into words
  components/               the design system from the mockups
  data/       locality.js   GENERATED — see "Keeping lists in step"
  navigation/ RootNavigator auth stack or app stack; nothing in between
              AuthNavigator the signed-out screens
              AppNavigator  the signed-in screens (#44–#46 fill this in)
  screens/                  Login, Register, Verify, and a holding Home
  theme/      tokens.js     colour, type, spacing, measured contrast
  validation/               the client-side mirror of the service's rules
```

### Keeping lists in step

`src/data/locality.js` is generated from
`auth-service/src/data/locality.js` and must not be edited by hand:

```bash
npm run sync:locality     # regenerate
npm run check:locality    # fail if out of date (for CI in #47)
```

The service is the authority — it revalidates every county, country and
relationship on arrival, because a request does not have to come from this
app. The app's copy exists only so a dropdown can render without a network
round trip first.

## What #41 built, and what it deliberately did not

### The form

One screen, two shapes, chosen by the segmented control at the top.

| | Caregiver | Family member |
| --- | --- | --- |
| Full name | ✓ | ✓ |
| Phone | +254, fixed | any dialling code |
| National ID | ✓ required | — not collected |
| Email | optional | optional |
| Country | Kenya, implied | ✓ required |
| County | ✓ required | only if in Kenya |
| Relationship | — | ✓ required |
| Family member's name | — | ✓ required |
| Consent | ✓ | ✓ |

Switching role keeps the name, number and email, and clears the rest. Someone
who realises halfway down that they picked the wrong role should not have to
start again — that is where registrations get abandoned.

### Three deviations from the mockups

**No password field.** The mockups show "Create password (min. 8 characters)",
and the service has no passwords: registration and sign-in are both OTP over
SMS. A field whose value is discarded would misrepresent how the account is
secured. Reinstating it is a backend change first (`password_hash`, a hashing
library, a reset endpoint), not a form change.

**A consent checkbox the mockups do not show.** The service refuses a
registration without `consent: true`, and the Kenya Data Protection Act 2019
requires consent to be freely given, specific and informed before this data is
processed. Inferring it from the act of submitting would not be consent under
the Act. It is unticked by default, which is the point.

**Email marked "Optional".** It is optional on the service. Shown unmarked, as
in the mockups, it reads as required — and a caregiver without an email address
is a real person this platform is for.

### The role selection screen

Issue #41 asks for a separate screen before the form. The mockups put the
choice at the top of the form, and that is what is built: one screen instead
of two, with the choice visible and reversible while the form is filled.

### The national ID

Never stored. What goes in the database is an HMAC-SHA256 under
`NATIONAL_ID_SECRET`, plus the last four digits for support to confirm an
identity over the phone. A national ID is a lifelong government identifier
that cannot be reissued after a breach the way a password can, and the
platform only needs it to tell two caregivers apart. The hash is keyed because
an unkeyed hash of a 7–8 digit number is a hundred-million-row rainbow table.

### `/v1` is not in the paths

Issue #41 specifies `POST /v1/auth/register`. The service mounts its router at
`/auth` (`auth-service/index.js`). The running service wins. If a version
prefix is added later it belongs in the base URL, not scattered through
`endpoints.js`.

## Signing in, and staying signed in (#42)

### There is no `POST /auth/login`

Sign-in is strictly OTP, so it is two calls, not one:

| Step | Call | What comes back |
| --- | --- | --- |
| 1 | `POST /auth/otp/request` with `purpose: 'login'` | the same sentence either way |
| 2 | `POST /auth/login/verify` | a session, **or** a step-up challenge |

Step 1 answers identically whether or not the number is registered. That is
deliberate on the service's side, and it is why the app always moves on to the
code screen: a different answer for a number with no account would turn the
sign-in form into a way of finding out who uses the platform.

Issue #42 specifies `POST /v1/auth/login`. There is no such endpoint, and
there cannot be one without a password. The code-entry screen is therefore part
of #42 rather than #43 — without it no session is ever issued, and restore,
logout and the expiry redirect would all be untestable.

### Step-up

`login/verify` can answer `{ status: 'step_up_required', challengeId }` instead
of tokens. That is the risk engine declining to trust the attempt: an
unrecognised device, or a sign-in from somewhere the account could not
plausibly have reached. A second code is sent, and answered on
`POST /auth/step-up/verify`.

`VerifyScreen` stays where it is and changes what it is asking for. Pushing a
second, near-identical screen would leave the first one behind the back
gesture holding a code that has already been spent. The device is trusted on
success, which is what makes the challenge a one-off rather than something the
same person answers on the same phone every time.

### Where the tokens live

`expo-secure-store` — the iOS Keychain and Android's EncryptedSharedPreferences,
keyed by the hardware-backed keystore. Never `AsyncStorage`, which is an
unencrypted SQLite file readable from a rooted phone, an `adb backup` or a
cloud backup of the device; a refresh token read out of one is a week of
someone else's account.

Both tokens live in **one** JSON item. Two items would be two writes, and a
crash between them leaves an access token paired with the previous refresh
token — a session that looks restorable, fails its first refresh, and signs
someone out for no reason they can see.

The item also carries the small user object from sign-in. That copy is used for
exactly one thing: a launch with no signal (below). It is a cache, never the
authority.

### The refresh interceptor

`api.authed.*` attaches the access token and, on a 401, refreshes once and
retries. Four properties, all covered by `src/api/client.test.js`:

- **One refresh at a time.** The service rotates the refresh token on every use
  as a compare-and-swap, so two concurrent refreshes mean the second presents a
  token that no longer exists — and signs the person out mid-session. Every
  request that hits a 401 awaits the same promise. That single promise *is* the
  queue the issue asks for.
- **One retry, never two.** A second 401 after a successful refresh is not an
  expiry; retrying again is how a client loops, empties the rate limit and
  drains the battery.
- **A refused refresh signs you out, with a reason.** "You were signed out"
  with no explanation reads like a bug, and a session the risk engine flagged
  is something the account owner needs to be told about.
- **A network failure does not.** This is the distinction that decides whether
  someone who walked into a lift comes back to the screen they were on or to
  the sign-in form. Only an *answer* from the service ends a session.

`SESSION_ENDED`, `SESSION_FLAGGED` and the account-restriction codes skip the
refresh entirely: refreshing would be asking the service to undo a decision it
had just made.

**There is no Axios.** The issue asks for an Axios interceptor; the app already
had a fetch wrapper from #41, and all four behaviours above are implemented on
it. Adding Axios would mean a dependency and a rewrite of `client.js` to reach
the same place. If it is ever added, `authed()` is the only function that moves.

### Restore on launch

Held behind the splash screen, which is hidden only once the fonts are
registered *and* the restore has settled — from an effect gated on the first
layout, not from `onLayout` alone, because the restore usually finishes after
the first layout and the layout does not happen again.

| At launch | What happens |
| --- | --- |
| Nothing stored | sign-in screen; the service is not called |
| Stored, `/auth/me` succeeds | signed in, with the fresh profile |
| Stored, no connection | **signed in**, with the cached profile |
| Stored, service refuses it | sign-in screen, with the reason |

The third row is the deliberate one. A caregiver opening the app on a matatu
with no signal has valid tokens and must not be signed out; an app that works
only where there is coverage is not usable in the country it is for.

### Logout, and why back-navigation cannot reach a protected screen

`signOut` revokes on the service first, then clears the keychain. The revoke is
best-effort and its failure is swallowed: if it cannot be made — no signal, or
a token the service already stopped accepting — the person still has to end up
signed out on this phone. Leaving them signed in because the network was down
is the worst reading of "logout failed", particularly on a shared device.

Back-navigation is blocked by construction rather than by a guard. `RootNavigator`
mounts *either* the auth stack or the app stack, so a signed-out app does not
contain the protected screens at all. The alternative — one stack plus a
`navigate('Login')` — leaves those screens mounted behind the login form, still
holding whatever they last rendered, readable by whoever is holding the phone.
A guard has to be remembered on every new screen; a swap cannot be forgotten.

### The device fingerprint

A UUID generated once and kept in the keychain under its own key. It is what
device trust is keyed on, so it must be stable, and `clear()` deliberately does
**not** remove it: signing out is not the same as arriving on a new phone, and
dropping it would draw a step-up challenge the person has already answered.

It does not survive reinstalling the app. That is the right failure — a
reinstall genuinely cannot be told apart from a new device — and it costs one
extra SMS.

### Rate limits and lockouts

Two different things, worded differently in `src/auth/errors.js`:

- **429 `OTP_RATE_LIMITED`** — too many codes *requested*. Nothing is wrong
  with the account and the wait is the whole story.
- **423 `ACCOUNT_LOCKED`** — too many codes entered *wrongly*, which locks the
  account for 15 minutes. Someone seeing this without having typed anything
  wrong is being told their number is under attack, so it says to contact
  support. The code input stops accepting attempts, because letting someone
  keep trying makes a lockout look like five more wrong answers.

A wrong code is a field error, not a banner, and it carries the service's
`attemptsLeft` — the thing that stops someone burning all five on a code they
misread from a notification.

## Accessibility

Issue #47 owns the full pass. What is already true:

- Every input has a permanently visible label. No placeholder stands in for
  one, which is what makes the placeholder's low contrast legitimate.
- Every tappable target is at least 48dp, the Android floor.
- Errors carry an icon and words, never colour alone, and announce themselves
  to a screen reader when they appear.
- The role toggle is a radio group, the consent box is a checkbox, and the
  submit button reports busy separately from disabled.
- Every text pairing was measured against WCAG 2.1 AA. The table, the three
  exemptions and the one knowing deviation are documented at the top of
  `src/theme/tokens.js`.

The known deviation: the resting field border is 1.22:1, well under the 3:1
that WCAG 1.4.11 asks of a component boundary. It follows the mockups. The
field stays identifiable from its label and fill, and the focus border is
4.45:1. #47 decides whether to darken the token or accept it explicitly.

## Tests

```bash
npm test
```

89 tests, six suites.

`testTimeout` is set to 60s in `package.json`, which is not a licence for slow
tests. The first `render()` in each suite pays for the first mount of the whole
component tree — navigation, the icon font, the design tokens — and with six
suites across parallel workers that first mount alone can take over 25 seconds
on a modest machine. Every test *after* it in the same suite runs in well under
a second. Without the raised timeout the only test that fails is whichever one
happens to be first in its file, which reads as a bug in that test rather than
as the machine being busy.

| Suite | What it holds still |
| --- | --- |
| `validation/register.test.js` | the validation mirror and the payload mapping — the part most likely to drift from the service without anyone noticing |
| `screens/RegisterScreen.test.jsx` | the two roles ask for different fields, role switching keeps what was typed, a refusal lands on the field that caused it, a second tap cannot start a second registration |
| `api/client.test.js` | the refresh interceptor: one refresh for concurrent 401s, one retry only, a refused refresh signs out, a network failure does not, a flagged session is not refreshed |
| `auth/AuthContext.test.jsx` | restore on launch in all four of its outcomes, the sign-out notice, and a logout that completes even when the revoke call fails |
| `screens/LoginScreen.test.jsx` | a landline never reaches the service, the number that does is E.164, a diaspora number works, a rate limit is explained |
| `screens/VerifyScreen.test.jsx` | the step-up path, `attemptsLeft` under the input, a lockout that stops accepting attempts, the resend countdown |

The exhaustive component pass is still issue #47.

Three things worth knowing if you extend these:

- React Native Testing Library 14 made `render` and every `fireEvent` method
  **async**. Not awaiting them appears to work and then asserts against the
  frame before the one you meant.
- `FlatList` renders only its first batch, so an option far down a long list
  genuinely is not on screen. The select helper searches first, which is also
  what a person does with 47 counties.
- A `jest.mock` factory may not close over an out-of-scope variable unless its
  name begins with `mock`. Getting this wrong fails the whole *suite* with a
  `ReferenceError` from Babel, not the one test, so the count drops by ten and
  the reason is nowhere near the test that needed the mock.

### Two bugs these tests caught

**Zod skips schema-level refinements once a field has failed.** The phone and
county rules were first written as object-level `superRefine` checks, so a
landline number plus an unticked consent box reported only the consent box —
the number surfaced one submit later. Both rules are built into the fields now
(`phoneField` takes the dial code for exactly this reason), and two regression
tests pin the behaviour.

**A `watch()` in the render body deadlocked the sign-in screen's first render.**
`LoginScreen` originally read the dial code with `watch('dialCode')`, stored it
in a ref and built the resolver from that ref. React Hook Form then dispatched
a `formState` update outside React's `act` scope and the first `render` never
settled — a hang, not a failure, and only on the first test in the file. The
resolver now takes the dial code from the `values` it is already handed, and
the chip subscribes through `useWatch`. That is the better shape anyway: the
schema cannot disagree with the values it is checking, and a change of dial
code no longer re-renders the whole form.
