// DST wall-clock ambiguity detector using Luxon 3.7.2.
//
// A wall-clock time in a given IANA zone can be:
//   * unambiguous     - maps to exactly one UTC instant
//   * repeated        - maps to TWO UTC instants (DST fall-back)
//   * nonexistent     - maps to ZERO UTC instants (DST spring-forward)
//
// We try three detection strategies and pick the verdict from the most
// reliable one (round-trip via +1h UTC shift). The other two are reported
// as diagnostic signals.

import { DateTime, IANAZone } from 'luxon';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const luxonPkgPath = resolve(__dirname, '..', 'node_modules', 'luxon', 'package.json');
const luxonVersion = JSON.parse(readFileSync(luxonPkgPath, 'utf8')).version;

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Try to detect DST ambiguity for a given wall-clock time in a zone.
 *
 * @returns {{
 *   kind: 'repeated' | 'nonexistent' | 'unambiguous',
 *   earlierUtc?: string,
 *   earlierOffset?: string,
 *   laterUtc?: string,
 *   laterOffset?: string,
 *   utc?: string,
 *   offset?: string,
 *   produced?: string,
 *   diagnostics: {
 *     approach1: { verdict: string, detail: string },
 *     approach2: { verdict: string, detail: string },
 *     approach3: { verdict: string, detail: string }
 *   }
 * }}
 */
function detectAmbiguity(year, month, day, hour, minute, zoneName) {
  const luxonZone = zoneName === 'UTC' ? 'utc' : zoneName;
  const requested = { year, month, day, hour, minute };
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  const wallClockLabel = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${hh}:${mm}`;

  if (!IANAZone.isValidZone(luxonZone) && luxonZone !== 'utc') {
    throw new Error(`Invalid IANA zone: ${zoneName}`);
  }

  // -----------------------------------------------------------------
  // APPROACH 1: Compare offset at the produced instant vs. the same
  // wall-clock time the next day. If they differ, we are crossing a
  // DST boundary; combined with the next-day wall-clock having a
  // *valid* result this is a strong hint that today's time is in
  // the gap.
  // -----------------------------------------------------------------
  const dtToday = DateTime.fromObject(requested, { zone: luxonZone });
  const dtNextDay = DateTime.fromObject(
    { ...requested, day: day + 1 },
    { zone: luxonZone },
  );
  const approach1Verdict =
    dtToday.offset === dtNextDay.offset ? 'same-offset-as-tomorrow' : 'offset-differs-from-tomorrow';
  const approach1Detail = `today offset=${dtToday.toFormat('ZZ')} (${dtToday.toISO()}), tomorrow offset=${dtNextDay.toFormat('ZZ')} (${dtNextDay.toISO()})`;

  // -----------------------------------------------------------------
  // APPROACH 2: Compare toFormat('ZZ') of the produced instant against
  // the same wall-clock recomputed starting from noon UTC nearby.
  // If the offsets match, the wall-clock is unambiguous. If they
  // differ, the wall-clock straddles a DST gap.
  // -----------------------------------------------------------------
  const noonUtcNearby = DateTime.fromObject(
    { year, month, day, hour: 12, minute: 0 },
    { zone: 'utc' },
  );
  const noonUtcWallInZone = noonUtcNearby.setZone(luxonZone);
  const recomputed = DateTime.fromObject(
    {
      year: noonUtcWallInZone.year,
      month: noonUtcWallInZone.month,
      day: noonUtcWallInZone.day,
      hour: noonUtcWallInZone.hour,
      minute: noonUtcWallInZone.minute,
    },
    { zone: luxonZone },
  );
  const approach2Verdict =
    dtToday.toFormat('ZZ') === recomputed.toFormat('ZZ')
      ? 'zz-matches-noon-utc-recompute'
      : 'zz-differs-from-noon-utc-recompute';
  const approach2Detail = `dt=${dtToday.toFormat('ZZ')}, recomputed=${recomputed.toFormat('ZZ')} (noon UTC -> wall ${noonUtcWallInZone.toFormat('yyyy-MM-dd HH:mm')} -> back: ${recomputed.toFormat('HH:mm ZZ')})`;

  // -----------------------------------------------------------------
  // APPROACH 3 (canonical): Round-trip via UTC.
  //   * Nonexistent: Luxon shifts the produced wall-clock, so the
  //     hour/minute/day no longer matches the requested one.
  //   * Repeated:   the produced UTC instant, when shifted by exactly
  //     one hour forward (the typical DST offset), yields a wall-clock
  //     with the same hour/minute/day in the zone but a different
  //     UTC offset.
  //   * Unambiguous: the +1h shift lands on a different wall-clock.
  // -----------------------------------------------------------------
  const produced = dtToday;
  const producedShifted = DateTime.fromMillis(produced.toMillis() + ONE_HOUR_MS).setZone(luxonZone);

  const wallClockMatchesRequested =
    produced.year === year &&
    produced.month === month &&
    produced.day === day &&
    produced.hour === hour &&
    produced.minute === minute;

  const shiftLandsOnSameWallClock =
    producedShifted.year === year &&
    producedShifted.month === month &&
    producedShifted.day === day &&
    producedShifted.hour === hour &&
    producedShifted.minute === minute;

  const approach3Verdict = !wallClockMatchesRequested
    ? 'wall-clock-was-shifted-by-luxon'
    : shiftLandsOnSameWallClock
      ? 'plus-one-hour-still-on-same-wall-clock'
      : 'plus-one-hour-leaves-wall-clock';
  const approach3Detail = `produced=${produced.toISO()} (${produced.toFormat('HH:mm ZZ')}), produced+1h=${producedShifted.toISO()} (${producedShifted.toFormat('HH:mm ZZ')})`;

  // -----------------------------------------------------------------
  // Decide canonical verdict from Approach 3.
  // -----------------------------------------------------------------
  if (!wallClockMatchesRequested) {
    return {
      kind: 'nonexistent',
      produced: produced.toISO(),
      producedOffset: produced.toFormat('ZZ'),
      utc: produced.toUTC().toISO(),
      offset: produced.toFormat('ZZ'),
      diagnostics: {
        approach1: { verdict: approach1Verdict, detail: approach1Detail },
        approach2: { verdict: approach2Verdict, detail: approach2Detail },
        approach3: { verdict: approach3Verdict, detail: approach3Detail },
      },
    };
  }

  if (shiftLandsOnSameWallClock) {
    // Approach 3 says REPEATED.
    // Luxon picks the FIRST (earlier) occurrence by default. We verify
    // by also constructing the LATER occurrence from the shifted UTC.
    return {
      kind: 'repeated',
      earlierUtc: produced.toUTC().toISO(),
      earlierOffset: produced.toFormat('ZZ'),
      laterUtc: producedShifted.toUTC().toISO(),
      laterOffset: producedShifted.toFormat('ZZ'),
      utc: produced.toUTC().toISO(),
      offset: produced.toFormat('ZZ'),
      diagnostics: {
        approach1: { verdict: approach1Verdict, detail: approach1Detail },
        approach2: { verdict: approach2Verdict, detail: approach2Detail },
        approach3: { verdict: approach3Verdict, detail: approach3Detail },
      },
    };
  }

  return {
    kind: 'unambiguous',
    utc: produced.toUTC().toISO(),
    offset: produced.toFormat('ZZ'),
    diagnostics: {
      approach1: { verdict: approach1Verdict, detail: approach1Detail },
      approach2: { verdict: approach2Verdict, detail: approach2Detail },
      approach3: { verdict: approach3Verdict, detail: approach3Detail },
    },
  };
}

// ---------------------------------------------------------------------
// Test cases.
// ---------------------------------------------------------------------
const cases = [
  { label: '2024-11-03 01:30 America/New_York', year: 2024, month: 11, day: 3, hour: 1, minute: 30, zone: 'America/New_York', expected: 'repeated' },
  { label: '2024-06-15 10:00 UTC', year: 2024, month: 6, day: 15, hour: 10, minute: 0, zone: 'UTC', expected: 'unambiguous' },
  { label: '2024-06-15 10:00 America/New_York', year: 2024, month: 6, day: 15, hour: 10, minute: 0, zone: 'America/New_York', expected: 'unambiguous' },
  { label: '2024-03-10 02:30 America/New_York', year: 2024, month: 3, day: 10, hour: 2, minute: 30, zone: 'America/New_York', expected: 'nonexistent' },
];

console.log('DST ambiguity detection (Luxon ' + luxonVersion + ')');
console.log('='.repeat(72));

for (const c of cases) {
  const result = detectAmbiguity(c.year, c.month, c.day, c.hour, c.minute, c.zone);

  console.log('');
  console.log(`Input  : ${c.label}`);
  console.log(`Expect : ${c.expected}`);
  console.log(`Verdict: ${result.kind}  ${result.kind === c.expected ? '[OK]' : '[MISMATCH]'}`);

  if (result.kind === 'repeated') {
    console.log(`  earlier UTC instant : ${result.earlierUtc}  (offset ${result.earlierOffset})`);
    console.log(`  later   UTC instant : ${result.laterUtc}  (offset ${result.laterOffset})`);
  } else if (result.kind === 'nonexistent') {
    console.log(`  Luxon shifted wall-clock to ${result.produced} (offset ${result.producedOffset})`);
  } else {
    console.log(`  UTC instant         : ${result.utc}  (offset ${result.offset})`);
  }

  console.log('  diagnostics:');
  console.log(`    A1 (offset vs tomorrow):    ${result.diagnostics.approach1.verdict}`);
  console.log(`        ${result.diagnostics.approach1.detail}`);
  console.log(`    A2 (ZZ vs noon-UTC recompute): ${result.diagnostics.approach2.verdict}`);
  console.log(`        ${result.diagnostics.approach2.detail}`);
  console.log(`    A3 (+1h round-trip, CANONICAL): ${result.diagnostics.approach3.verdict}`);
  console.log(`        ${result.diagnostics.approach3.detail}`);
}

console.log('');
console.log('='.repeat(72));
console.log('Done.');