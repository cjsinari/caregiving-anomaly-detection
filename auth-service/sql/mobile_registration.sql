-- Step 7 migration: the fields the mobile registration screens collect (M7, FR01)
--
-- Registration until now was the four things a web session needed: phone, name,
-- role, consent. The mobile app registers people who are about to be matched
-- with each other, and matching needs to know where someone is and, for a
-- family member, who they are registering on behalf of. That is what this adds.
--
-- ── Why the two roles store different things ──
--
-- A caregiver is vetted. They deliver care in person, in a Kenyan county, and
-- the platform cross-checks them against national ID records before they are
-- allowed near a care recipient — so national_id_hash is theirs alone, and
-- county is required of them.
--
-- A family member is not vetted and is frequently not in the country: the
-- Kenyan diaspora is a large part of who pays for and follows this care. They
-- get country_code, and a county only when that country is Kenya. Asking a
-- family member in Manchester for their national ID would collect a government
-- identifier the platform has no use for, so the column is simply not theirs.
--
-- ── Why the national ID is hashed ──
--
-- A national ID is a lifelong government identifier that cannot be reissued
-- after a breach the way a password can. The platform needs it for exactly two
-- things: proving no two caregivers claim the same identity, and letting
-- support confirm an ID over the phone. A keyed hash does the first, the last
-- four digits do the second, and neither gives an attacker who reaches the
-- table a list of usable identity documents. The plaintext is never stored.
--
-- The hash is HMAC-SHA256 under NATIONAL_ID_SECRET, matching how OTPs are
-- stored: an unkeyed hash of a 7-8 digit number is a ten-million-row rainbow
-- table, which is to say no protection at all.

ALTER TABLE users ADD COLUMN IF NOT EXISTS national_id_hash  VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS national_id_last4 VARCHAR(4);
ALTER TABLE users ADD COLUMN IF NOT EXISTS county            VARCHAR(40);
ALTER TABLE users ADD COLUMN IF NOT EXISTS country_code      CHAR(2) NOT NULL DEFAULT 'KE';
ALTER TABLE users ADD COLUMN IF NOT EXISTS care_recipient_name       VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS relationship_to_recipient VARCHAR(20);

COMMENT ON COLUMN users.national_id_hash IS
  'HMAC-SHA256 of the normalised national ID under NATIONAL_ID_SECRET. Caregivers only; never the plaintext.';
COMMENT ON COLUMN users.national_id_last4 IS
  'Last four digits, for support to confirm an identity over the phone without the full number.';
COMMENT ON COLUMN users.country_code IS
  'ISO 3166-1 alpha-2 country of residence. KE for every caregiver; family members may be in the diaspora.';
COMMENT ON COLUMN users.care_recipient_name IS
  'The person a family member is registering to follow. Family members only.';

-- One identity, one caregiver account. Partial, because the column is null for
-- every family member and NULLs would otherwise collide under a plain unique
-- index on some planners.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_national_id
  ON users (national_id_hash) WHERE national_id_hash IS NOT NULL;

-- Caregiver search in M7 is "who is available in this county", so the county
-- column is read far more often than it is written.
CREATE INDEX IF NOT EXISTS idx_users_county_role
  ON users (county, role) WHERE county IS NOT NULL;

-- The relationship is a closed vocabulary, not free text: it drives what the
-- family screens are allowed to show, and a typo'd value would silently widen
-- that. NOT VALID so the migration does not have to re-read a populated table;
-- rows written from here on are checked.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_relationship_check;
ALTER TABLE users ADD CONSTRAINT users_relationship_check
  CHECK (relationship_to_recipient IS NULL OR relationship_to_recipient IN
    ('child', 'spouse', 'parent', 'sibling', 'grandchild', 'niece_nephew',
     'in_law', 'guardian', 'other')) NOT VALID;

-- A caregiver is only ever in Kenya, and a national ID only ever belongs to a
-- caregiver. Both are enforced in the controller; stating them here too means a
-- script or a hand-written INSERT cannot quietly produce a row the application
-- would refuse.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_caregiver_locality_check;
ALTER TABLE users ADD CONSTRAINT users_caregiver_locality_check
  CHECK (role <> 'caregiver' OR country_code = 'KE') NOT VALID;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_national_id_role_check;
ALTER TABLE users ADD CONSTRAINT users_national_id_role_check
  CHECK (national_id_hash IS NULL OR role = 'caregiver') NOT VALID;
