# LindaCare mobile

React Native (Expo) app for the two people the platform actually serves: the
caregiver who delivers care, and the family member who follows it.

Milestone 7. Built so far: **#41 — registration with role selection**,
**#42 — sign-in and secure session management**, **#43 — verification and
passwordless account recovery**, **#44 — the caregiver screens**,
**#45 — the family member screens** and **#46 — role-based navigation,
profile and settings**. The test and build pass (#47) is still to come.

With #43 the loop closes: register, verify, sign out, recover access and sign
back in, with no password at any point and no dead end. With #44 a caregiver
signing in lands on their own day rather than on a holding screen — their
visits, the people they look after, and the report they file afterwards. With
#45 the family member signing in sees how their loved one is doing without
having to phone anyone. With #46 both portals become tabbed apps chosen from
the access token's role, and each person can manage their own name, phone
number, notifications and sign-out.

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

Issue #41 extends the `users` table and #46 adds account settings. Apply
both before using the app:

```bash
psql -d <database> -f auth-service/sql/mobile_registration.sql
psql -d <database> -f auth-service/sql/account_settings.sql
```

Both are idempotent, so running one again is harmless. #46's migration adds
`users.notification_prefs`, the `push_tokens` table, and the OTP purposes the
app needs: it re-states the whole list, `recovery` (#43) and `phone_change`
(#46) included.

**Do not run `account_recovery.sql` after `account_settings.sql`.** Its only
change is that same purpose list, from before #46, so running it afterwards
removes `phone_change` and every phone-number change then fails at the
database. On a database that already has `account_settings.sql`, it is not
needed at all. If it is run by mistake, run `account_settings.sql` again.
To check:

```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'otps_purpose_check';
-- should list login, registration, step_up, recovery, phone_change
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

#43 adds an optional email channel. Recovery exists for someone who cannot
receive an SMS, so a recovery code that can only be texted is no recovery at
all:

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587                  # 465 switches to implicit TLS
SMTP_USER=                     # omit both to send unauthenticated
SMTP_PASS=
SMTP_FROM=LindaCare <no-reply@lindacare.co.ke>
```

**These are deliberately unset in development.** With no `SMTP_HOST`, or with
`OTP_DEV_MODE=true`, the code prints to the service console instead of being
sent — exactly as SMS already does, so the whole recovery flow runs locally
with no mail account. The service checks the transport at boot and says which
mode it is in; a bad password is reported on startup rather than discovered by
the first person who cannot get into their account.

## Layout

```
App.jsx                     splash gate, providers, navigation container
src/
  api/        client.js     fetch wrapper, timeouts, ApiError, refresh interceptor
              endpoints.js  every auth and account call, named once
              careSource.js the live-or-mock decision, shared by both portals
              caregiver.js  the caregiver portal's calls
              family.js     the family portal's calls (read-only by construction)
              mock/         the stateful care datasets the screens fall back to
  account/    AccountContext notification settings and push status, per person
  auth/       session.js    the tokens: in memory and in the keychain
              AuthContext   restoring / signedOut / signedIn, and the three verbs
              errors.js     a refusal from the service, turned into words
              tokenClaims   the role a refreshed access token carries
  components/               the design system from the mockups
              oneui/        the One UI 9 primitives the caregiver screens use
              caregiver/    the portal frame both portals share: sidebar, top
                            bar, tab bar
              family/       caregiver card, feed item, loved-one switcher, gate
  constants/  wellbeing.js  the four-point scale both portals read
  data/       locality.js   GENERATED — see "Keeping lists in step"
  hooks/      useAsyncResource    one load, four states, for every list
              useOptimisticTasks  tick now, roll back per task on failure
              usePagedFeed        pull-to-refresh and infinite scroll, race-free
  family/     FamilyContext the chosen loved one, and the family member's settings
  navigation/ RootNavigator auth stack or app stack; nothing in between
              AuthNavigator the signed-out screens
              AppNavigator  one portal per role, and only ever one
              CaregiverNavigator  tabs plus pushed screens, caregiver
              FamilyNavigator     tabs plus pushed screens, family
              portals.js    each portal's sidebar items and tabs
              routes.js     goTo: reach a tab from a pushed screen
              linking.js    deep links and push taps, guarded by role
  notifications/ push.js    the push token, and every way getting one fails
  screens/                  Login, Register, Verify, Recovery, and Home for
                            roles with no portal (administrators)
              caregiver/    Home, Assignments, Recipient, VisitReport, NewReport
              family/       Home, CareUpdates, CarePlan, Schedule, Notifications
              account/      Account, Profile, ChangePhone (both portals)
  theme/      tokens.js     colour, type, spacing, measured contrast, One UI
  utils/      datetime.js   "Today, 14:00" and the rest of the relative dates
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

## Account recovery (#43)

For the person who can no longer receive the SMS: a changed number, a lost
handset, a swapped SIM. They prove they hold a contact the account already
knows, and get a session back. No password is created, because there are none —
recovery restores access rather than resetting a secret.

| Step | Screen | Call |
| --- | --- | --- |
| 1 | `RecoveryScreen` | `POST /auth/recovery/request` with `{ contact }` |
| 2 | `VerifyScreen`, `purpose: 'recovery'` | `POST /auth/recovery/verify` → a session |

### One field, not a choice of two

Someone locked out does not reliably remember whether they registered an email
address or only a phone number. Asking them to pick first adds a decision they
can get wrong, and getting it wrong is indistinguishable from not having an
account. The field takes either and classifies it on the `@`, matching the
service's `classifyContact`.

The two must agree. A contact this form accepts but the service cannot classify
produces the generic "if this account exists" answer, which looks exactly like
a typo — and the person waits for a code that was never going to come.

**One sharp edge, surfaced rather than hidden:** the service assumes a bare
local number is Kenyan, so `0712345678` resolves and a bare `07700900123` does
not. The field says so — *"For a number outside Kenya, include the country
code"* — because a family member in the diaspora being told their own number is
invalid, with no reason, is how this screen fails the people it exists for.

### Why nothing reveals whether an account exists

`/auth/recovery/request` takes an arbitrary address from an unauthenticated
caller. Any answer that varied with what was found would answer *"does this
person use LindaCare?"* to whoever asked — and for a platform whose users are
caregivers and the families of elderly people, that question has a value to the
wrong people and is answerable in bulk.

So an unknown contact, an unverified account, a locked one, a frozen one, an
exhausted OTP budget and a mail server that is down all produce the same 200
and the same sentence. The `channel` in the response is derived from what the
caller *typed*, never from what was found.

Two consequences, both deliberate:

- **A typo looks like success.** The code screen therefore names the contact it
  was sent to and keeps a visible "Try a different contact" link, rather than
  leaving the way back behind a gesture.
- **A genuine delivery failure is invisible to the user.** Nothing can be shown
  without also answering the enumeration question, so it is recorded as a
  `recovery_code_failed` audit event at medium severity, where operators see it
  on the dashboard.

A frozen account still receives a code. Withholding it would leave that person
with no way to reach the one screen that can tell them to contact support,
which is a dead end rather than a protection — so `verifyRecovery` sends the
code, and refuses the session *after* the code proves who is asking. That is the
general rule here: say nothing before ownership is proven, be honest after.

### Why there is no step-up on recovery

A sign-in can be challenged with a second code because the first went to the
phone. Recovery is the other way round — the code just answered went to a
channel *other* than the one being recovered, so it already is the second
factor. Another code to the same inbox would add a step and no assurance.

A `block` from the risk engine is still honoured. Recovery is one of the likelier
shapes an account takeover takes, and it is scored on the same features as any
other sign-in. Success is logged as `account_recovered` at **high** severity, not
`info`, and the owner is sent a notification that is never throttled: if it was
not them, that message is their only chance to notice.

### A bug this issue uncovered in the service

`stepUp.challenge` chose its channel with `user.backup_email ? 'backup_email' :
'sms'` and then called `issueOtp(user.phone_number, 'step_up')`, which had no
email path at all. So an account with a backup email was told
`channel: 'backup_email'` while the code went to the phone — and the second
factor was the same phone as the first, which is the exact weakness that
function's own comment says it avoids.

The end-to-end suite asserted `l4.body.channel === 'backup_email'` and passed,
because it was checking the label rather than the delivery. Now that `issueOtp`
takes a channel, the label is true.

## The caregiver screens (#44)

Five screens, reached automatically when the signed-in account's role is
`caregiver`:

| Screen | What it is for |
| --- | --- |
| **Home** | the day: counters, alerts, the assigned-profile strip, today's schedule |
| **Assignments** | the full caseload, searchable, with a status on each person |
| **Care record** | one person: profile, emergency contacts, medications, care notes |
| **Visit report** | check in and out, tick the tasks, record wellbeing, write it up |
| **New report** | choose who a report is about, then open one bound to them |

`AppNavigator` makes the choice on `user.role`, which comes from `/auth/me`
on every restore. That is the smallest honest version of the role split;
**#46 owns the real one**, with the family stack beside it and the shared
profile and settings screens.

### There is no care module on the service yet

This is the constraint the whole data layer is shaped around. `auth-service`
has care profiles and assignments (`profileRoutes.js`, scoped at the database
by `resourceAccess.js`) and nothing else: **no visits, no tasks, no check-in,
no care notes, no emergency contacts.** Four of the issue's seven checklist
items have no endpoint behind them.

So all care data reads from *one* source, chosen once per app run in
`src/api/careSource.js` and shared by both portals, and the mocks in
`src/api/mock/` answer in exactly the shapes the care module is specified to
answer in. When that module lands, the API files change and the screens do not.

`app.json` → `expo.extra.careApi`:

| Value | Behaviour |
| --- | --- |
| `auto` (default) | probe `GET /care/health` once; fall back to the mock on a 404 |
| `mock` | never call the service — a demo, or a laptop with no database |
| `live` | never fall back — what CI runs once the module exists |

The mock is not a fixture. It is stateful (a tick, a check-in and a filed
report are all still true on the next screen), it sleeps on every call so
loading states actually appear in development, and `mockControls.failFor(n)`
makes the next *n* calls fail so the error state of every list and the
rollback of an optimistic write can be looked at by hand.

**What `auto` deliberately will not do** is fall back on a 500, a timeout or a
dead network. Those mean the module may well be there and simply having a bad
minute, and swapping a caregiver onto fixture data at that moment would show
them three invented patients and a schedule that is not theirs. An error
message is the correct answer; `api/caregiver.test.js` pins it.

### Only your own patients — and the filter is not in the app

Acceptance criterion 1 is enforced at the database. `listAccessibleProfiles`
joins through `assignments` and returns only active, in-window rows; the care
module's `/care/assignments` is specified to do the same. The screens render
whatever they are handed and filter nothing. A filter written in a React
component is a filter anybody holding the phone can remove, and it teaches the
next person that client-side filtering is how this codebase does
authorization.

### Ticking a task: immediate, and rolled back per task

The naive optimistic update keeps a copy of the task before the write and
restores it on failure. That breaks the moment a second tap lands while the
first is in flight — which, on a five-item checklist, is the normal case:

- two writes race, and the slower reply overwrites the newer state;
- a failure rolls back to a snapshot taken before the *other* two ticks,
  silently unticking work that saved perfectly well;
- a tick and an untick of the same task land out of order, leaving the screen
  disagreeing with the service and nothing on screen to explain it.

`useOptimisticTasks` numbers every tap. A reply may only settle its own task,
and only if it is still the newest attempt for that task; anything older is a
reply to a question that has since been asked again and is dropped. A rollback
restores the value *that* task had before *its* tap, so the other four are
untouched, and the message lands on the row that failed rather than in one
banner that leaves the caregiver guessing which of five ticks did not take.

Each tick is persisted when it happens rather than held as form state. A
caregiver can be in a house for ninety minutes; phones die and apps get killed
for memory, and an interrupted visit should resume where it was.

### Three departures from the mockups

**The check-in and check-out times are not typable.** The mockup draws them as
fields with a clock icon. They are filled by the Check in and Check out
buttons and show what was actually recorded.

A visit report is what a family member reads, what a supervisor reviews after
a complaint, and an input to the anomaly detection the rest of this platform
exists for. A free-text time makes "I arrived at 14:00" an assertion rather
than an observation — a caregiver running forty minutes late can make the
record say otherwise with four keystrokes — and, worse, makes every *honest*
report indistinguishable from a dishonest one. A genuinely wrong time is a
supervisor amending the record with a reason attached, which is a different
screen in a different milestone.

**Emergency contacts sit above medications**, not at the bottom with the
reference material. The worst moment this screen is ever opened in is the one
where somebody has fallen and a phone number is needed in ten seconds, and in
that moment a contact list below a scrolling medication history might as well
not exist. Every number is one tap to dial.

**Alerts sit above the profile strip**, which the mockup puts first. An alert
nobody scrolls to is an alert that did not happen. When there are none, the
section is not drawn at all.

### The collapsible sidebar

One component, two behaviours, chosen by screen width rather than by platform
(`oneui.sidebar.overlayBelow`, 700dp):

- **≥ 700dp** — tablet, or a phone in landscape. The sidebar is permanent, as
  the mockups draw it. Collapsed it is a 68dp icon rail; expanded it pushes
  the content across.
- **< 700dp** — a phone upright. It is not there until asked for, then floats
  over the content with a scrim, dismissed by a tap outside, by the back
  gesture, or by picking a destination.

Collapsing never removes the navigation: on the rail every destination is
still one tap away, it just has no label. A collapsed state that hides the way
out of a screen is a dead end wearing an animation.

The open/closed flag lives in `PortalChrome`, above the navigator, because
every screen draws its own `PortalShell`. Held inside the shell it would reset
on each navigation, and expanding the sidebar, tapping Assignments and
arriving at a collapsed one would be the normal experience.

### One UI 9

The caregiver screens are drawn in Samsung's design language, which is what
the phones this app is installed on in Nairobi actually run. The tokens are in
the `oneui` block at the foot of `src/theme/tokens.js`; everything there is
additive, so #41–#43 are untouched and the auth screens keep their 10dp
corners.

What it actually asks for, beyond round corners:

- **Reach.** Content starts low and the things you touch sit under a thumb.
  That is why every screen opens with a large title in the upper third and why
  the committing action is pinned to the bottom rather than following the
  content — a submit button you have to scroll to is one people miss.
- **The collapsing title.** The large heading shrinks into the compact bar as
  the page scrolls, giving the room back. Both titles run off one scroll
  offset on the native driver, so the text does not lag the finger on a
  mid-range Android. `PortalShell` owns the ScrollView for this reason; a
  screen that cannot use it passes `scroll={false}` and keeps the chrome.
- **Grouping, not elevation.** Related rows live in one 26dp container with
  inset hairlines between them; unrelated groups are separated by space. There
  is no `elevation` prop on `Card` — depth is not how this language
  distinguishes things.
- **Concentric corners.** A control inside a 26dp card gets 18dp, not 26dp.
- **Restraint in motion.** A press is a short inward scale, layered over
  Android's own ripple rather than instead of it.

## The family member screens (#45)

There were no mockups for these. They were inferred from the issue and built in
the same frame as the caregiver portal, with the same sidebar, top bar and
design language, so someone who has seen one portal does not have to learn the
other.

| Screen | What it is for |
| --- | --- |
| **Home** | how the loved one is doing, the next visit, the caregiver, the latest updates |
| **Care Updates** | every completed visit, care note and incident; pull-to-refresh, infinite scroll, filters |
| **Care Plan** | the profile, care plan, medications, care team and emergency contacts, read-only, plus the family member's own settings |
| **Schedule** | upcoming visits grouped by day, naming who is coming |
| **Notifications** | care notifications and account security notices in one list |

### One portal per role, enforced by construction

"A caregiver can never reach family screens, and the reverse." `AppNavigator`
mounts **one** navigator per role, so a caregiver's app does not contain the
family screens at all. A single stack that registered both portals and chose a
home screen by role would leave every screen reachable by anything that calls
`navigate()` — a deep link, a notification tap, a stray line in a later issue —
and each of those paths would need a guard someone could forget.

The route names differ between portals (`FamilyHome`, not `Home`), so a stray
cross-portal `navigate` fails loudly in development. Any other role (an
administrator) gets a screen that points to the web console. The mocks also
refuse the wrong role with a 403, as `requireActiveRole` does on the service,
so a portal mix-up is caught before the real care module exists.

### Role changes take effect on the next token refresh

The service already does its half: the refresh handler signs the new access
token from the *current* `users` row, so the role is in the next token the
phone receives. What was missing was the app noticing. `user.role` was set at
sign-in and re-read only at launch, so a role change could sit unnoticed for
days on a phone that is never restarted.

Now `session.save` reads the role out of each rotated token
(`auth/tokenClaims.js`). If it differs from the stored one, the session layer
corrects the stored profile and tells `AuthContext`. `AppNavigator` then
re-renders with the other portal, and React unmounts the old navigator with
its history, so the back gesture cannot walk into it. No extra request is
added to the refresh path.

The claim is not verified on the phone, and doesn't need to be: it only
decides which screens to mount. Every request still carries the token, which
the service verifies and scopes by role.

### Read-only means there is nothing to press

The issue says family members must not edit care data. There are no disabled
inputs or pencil icons that lead to a refusal, because a greyed-out field still
reads as "a form someone else may fill in". The care plan says plainly that it
is the care team's record and who to tell if something in it is wrong.
`api/family.js` has no function that writes care data at all, and
`family.test.js` fails if one is ever added.

### "Profile edits persist after relaunch"

This is the one place the issue pulls against itself: the loved one's profile
and care plan are read-only, yet profile edits must persist. The read-only rule
is explicit and is a safety rule, so it wins. The edits that exist are the
family member's own settings, on a separately titled card at the foot of the
Care Plan screen:

- **what they call their loved one** ("Mum" rather than "Margaret Wanjiku"),
  used on every screen;
- **which care notifications they want** (completed visits, care notes and
  schedule changes). Incidents and account security notices cannot be muted,
  and a settings file that claims otherwise is ignored;
- **which loved one the app opens on**, when the account is linked to more
  than one.

These are kept in the keychain per account (`FamilyContext`), so they survive
a relaunch and a sign-out, and are not shared with whoever signs in next on a
shared phone. None of them is care data and none goes to the service. Editing
the account's own name and email needs a service endpoint that does not exist
yet, and belongs with the profile screen in #46.

### The feed: pull-to-refresh and infinite scroll

`usePagedFeed` handles the ways a feed goes wrong on a phone and looks fine on
a laptop:

- `onEndReached` fires several times, so page loads are guarded by a ref and a
  page is never requested twice.
- A refresh that starts while page three is in flight makes the late page
  three get dropped, rather than appended to a list it no longer belongs to.
- Items are de-duplicated by id across pages, and the cursor is the last id
  shown rather than an offset, so a report filed between two page loads cannot
  shift an item onto both.
- A failure on a later page keeps the pages already on screen and puts a retry
  row at the bottom.

Filters ask the service rather than hiding loaded rows. Hiding them would show
"no incidents" whenever the one incident sat on page four.

The feed uses its own FlatList rather than the shell's ScrollView. A FlatList
inside a ScrollView renders every row and fires `onEndReached` constantly,
which would request three weeks of history in the first second.

### What comes from where

| Data | Source |
| --- | --- |
| Feed, care plan, schedule, caregiver card, care notifications | `careSource.route`, the same live-or-mock decision the caregiver portal uses |
| Account security notices | always the real `GET /auth/notifications` |

Account notices are never replaced by fixtures: a family member told by a mock
that nothing has happened to their account, on the day someone else signed into
it, is the worst thing that screen could do. The two halves load side by side,
and either failing leaves the other on screen with a banner naming what is
missing.

The service masks caregiver numbers in its care-team listing (`maskPhone`).
When a number arrives masked, the caregiver card says the care team has not
shared a direct number instead of drawing Call and Message buttons that dial
nothing.

## Role-based navigation, profile and settings (#46)

### Tabs for destinations, a stack for things you open

Each portal is now a stack whose first screen is a bottom-tab navigator:

| Portal | Tabs | Pushed over the tabs |
| --- | --- | --- |
| Caregiver | Home, Assignments, Report, Account | care record, visit report, profile, phone change |
| Family | Home, Updates, Care Plan, Schedule, Account | notifications, profile, phone change |

The tabs are the places a person goes, and each keeps its scroll position and
state. Anything you *open* is pushed over the tabs and hides the bar, so a
visit report never has a tab bar under it inviting a tap that abandons it.

The collapsible sidebar from #44 stays. On a tablet or in landscape it is
permanently open and is the navigation, so the tab bar draws nothing there. On
a phone the tab bar is the navigation, under the thumb, and the sidebar sits
behind the menu button. A family member's Notifications screen lives there
and behind the bell on Home: a sixth tab would not fit a 360dp phone.

React Navigation 7 will not reach down into a child navigator by name. From a
care record, `navigate('Assignments')` silently does nothing. So screens reach
tabs through `goTo` (`navigation/routes.js`), which knows from the portal
definition which names are tabs. The deprecated switch that restores the old
behaviour is not used, because it would also let a name resolve against
whatever navigator happens to be nested below.

### The portal is chosen from the access token's role claim

The issue says so, and it is the right source: the service authorises every
request with the role in the token (`verifyToken` reads `payload.role`), so the
app mounts exactly the screens the service will answer for. The stored profile's
role is only a fallback for a token the app cannot read. #45 already makes a
refreshed token's role take effect without a relaunch.

### Deep links cannot cross portals

`lindacare://` links and the `url` a tapped push notification carries both go
through one guard (`navigation/linking.js`):

| The link is for | Signed in as | What happens |
| --- | --- | --- |
| this role, or both (`home`, `account`) | anyone | opens that role's own screen |
| the other role (`recipients/…` for a family member) | the wrong role | nothing opens, and a notice says the link is for the other kind of account |
| any portal | nobody | nothing opens, and a notice says to sign in first |
| nothing | anyone | ignored |

Refusing means returning no navigation state at all. Relying on the navigator
to reject an unknown route would work, but a link half-resolved into a parent
route with a missing child is how an app ends up on a blank screen.

Push taps go through the same `subscribe` / `getInitialURL` pipeline as
external links, rather than being navigated by hand, because a push that
skipped the guard would be the easiest way around it.

A link chooses a screen, never whose data that screen shows. A care-record
link carries an id, and the service answers only for someone on the caller's
own caseload.

### Profile: name and phone number, and no password

**Name.** Saved with `PATCH /auth/me` under the same rule registration applies,
then written into the stored session, so an offline relaunch greets the person
by the new name. The body is strict, so the edit cannot carry a `role` with it.

**Phone number.** This is how the account signs in, so changing it is changing
the credential, and it takes two SMS codes sent at once:

- one to the **current** number, proving the owner wants this. Without it, a
  stolen session could move the account onto the thief's number for good.
- one to the **new** number, proving the person holds it. Without it, a typo
  moves the account onto a stranger's phone.

A code arriving unasked on the current number is also the owner's alarm. On
success:

- every other session ends, along with its push tokens;
- the old number gets an SMS naming the change, with the new number masked in
  case the old SIM has been recycled to a stranger;
- the change goes into the audit trail.

Five wrong guesses burn the code but do not lock the account, because locking
would let a session thief lock the owner out by guessing wrong on purpose.

A wrong code on these routes returns **422, not 401**. The app's refresh
interceptor treats a 401 on an authenticated call as an expired token: it
refreshes and replays the request, which would spend a second attempt on a
code typed once.

**There is no password-change screen.** The issue mentions one, but this
platform has no passwords: sign-in is by SMS code (#42) and recovery by a
second contact (#43). The phone number is the credential, and the phone-change
flow above is what changing it means here.

### Settings: notifications, app version, sign out

The Account tab holds the profile summary, notification settings, the app
version, which care data source is in use (live or demo), and sign-out.

**Notification preferences live on the service** (`users.notification_prefs`,
`GET`/`PUT /auth/me/preferences`), because whatever sends pushes runs there.
They are cached in the keychain for offline launches. The service defines each
role's categories and refuses to mute what must never be muted: account
security notices for everyone, and incidents for family members. The app also
keeps its own never-muted floor, so a corrupted or tampered cache read offline
still cannot hide an incident.

This replaces the device-only switches #45 put on the care plan. Those only
filtered the in-app list, because a push sender could never have read them.
There is now one set of choices, and both pushes and the in-app list obey it.
The nickname for a loved one stays on the care plan, on the phone, because it
is about how the app speaks to one person.

**Sign-out asks first**, in place rather than in a system dialog. Signing back
in costs an SMS code.

### Push tokens

On sign-in the app asks for notification permission once, and never again on
its own initiative. After a "no", only the Settings switch asks again, because
the person has just asked for exactly that. The token goes to
`POST /auth/push-tokens`.

The token is an Expo push token when an EAS project id is configured, and the
device's FCM or APNs token otherwise. Every way of not getting one is a status
the Settings screen puts into words, never an exception or a switch that says
"on" while nothing will arrive:

| Status | Meaning |
| --- | --- |
| on | registered with the service |
| denied | the person said no; only the phone's own settings can undo it |
| unsupported | an emulator or simulator |
| unavailable | the platform would not issue a token, or the service was unreachable |
| off | switched off in the app |

**A token is bound to a session, not only to a user.** Signing out revokes the
session's tokens straight away. Any other way a session ends — signing in on
another device (one active session per account by default), an administrator,
the risk engine, a phone-number change — stops delivery too, because
`pushTokens.activeForUser` (the only thing a future sender may read) joins on
the session still being active. The end-to-end suite checks this by flagging a
session whose token was never revoked.

Nothing sends pushes yet. The care events worth pushing (a visit filed, an
incident) belong to the care module, which does not exist; this is the half of
the contract that can be built now.

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

From #44:

- Status is never colour alone. Every chip carries an icon as well as a tint,
  and a done task is struck through as well as dimmed.
- Collapsing the sidebar **unmounts** the labels rather than fading them. A
  screen reader happily reads text at opacity 0, and would otherwise announce
  every label on a rail that visibly has none.
- No two controls on one screen share an accessible name. Two tests caught
  real collisions here — a search box's × and an empty state's button both
  called "Clear search", and a radio and a text field both called "Care note".
- A stat tile is one element, so it announces "3 assigned elders" rather than
  "3" followed by an unrelated label.
- A disabled submit button always has the reason written directly beneath it;
  on the visit report the footer names the first thing standing in the way.
- Lists announce their state: skeletons are a `progressbar`, errors and
  per-task failures are live regions.

The known deviation: the resting field border is 1.22:1, well under the 3:1
that WCAG 1.4.11 asks of a component boundary. It follows the mockups. The
field stays identifiable from its label and fill, and the focus border is
4.45:1. #47 decides whether to darken the token or accept it explicitly.

## Tests

```bash
npm test
```

356 tests, twenty-nine suites.

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
| `screens/VerifyScreen.test.jsx` | the step-up path, `attemptsLeft` under the input, a lockout that stops accepting attempts, the resend countdown, and recovery posting to its own endpoint |
| `screens/RecoveryScreen.test.jsx` | an unregistered contact behaves identically to a registered one, a bare foreign number is explained rather than refused, an email is lowercased and a Kenyan number normalised |
| `hooks/useOptimisticTasks.test.js` | the tick lands before the request does; a failure rolls back **only its own** task; a stale reply neither resurrects an old state nor rolls anything back; a reload mid-write does not throw away the tick |
| `api/caregiver.test.js` | a 404 means "no care module" and falls back; a 500 or a dead network does **not**; the probe happens once; `live` never reaches for the mock; a snake_case service reads the same as a camelCase one |
| `utils/datetime.test.js` | relative dates counted by calendar day, not elapsed hours — 23:30 and 00:30 are a day apart, 23:59 is still "Today", and a plain `YYYY-MM-DD` never shifts a timezone |
| `screens/caregiver/CaregiverHomeScreen.test.jsx` | "View all" reaches Assignments and "Check in" reaches the report with `autoCheckIn`; a filed visit does not check in again; the risk badge appears only when the source supplies one |
| `screens/caregiver/AssignmentsScreen.test.jsx` | search filters by name and by address; a typo says "no match" and never "no assignments"; a failed refresh keeps the list on screen |
| `screens/caregiver/RecipientDetailScreen.test.jsx` | contacts are above medications; a number dials with its spaces stripped; an incident demands more detail than a note; a dismissed sheet does not discard the draft |
| `screens/caregiver/VisitReportScreen.test.jsx` | the submit gate in all three of its forms; a tick that fails is put back; **the times are not typable**; a failed submit keeps the written report on screen |
| `components/oneui/Touchable.test.jsx` | the press wrapper does not eat `flex` or `alignSelf` — a tappable stat tile still shares its row, a full-width button is still full width |
| `screens/caregiver/NewReportScreen.test.jsx` | today's visit opens a report attached to that visit, a name from the caseload opens one attached only to the person |
| `navigation/AppNavigator.test.jsx` | **a caregiver can never reach family screens, and the reverse** — the other portal's routes do not exist and cannot be navigated to by name; **a role change on the next token refresh swaps the portal** with no relaunch, leaves no history to go back into, and is remembered for an offline launch |
| `auth/tokenClaims.test.js` | the role is read from a real token, base64url and padding included; anything that is not a JWT answers null rather than failing a refresh |
| `hooks/usePagedFeed.test.js` | one request when `onEndReached` fires three times; a page in flight when a refresh starts is dropped; no update shown twice; a failed later page keeps the earlier ones |
| `api/family.test.js` | nothing in the family API can write care data; account notices survive the care service failing, and the reverse; the mocks refuse the wrong role; the mock feed's cursor does not repeat an item filed between pages |
| `screens/family/FamilyHomeScreen.test.jsx` | status, the care team's note and the last visit without scrolling; the loved-one switcher moves the whole screen, never mixing two parents |
| `screens/family/CareUpdatesScreen.test.jsx` | infinite scroll driven by a real scroll to the end, pull-to-refresh fetching what is new, filters asking the service, an incident never truncated |
| `screens/family/CarePlanScreen.test.jsx` | exactly one text field and it is not the record; **settings persist after relaunch**, per account; a masked caregiver number is explained rather than dialled |
| `screens/family/ScheduleAndNotifications.test.jsx` | visits grouped by day naming who is coming; a muted category is hidden and the list says so; incidents and account notices are never hidden; half a list is never presented as the whole |
| `navigation/linking.test.js` | **a link into the other role's screens opens nothing and says why**; a shared link lands on each role's own screen; signed out opens nothing; a tapped push goes through the same guard; `goTo` reaches tabs from pushed screens |
| `notifications/push.test.js` | an emulator, a no, a missing token and an unreachable service each become a status, never an exception; permission asked once; Expo or device token, labelled |
| `screens/account/AccountScreens.test.jsx` | the role's categories as the service lists them, saved optimistically and put back on refusal, cached for an offline launch; push status in words; sign-out asks first; name edit saved and remembered; **the phone change asks for two codes, labels each, and never stores an unconfirmed number** |
| `components/caregiver/PortalTabBar.test.jsx` | each role's tabs, and only its own; selected announced; hidden on a wide screen |
| `auth/session.test.js` | **a profile edit survives a relaunch**; the portal role is the one in the access token |

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

### Found while building #46

**A wrong code returned 401 on an authenticated route, which the app would
replay.** The sign-in routes rightly answer a wrong code with 401. Copying that
onto the phone-change routes would have made the refresh interceptor treat
every typo as an expired token: refresh, replay, and spend a second of the
five attempts. These routes answer 422.

**The end-to-end suite had not run since #43.** The test database was missing
#41's and #43's migrations, and the #43 section queried
`audit_logs.created_at`, a column that does not exist (it is `logged_at`).
Both are fixed. The suite now passes in full, 300 of 300, including a new #46
section covering the name edit, preferences, push tokens and the two-code
phone change.

**One active session per account changes what "other devices" means.**
`SINGLE_ACTIVE_SESSION` is on by default, so signing in on a second device ends
the first. Push delivery relies on that, through the session join. The phone
change still ends other sessions for deployments that allow several, and the
end-to-end test inserts a second session directly to prove it.

**A tampered preferences cache could have hidden incidents offline.** Muting
read the always-on list from the cached settings. The app now keeps its own
floor (`NEVER_MUTED`), and a test proves the incident stays visible with that
floor and disappears without it.

**Two controls named "Assignments".** On a wide screen, the caregiver's
sidebar destination and the new notification switch shared a name. The
category is now "Assignment changes", named on the service.

### Three bugs found while building #45

**The #44 visit report's title ran to the screen edge.** A screen that passes
`scroll={false}` to `PortalShell` lost the horizontal padding the scroller's
content style had been supplying. It went unnoticed in #44 because the visit
report was the only such screen. The feed in #45 is the second, which made it
visible. The shell now insets the title itself when it has no scroller.

**`Card` dropped accessibility props when it was not pressable.** They were
spread onto the pressable branch only, so a feed item marked `accessible` with
a full spoken summary was read out as a jumble of its parts. Every static card
now passes them through.

**Settings written from inside a state updater.** The first version of
`FamilyContext` saved to the keychain from inside a `setPrefs(current => …)`
updater. That is the same trap as the #44 tick bug: React may run an updater
late or twice. It now computes the next value from a ref and writes once.

### Three bugs the #44 tests caught

**React only runs a state updater eagerly for the first queued update.**
`useOptimisticTasks` originally read the task's previous value out of a
`setTasks(current => …)` updater, which is the obvious way to get at it
synchronously. It worked for the first tap and silently did nothing from the
second onward while anything was still in flight: React evaluates an updater
eagerly only when that fiber's queue is empty — it is an optimisation for
bailing out of no-op updates — so every later tap read `undefined`, hit the
"task not found" guard and returned without ever sending a request. The box
ticked and nothing was saved. The list is now held in a ref as the synchronous
truth, with state purely to render from, and five tests cover the
two-taps-in-flight cases.

**A press wrapper eating `flex`.** `Touchable` animates the press on a
wrapper View, which quietly put a box between every caller and the thing being
laid out: `flex: 1` landed on the inner Pressable and flexed against the
wrapper rather than against the row. The tappable stat tile shrank to its text
while its two plain neighbours expanded, and `full`-width buttons stopped
being full width. It reads as a design problem rather than a bug, which is how
it would have survived review. Layout properties are now lifted to the wrapper
and everything that paints stays on the Pressable.

**Two controls on one screen sharing an accessible name.** The assignments
search box's × and the no-match empty state's button were both called "Clear
search"; in the note sheet, the "Care note" radio and the note field were both
called "Care note". Both surfaced as `getByLabelText` finding multiple
elements — which is the test harness reporting precisely the problem a screen
reader user would hit. Fixed in the components (the empty state now says what
it does, "Show all assignments"; the field is "Care note details"), not in the
tests.

### Two bugs the #41–#43 tests caught

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
