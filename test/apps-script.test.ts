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
        sort({ column, ascending }: { column: number; ascending: boolean }) {
          const block = rows.slice(r - 1, r - 1 + nr);
          const t = (x: unknown) => (x instanceof Date ? x.getTime() : x === '' ? null : new Date(String(x)).getTime());
          block.sort((a, b) => {
            const x = t(a[column - 1]);
            const y = t(b[column - 1]);
            if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1; // blanks last
            return ascending ? x - y : y - x;
          });
          rows.splice(r - 1, nr, ...block);
          return this;
        },
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

function load(driveApp: object = {}) {
  const ss = {
    getSheetByName: (n: string) => sheets[n] ?? null,
    insertSheet: (n: string) => makeSheet(n),
    deleteSheet: (sh: unknown) => { for (const [k, v] of Object.entries(sheets)) if (v === sh) delete sheets[k]; },
  };
  const globals = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, newDataValidation: () => ({ requireValueInList: () => ({ build() {} }) }) },
    PropertiesService: {}, LockService: {}, Logger: { log() {} }, ContentService: {}, DriveApp: driveApp, UrlFetchApp: {},
  };
  const src = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  return new Function(...Object.keys(globals), `${src}\nreturn { mergeMentions_, detachMentions_, append_, applyNewTopics_, guideNames_, assignGuides_, writeGuide_, write_, check_, readFailed_, cityNames_, setPlaceNotes_, thumbnailFolder_ };`)(...Object.values(globals));
}

let gs: {
  mergeMentions_: (rows: object[]) => number;
  detachMentions_: (url: string) => void;
  append_: (type: string, rows: object[]) => number;
  applyNewTopics_: () => { ideas: number; mentions: number };
  guideNames_: () => string[];
  assignGuides_: (a: object[]) => { assigned: number };
  writeGuide_: (body: object) => { written: number; videos: number };
  write_: (url: string, rows: object[]) => { written: number; duplicate?: boolean; merged_places?: object[] };
  setPlaceNotes_: (updates: object[]) => { updated: number };
  check_: (url: string) => { exists: boolean; title?: string };
  readFailed_: () => { rows: { source_url: string; error: string }[] };
  cityNames_: () => string[];
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

describe('newest first', () => {
  it('keeps a tab sorted by saved_at, newest at the top, whatever order rows arrive in', () => {
    gs.append_('idea', [{ title: 'b', saved_at: '2024-05-01T00:00:00Z' }]);
    gs.append_('idea', [{ title: 'c', saved_at: '2026-01-01T00:00:00Z' }, { title: 'a', saved_at: '2021-03-01T00:00:00Z' }]);
    const ideas = sheets.Ideas.rows;
    const title = (r: Row) => r[(ideas[0] as string[]).indexOf('title')];
    expect(ideas.slice(1).map(title)).toEqual(['c', 'b', 'a']);
  });
});

describe('applyNewTopics', () => {
  it('moves Other ideas whose suggested topic is now listed, and their mentions', () => {
    makeSheet('Topics').rows.push(['topic'], ['Career'], ['Fitness']);
    gs.append_('idea', [
      { title: 'Kettlebells', topic: 'Other', suggested_topic: 'fitness', source_url: 'u1', saved_at: '2026-01-02T00:00:00Z' },
      { title: 'Gardening', topic: 'Other', suggested_topic: 'Gardening', source_url: 'u2', saved_at: '2026-01-01T00:00:00Z' },
    ]);
    gs.mergeMentions_([m('Kettlebell', '', 'u1', { topic: 'Other' }), m('Trowel', '', 'u2', { topic: 'Other' })]);
    expect(gs.applyNewTopics_()).toEqual({ ideas: 1, mentions: 1 });
    const ideas = sheets.Ideas.rows;
    const col = (r: Row, c: string) => r[(ideas[0] as string[]).indexOf(c)];
    expect(ideas.slice(1).map((r) => [col(r, 'title'), col(r, 'topic'), col(r, 'suggested_topic')]))
      .toEqual([['Kettlebells', 'Fitness', ''], ['Gardening', 'Other', 'Gardening']]);
    expect(field(byName('Kettlebell'), 'topic')).toBe('Fitness');
    expect(field(byName('Trowel'), 'topic')).toBe('Other');
  });
});

describe('guides', () => {
  const col = (tab: string, r: Row, c: string) => r[(sheets[tab].rows[0] as string[]).indexOf(c)];
  const guideRows = () => sheets.Guides.rows.slice(1).map((r) => ({
    guide: col('Guides', r, 'guide'), videos: col('Guides', r, 'videos'), topic: col('Guides', r, 'topic'),
    from: col('Guides', r, 'from'), takeaways: col('Guides', r, 'takeaways'), done: col('Guides', r, 'done'), notes: col('Guides', r, 'notes'),
  }));

  beforeEach(() => {
    gs.append_('idea', [
      { title: 'Kyoto tips', topic: 'Travel tips', guide: 'Japan', source_url: 'u1', saved_at: '2026-01-03T00:00:00Z' },
      { title: 'Japan shopping', topic: 'Travel tips', guide: 'japan', source_url: 'u2', saved_at: '2026-01-02T00:00:00Z' },
      { title: 'Drugstore', topic: 'Health & Wellness', source_url: 'u3', saved_at: '2026-01-01T00:00:00Z' },
      { title: 'CapCut', topic: 'Video editing', guide: 'Video editing', source_url: 'u4', saved_at: '2025-12-01T00:00:00Z' },
    ]);
  });

  it('lists guide names, most videos first, in their first spelling', () => {
    expect(gs.guideNames_()).toEqual(['Japan', 'Video editing']);
  });

  it('sets the guide on ideas by link', () => {
    expect(gs.assignGuides_([{ source_url: 'u3', guide: 'Japan' }, { source_url: 'u1', guide: 'Japan' }, { source_url: 'nope', guide: 'X' }]))
      .toEqual({ ok: true, assigned: 1 });
    expect(sheets.Ideas.rows.slice(1).map((r) => col('Ideas', r, 'guide'))).toEqual(['Japan', 'japan', 'Japan', 'Video editing']);
  });

  it('writes one row per guide from its videos, keeping your done and notes on rewrite', () => {
    gs.assignGuides_([{ source_url: 'u3', guide: 'Japan' }]);
    expect(gs.writeGuide_({ guide: 'Japan', summary: 's', takeaways: '• one' })).toEqual({ ok: true, written: 1, videos: 3 });
    expect(guideRows()).toEqual([{ guide: 'Japan', videos: 3, topic: 'Travel tips', from: 'Kyoto tips\nJapan shopping\nDrugstore', takeaways: '• one', done: false, notes: '' }]);

    const r = sheets.Guides.rows[1];
    r[(sheets.Guides.rows[0] as string[]).indexOf('done')] = true;
    r[(sheets.Guides.rows[0] as string[]).indexOf('notes')] = 'mine';
    gs.writeGuide_({ guide: 'JAPAN', summary: 's2', takeaways: '• two' });
    expect(guideRows()).toMatchObject([{ guide: 'Japan', takeaways: '• two', done: true, notes: 'mine' }]);
  });

  it('has no row for a guide with one video, and drops one that falls to one', () => {
    expect(gs.writeGuide_({ guide: 'Video editing', takeaways: '• x' })).toEqual({ ok: true, written: 0, videos: 1 });
    gs.writeGuide_({ guide: 'Japan', takeaways: '• x' });
    expect(guideRows()).toHaveLength(1);
    gs.assignGuides_([{ source_url: 'u2', guide: 'Shopping' }]);
    gs.writeGuide_({ guide: 'Japan', takeaways: '' });
    expect(guideRows()).toHaveLength(0);
  });
});

describe('places', () => {
  const places = () => sheets.Places.rows;
  const col = (c: string) => (places()[0] as string[]).indexOf(c);
  const titled = (t: string) => places().filter((r) => r[col('title')] === t);
  const p = (title: string, url: string, extra: object = {}) => ({
    type: 'place', saved_at: '2026-01-01T00:00:00Z', title, city: 'Tokyo', country: 'Japan', source_url: url, creator: `@${url}`, ...extra,
  });
  // Stand-ins for the Topics and Place types tabs, so check_ does not create them with notes.
  beforeEach(() => {
    makeSheet('Topics').rows.push(['topic'], ['AI']);
    makeSheet('Place types').rows.push(['place type'], ['cafe']);
  });

  it('adds a repeat save of the same place to its row', () => {
    gs.write_('u1', [p('Senso-ji', 'u1', { place_id: 'P1', what_to_order: 'omikuji' })]);
    gs.write_('u2', [p('Sensoji Temple', 'u2', { place_id: 'P1', what_to_order: 'go at night', address: '2-3 Asakusa' })]);
    expect(places()).toHaveLength(2);
    const r = titled('Senso-ji')[0];
    expect([r[col('source_url')], r[col('creator')], r[col('times_saved')], r[col('what_to_order')], r[col('address')]])
      .toEqual(['u1\nu2', '@u1\n@u2', 2, 'omikuji; go at night', '2-3 Asakusa']);
  });

  it('matches by name and city when a row has no place ID, but keeps different branches apart', () => {
    gs.write_('u1', [p('Uniqlo', 'u1', { place_id: 'A' }), p('Cafe Kitsune', 'u1')]);
    gs.write_('u2', [p('UNIQLO', 'u2', { place_id: 'B' }), p('cafe kitsune', 'u2', { place_id: 'C' })]);
    expect(titled('Uniqlo')).toHaveLength(1);
    expect(titled('UNIQLO')).toHaveLength(1);
    expect(titled('Cafe Kitsune')[0][col('times_saved')]).toBe(2);
    expect(titled('Cafe Kitsune')[0][col('place_id')]).toBe('C');
  });

  it('knows a post is saved when its link is one of several on a place row', () => {
    gs.write_('u1', [p('Senso-ji', 'u1', { place_id: 'P1' })]);
    gs.write_('u2', [p('Senso-ji', 'u2', { place_id: 'P1' })]);
    expect(gs.check_('u2')).toMatchObject({ exists: true, title: 'Senso-ji' });
    expect(gs.write_('u2', [p('Senso-ji', 'u2', { place_id: 'P1' })])).toMatchObject({ duplicate: true });
  });

  it('lists cities by number of places, in their most common spelling', () => {
    gs.write_('u1', [p('A', 'u1', { city: 'New York City' }), p('B', 'u1', { city: 'New York City' }), p('C', 'u1', { city: 'new york city!' })]);
    gs.write_('u2', [p('D', 'u2'), p('E', 'u2', { city: 'Not specified' })]);
    expect(gs.cityNames_()).toEqual(['New York City', 'Tokyo']);
  });

  it('reports places whose notes now join several saves, and rewrites them by first link and title', () => {
    expect(gs.write_('u1', [p('Senso-ji', 'u1', { place_id: 'P1', what_to_order: 'omikuji' })]).merged_places).toEqual([]);
    const second = gs.write_('u2', [p('Sensoji Temple', 'u2', { place_id: 'P1', what_to_order: 'fortune slips' })]);
    expect(second.merged_places).toEqual([{ source_url: 'u1', title: 'Senso-ji', what_to_order: 'omikuji; fortune slips' }]);
    expect(gs.setPlaceNotes_([{ source_url: 'u1', title: 'senso-ji', what_to_order: 'omikuji (fortune slips)' }])).toEqual({ ok: true, updated: 1 });
    expect(titled('Senso-ji')[0][col('what_to_order')]).toBe('omikuji (fortune slips)');
    expect(gs.setPlaceNotes_([{ source_url: 'u2', title: 'Senso-ji', what_to_order: 'x' }]).updated).toBe(0); // not its first link
  });

  it('reads the Failed tab', () => {
    gs.append_('failed', [{ saved_at: '2026-03-21T00:00:00Z', source_url: 'u9', error: 'Timed out after 240s' }]);
    expect(gs.readFailed_().rows).toEqual([{ saved_at: '2026-03-21T00:00:00.000Z', source_url: 'u9', error: 'Timed out after 240s', creator: '' }]);
  });
});

describe('thumbnails folder', () => {
  function drive(names: string[]) {
    const folders = names.map((name) => ({ name }));
    const created: string[] = [];
    const api = {
      folders,
      created,
      getFoldersByName: (n: string) => {
        const hit = folders.filter((f) => f.name === n);
        return { hasNext: () => hit.length > 0, next: () => hit.shift() };
      },
      createFolder: (n: string) => { created.push(n); return { name: n }; },
    };
    return api;
  }

  it('uses the Save Faves folder when there is one, and makes it when there is not', () => {
    const one = drive(['Save Faves thumbnails']);
    expect(load(one).thumbnailFolder_()).toBe(one.folders[0]);
    expect(one.created).toEqual([]);
    const none = drive([]);
    load(none).thumbnailFolder_();
    expect(none.created).toEqual(['Save Faves thumbnails']);
  });
});
