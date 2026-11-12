# LindaCare mobile

React Native (Expo) app for the two people the platform actually serves: the
caregiver who delivers care, and the family member who follows it.

Milestone 7. This commit covers **issue #41 — registration with role
selection**. Sign-in (#42), verification and recovery (#43), the caregiver
screens (#44), the family screens (#45), role-based navigation (#46) and the
test and build pass (#47) are still to come.

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
  api/        client.js     fetch wrapper, timeouts, ApiError
              endpoints.js  every call the app makes, named once
  components/               the design system from the mockups
  data/       locality.js   GENERATED — see "Keeping lists in step"
  navigation/               the signed-out stack
  screens/                  RegisterScreen (#41), Verify and Login placeholders
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

50 tests, two suites.

`src/validation/register.test.js` covers the validation mirror and the payload
mapping — the part most likely to drift from the service without anyone
noticing. `src/screens/RegisterScreen.test.jsx` covers the five things that
would make the screen wrong rather than merely ugly: the two roles ask for
different fields, switching role keeps what was already typed, a refusal from
the service lands on the field that caused it, a second tap cannot start a
second registration, and a success hands off with the number the service was
actually given.

The full component pass, the auth store and the refresh interceptor are issue
#47.

Two things worth knowing if you extend these:

- React Native Testing Library 14 made `render` and every `fireEvent` method
  **async**. Not awaiting them appears to work and then asserts against the
  frame before the one you meant.
- `FlatList` renders only its first batch, so an option far down a long list
  genuinely is not on screen. The select helper searches first, which is also
  what a person does with 47 counties.

### A bug these tests caught

The phone and county rules were first written as object-level `superRefine`
checks. Zod skips a schema-level refinement whenever any *field* in the object
failed, so a landline number plus an unticked consent box reported only the
consent box — the number surfaced one submit later. Both rules are built into
the fields now (`schemaFor` takes the dial code and country for exactly this
reason), and two regression tests pin the behaviour.
