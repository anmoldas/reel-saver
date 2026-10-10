import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';

// Runs apps-script/Code.gs against a small in-memory stand-in for SpreadsheetApp.
type Row = unknown[];
let sheets: Record<string, { rows: Row[] }>;

function makeSheet(name: string) {
  const rows: Row[] = [];
  const sheet = {
    rows,
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0]?.length ?? 0,
    appendRow: (r: Row) => rows.push([...r]),
    setFrozenRows() {},
    deleteRow: (n: number) => rows.splice(n - 1, 1),
    getRange(r: number, c: number, nr = 1, nc = 1) {
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => rows[r - 1 + i]?.[c - 1 + j] ?? '')),
        setValues(v: Row[]) {
          // Like Sheets, a leading ' only marks the value as text.
          v.forEach((row, i) => {
            rows[r - 1 + i] ??= [];
            row.forEach((x, j) => (rows[r - 1 + i][c - 1 + j] = typeof x === 'string' && x.startsWith("'") ? x.slice(1) : x));
          });
          return this;
        },
        setValue(x: unknown) {
          rows[r - 1] ??= [];
          rows[r - 1][c - 1] = x;
          return this;
        },
        clearContent() {
          for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (rows[r - 1 + i]) rows[r - 1 + i][c - 1 + j] = '';
          while (rows.length && rows[rows.length - 1].every((x) => x === '')) rows.pop();
          return this;
        },
        clearDataValidations() { return this; },
        setFontWeight() { return this; },
        setDataValidation() { return this; },
        insertCheckboxes() { return this; },
      };
    },
  };
  Object.assign(sheet, {
    copyTo: () => {
      const copy = makeSheet(`${name} copy`);
      copy.rows.push(...rows.map((r) => [...r]));
      return Object.assign(copy, { setName: (n: string) => { sheets[n] = copy; delete sheets[`${name} copy`]; return copy; } });
    },
  });
  sheets[name] = sheet;
  return sheet;
}

function load() {
  const ss = {
    getSheetByName: (n: string) => sheets[n] ?? null,
    insertSheet: (n: string) => makeSheet(n),
    deleteSheet: (sh: unknown) => { for (const [k, v] of Object.entries(sheets)) if (v === sh) delete sheets[k]; },
  };
  const globals = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, newDataValidation: () => ({ requireValueInList: () => ({ build() {} }) }) },
    PropertiesService: {}, LockService: {}, Logger: { log() {} }, ContentService: {}, DriveApp: {}, UrlFetchApp: {},
  };
  const src = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  return new Function(...Object.keys(globals), `${src}\nreturn { mergeMentions_, detachMentions_, readMentions_, cleanMentions_ };`)(...Object.values(globals));
}

let gs: {
  mergeMentions_: (rows: object[]) => number;
  detachMentions_: (url: string) => void;
  readMentions_: () => { count: number; rows: { row: number; name: string }[] };
  cleanMentions_: (body: object) => any;
};
const mentions = () => sheets.Mentions.rows;
const field = (r: Row, c: string) => r[(mentions()[0] as string[]).indexOf(c)];
const byName = (name: string) => mentions().find((r) => field(r, 'name') === name)!;
const m = (name: string, brand: string, url: string, extra: object = {}) => ({
  type: 'mention', name, brand, source_url: url, from: `T ${url}`, creator: `@${url}`, why: `why ${url}`, ...extra,
});

beforeEach(() => {
  sheets = {};
  gs = load();
});

describe('Mentions grouping', () => {
  it('adds a repeat to the existing row, matching case and a missing brand', () => {
    gs.mergeMentions_([m('Claude', 'Anthropic', 'u1'), m('Uniqlo', '', 'u1')]);
    gs.mergeMentions_([m('claude', '', 'u2')]);
    expect(mentions()).toHaveLength(3); // header + 2
    const claude = byName('Claude');
    expect([field(claude, 'times_mentioned'), field(claude, 'source_url'), field(claude, 'from'), field(claude, 'why')])
      .toEqual([2, 'u1\nu2', 'T u1\nT u2', 'why u1']);
  });

  it('counts a save once', () => {
    gs.mergeMentions_([m('Claude', 'Anthropic', 'u1')]);
    gs.mergeMentions_([m('Claude', 'Anthropic', 'u1')]);
    expect(field(byName('Claude'), 'times_mentioned')).toBe(1);
  });

  it('matches a brand inside the name and ignores accents, within one batch too', () => {
    gs.mergeMentions_([m('Glaze Drops', 'Kérastase', 'u1'), m('Kerastase Glaze Drops', '', 'u2')]);
    expect(mentions()).toHaveLength(2);
  });

  it('does not merge a brand with one of its products', () => {
    gs.mergeMentions_([m('Lip Essence', 'Muji', 'u1'), m('Muji', '', 'u2')]);
    expect(mentions()).toHaveLength(3);
  });

  it('keeps the per-save lists in step when a creator is blank', () => {
    gs.mergeMentions_([m('Uniqlo', '', 'u1'), m('Uniqlo', '', 'u2', { creator: '' }), m('Uniqlo', '', 'u3')]);
    expect(field(byName('Uniqlo'), 'creator')).toBe('@u1\n\n@u3');
    gs.detachMentions_('u1');
    const u = byName('Uniqlo');
    expect([field(u, 'source_url'), field(u, 'creator'), field(u, 'from'), field(u, 'times_mentioned')])
      .toEqual(['u2\nu3', '\n@u3', 'T u2\nT u3', 2]);
  });

  it('deletes a row once its last save is removed', () => {
    gs.mergeMentions_([m('Uniqlo', '', 'u1')]);
    gs.detachMentions_('u1');
    expect(mentions()).toHaveLength(1);
  });
});

describe('Mentions cleanup', () => {
  // Rows written the old way: one row per save, so duplicates sit side by side.
  function oldStyle() {
    gs.mergeMentions_([m('Claude', 'Anthropic', 'u1')]);
    gs.mergeMentions_([m('Sensoji Temple', '', 'u2')]);
    gs.mergeMentions_([m('Blom Kranz', '', 'u3', { kind: 'person' })]);
    const rows = mentions();
    const header = rows[0] as string[];
    const dupe = [...rows[1]];
    dupe[header.indexOf('source_url')] = 'u4';
    dupe[header.indexOf('from')] = 'T u4';
    dupe[header.indexOf('status')] = 'bought';
    dupe[header.indexOf('notes')] = 'mine';
    rows.push(dupe);
  }

  it('reads every row with its number', () => {
    oldStyle();
    const read = gs.readMentions_();
    expect(read.count).toBe(4);
    expect(read.rows.map((r) => [r.row, r.name])).toEqual([[2, 'Claude'], [3, 'Sensoji Temple'], [4, 'Blom Kranz'], [5, 'Claude']]);
  });

  it('previews without changing anything', () => {
    oldStyle();
    const before = JSON.stringify(mentions());
    const r = gs.cleanMentions_({ count: 4, remove: [3], updates: [], dry_run: true });
    expect(r).toMatchObject({ before: 4, removed: 1, after: 2, merged: ['Claude (2 rows)'] });
    expect(JSON.stringify(mentions())).toBe(before);
    expect(sheets['Mentions (backup)']).toBeUndefined();
  });

  it('backs up, removes, fixes kinds and merges, keeping status and notes', () => {
    oldStyle();
    const r = gs.cleanMentions_({ count: 4, remove: [3], updates: [{ row: 4, kind: 'brand', shop_link: 'https://shop/blom' }] });
    expect(r).toMatchObject({ before: 4, removed: 1, after: 2 });
    expect(sheets['Mentions (backup)'].rows).toHaveLength(5);
    expect(mentions()).toHaveLength(3);
    const claude = byName('Claude');
    expect([field(claude, 'source_url'), field(claude, 'times_mentioned'), field(claude, 'status'), field(claude, 'notes')])
      .toEqual(['u1\nu4', 2, 'bought', 'mine']);
    expect([field(byName('Blom Kranz'), 'kind'), field(byName('Blom Kranz'), 'shop_link')]).toEqual(['brand', 'https://shop/blom']);
    expect(mentions().some((r) => field(r, 'name') === 'Sensoji Temple')).toBe(false);
  });

  it('refuses a plan made before the tab changed', () => {
    oldStyle();
    expect(gs.cleanMentions_({ count: 3, remove: [2] })).toMatchObject({ ok: false });
    expect(mentions()).toHaveLength(5);
  });
});
