import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.STB = {};
await import('../js/lib/party-picker.js');
const P = globalThis.STB.partyPicker;

const parties = [
  { id: '1', name: 'Alpha Fabrics' },
  { id: '2', name: 'ALPHA MILLS' },
  { id: '3', name: 'Beta Textiles' },
  { id: '4', name: '  Padded Party  ' }
];

test('filtering is a case-insensitive substring match', () => {
  assert.deepEqual(P.filterParties(parties, 'al').map((p) => p.name),
    ['Alpha Fabrics', 'ALPHA MILLS']);
  assert.deepEqual(P.filterParties(parties, 'TEXT').map((p) => p.name), ['Beta Textiles']);
});

test('an empty query offers nothing', () => {
  // The party list is long; showing all of it on focus is noise, not help.
  assert.deepEqual(P.filterParties(parties, ''), []);
  assert.deepEqual(P.filterParties(parties, '   '), []);
});

test('suggestions are capped at six', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ id: String(i), name: 'Party ' + i }));
  assert.equal(P.filterParties(many, 'party').length, 6);
});

test('an exact match ignores case and surrounding space', () => {
  assert.equal(P.exactParty(parties, 'alpha fabrics').id, '1');
  assert.equal(P.exactParty(parties, '  ALPHA FABRICS  ').id, '1');
  // Matches the server's own duplicate rule, which trims before comparing.
  assert.equal(P.exactParty(parties, 'padded party').id, '4');
});

test('a partial name is not an exact match', () => {
  // "+ Create" hinges on this: if 'alpha' counted as exact, a real new party
  // called Alpha could never be created.
  assert.equal(P.exactParty(parties, 'alpha'), null);
  assert.equal(P.exactParty(parties, ''), null);
});
