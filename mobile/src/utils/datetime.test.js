import {
  day, dayAndTime, dayOffset, duration, greeting, initials, isoDay, longDate, shortDate, time,
} from './datetime';

/*
 * Relative dates, which are the quietest place in this app for a bug to live.
 *
 * "Today, 14:00" under a visit that is actually tomorrow is not a cosmetic
 * slip -- it is a caregiver not turning up. The tests that matter are the ones
 * around midnight and around the week boundary, because those are where
 * counting elapsed hours instead of calendar days gives the wrong answer and
 * looks right the rest of the time.
 */

/** A local-time date, built so these tests do not depend on the runner's zone. */
const local = (y, m, d, hh = 12, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0);

describe('dayOffset counts calendar days, not elapsed hours', () => {
  it('calls 23:30 and 00:30 one day apart', () => {
    // An hour apart, and on different days. Elapsed-hour arithmetic says 0.
    expect(dayOffset(local(2026, 11, 14, 0, 30), local(2026, 11, 13, 23, 30))).toBe(1);
  });

  it('calls 00:05 and 23:55 on the same day zero days apart', () => {
    expect(dayOffset(local(2026, 11, 13, 23, 55), local(2026, 11, 13, 0, 5))).toBe(0);
  });

  it('counts backwards too', () => {
    expect(dayOffset(local(2026, 11, 10), local(2026, 11, 13))).toBe(-3);
  });

  it('survives a month boundary', () => {
    expect(dayOffset(local(2026, 12, 1), local(2026, 11, 30))).toBe(1);
  });
});

describe('day', () => {
  const today = local(2026, 11, 13, 10, 0);   // a Friday

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(today);
  });
  afterEach(() => jest.useRealTimers());

  it('names today, tomorrow and yesterday', () => {
    expect(day(local(2026, 11, 13, 14, 0))).toBe('Today');
    expect(day(local(2026, 11, 14, 9, 0))).toBe('Tomorrow');
    expect(day(local(2026, 11, 12, 14, 20))).toBe('Yesterday');
  });

  it('uses the weekday inside the coming week', () => {
    expect(day(local(2026, 11, 16))).toBe('Mon');
    expect(day(local(2026, 11, 19))).toBe('Thu');
  });

  it('says "Last" for the week just gone', () => {
    expect(day(local(2026, 11, 9))).toBe('Last Mon');
  });

  it('falls back to a full date beyond a week', () => {
    expect(day(local(2026, 10, 2))).toBe('2 Oct 2026');
    expect(day(local(2026, 12, 25))).toBe('25 Dec 2026');
  });

  it('is still today at one minute to midnight', () => {
    expect(day(local(2026, 11, 13, 23, 59))).toBe('Today');
  });

  it('combines with the time the way the schedule prints it', () => {
    expect(dayAndTime(local(2026, 11, 13, 14, 0))).toBe('Today, 14:00');
    expect(dayAndTime(local(2026, 11, 12, 14, 20))).toBe('Yesterday, 14:20');
  });
});

describe('time', () => {
  it('pads to a 24-hour clock', () => {
    expect(time(local(2026, 11, 13, 9, 5))).toBe('09:05');
    expect(time(local(2026, 11, 13, 16, 30))).toBe('16:30');
    expect(time(local(2026, 11, 13, 0, 0))).toBe('00:00');
  });

  it('shows a blank rather than inventing one', () => {
    expect(time(null)).toBe('--:--');
    expect(time('not a date')).toBe('--:--');
  });
});

describe('isoDay', () => {
  it('reads a plain date with no timezone shift', () => {
    // The trap: new Date('2026-01-12') is midnight UTC, which is 11 Jan in
    // any negative offset. This never constructs a Date at all.
    expect(isoDay('2026-01-12')).toBe('12 Jan 2026');
    expect(isoDay('2026-12-31')).toBe('31 Dec 2026');
  });

  it('leaves anything that is not a date alone', () => {
    expect(isoDay(null)).toBe('');
    expect(isoDay('soon')).toBe('soon');
  });
});

describe('duration', () => {
  it('reads an hour and some minutes', () => {
    expect(duration(local(2026, 11, 13, 10, 28), local(2026, 11, 13, 11, 35))).toBe('1h 07m');
  });

  it('drops the hours when there are none', () => {
    expect(duration(local(2026, 11, 13, 10, 0), local(2026, 11, 13, 10, 40))).toBe('40m');
  });

  it('refuses a visit that ended before it began', () => {
    expect(duration(local(2026, 11, 13, 11, 0), local(2026, 11, 13, 10, 0))).toBeNull();
    expect(duration(null, local(2026, 11, 13, 10, 0))).toBeNull();
  });
});

describe('greeting', () => {
  it('changes with the hour', () => {
    expect(greeting(local(2026, 11, 13, 8))).toBe('Good morning');
    expect(greeting(local(2026, 11, 13, 13))).toBe('Good afternoon');
    expect(greeting(local(2026, 11, 13, 19))).toBe('Good evening');
    // Noon is afternoon, midnight is morning. Both are boundaries somebody
    // will otherwise get backwards.
    expect(greeting(local(2026, 11, 13, 12))).toBe('Good afternoon');
    expect(greeting(local(2026, 11, 13, 0))).toBe('Good morning');
  });
});

describe('initials', () => {
  it('takes the first and last name', () => {
    expect(initials('Margaret Wanjiku')).toBe('MW');
    expect(initials('Grace Wanjiru')).toBe('GW');
  });

  it('skips the middle names', () => {
    expect(initials('James Otieno Ochieng')).toBe('JO');
  });

  it('copes with one name, extra spaces and nothing at all', () => {
    expect(initials('Esther')).toBe('ES');
    expect(initials('  Alice   Ochieng  ')).toBe('AO');
    expect(initials('')).toBe('?');
    expect(initials(null)).toBe('?');
  });
});

describe('the long and short date lines', () => {
  it('writes the dashboard date in full', () => {
    expect(longDate(local(2026, 9, 9))).toBe('Wednesday, 9 September 2026');
  });

  it('writes the report subtitle short', () => {
    expect(shortDate(local(2026, 9, 9))).toBe('9 Sep 2026');
  });
});
