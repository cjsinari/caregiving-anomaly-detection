import { colors } from '../theme/tokens';

/*
 * The four-point wellbeing scale a caregiver records on every visit report.
 *
 * It lives in one place because two portals read it. A caregiver chooses
 * "Low" on the visit report; a family member reads it on the care updates
 * feed an hour later. If those two screens each kept their own copy, the first
 * change to one -- a renamed level, a different emoji -- would have a family
 * member reading a word the caregiver never chose, about their own mother.
 */
export const WELLBEING = [
  { value: 'well', emoji: '\u{1F60A}', label: 'Well', tone: colors.success },
  { value: 'okay', emoji: '\u{1F610}', label: 'Okay', tone: colors.info },
  { value: 'low', emoji: '\u{1F61F}', label: 'Low', tone: colors.warning },
  { value: 'unwell', emoji: '\u{1F912}', label: 'Unwell', tone: colors.danger },
];

/** Wellbeing that a supervisor -- and a family member -- will want explained. */
export const CONCERNING = new Set(['low', 'unwell']);

export const wellbeingFor = (value) => WELLBEING.find((w) => w.value === value) || null;
