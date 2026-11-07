import test from 'node:test';
import assert from 'node:assert/strict';
import {validLocationList, validatedDatabase} from '../assets/importers.js';

test('a location list accepts only complete supported location codes', () => {
  for (const value of ['AM-OC-425', 'AM–OC–425', 'am oc 425', ' AM-OC-425, AM-OC-426 ',
    'AM-OC-425;AM-OC-426', 'AM-OC-425\nAM-OC-426']) assert.equal(validLocationList(value), true, value);
  for (const value of ['', null, undefined, 'AM-OC-12345', 'AM-OC-425X', 'AM-OC-425 extra',
    'AM-OC-425,', ',AM-OC-425', 'AM-OC-425,,AM-OC-426', 'CH-OC-425',
    'AM-OC-425, FR-OC-99', 'AM-OC-425\nC-DR-99', 'AM-OC-I25']) assert.equal(validLocationList(value), false, String(value));
});

test('database validation preserves complete multi-location data and canonicalizes separators', () => {
  const input = {J069: 'AM–OC–425; AM-OC-426\nAM-OC-425', J070: 'AM OC 600'};
  assert.deepEqual(validatedDatabase(input), {J069: 'AM-OC-425, AM-OC-426', J070: 'AM-OC-600'});
  assert.equal(input.J069, 'AM–OC–425; AM-OC-426\nAM-OC-425', 'validation does not mutate input');
});

test('database validation rejects empty, non-object and malformed stored databases', () => {
  for (const value of [null, [], {}, 'text', 3, {J069: 425}, {J069: ''}, {J069: 'CH-OC-425'},
    {J069: 'AM-OC-425 extra'}, {J069: 'AM-OC-425, FR-OC-123'}, {J069: 'AM-OC-12345'},
    {J069: 'AM-OC-425', J070: ''}]) assert.throws(() => validatedDatabase(value));
});

test('stored keys must already be canonical, unlike flexible search queries', () => {
  for (const key of ['69', 'J69', 'j069', 'J0069', 'J0', 'J000', 'J069 extra', '__proto__']) {
    assert.throws(() => validatedDatabase(Object.fromEntries([[key, 'AM-OC-425']])));
  }
  assert.deepEqual(validatedDatabase({J001: 'AM-OC-425', J1000: 'AM-OC-600'}), {J001: 'AM-OC-425', J1000: 'AM-OC-600'});
});

test('a database with excessive entry count is rejected before parsing all rows', () => {
  const value = Object.fromEntries(Array.from({length: 20001}, (_, i) => [`J${i}`, 'AM-OC-425']));
  assert.throws(() => validatedDatabase(value), /túl nagy/);
});
