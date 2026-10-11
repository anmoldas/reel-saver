/**
 * Save Faves: Sheet write endpoint.
 *
 * Setup: Extensions > Apps Script in your Sheet, paste this file, then
 * Project Settings > Script properties > add SECRET (same value as the Vercel SECRET).
 * Deploy > New deployment > Web app, execute as Me, access Anyone.
 *
 * Rows land in one tab per type: Places, Recipes, Ideas, and Failed for errors.
 * Idea topics come from the Topics tab: add a row there to add a topic.
 * Ideas on the same subject share a guide name; the Guides tab has one combined row per guide.
 */

const TABS = {
  place: {
    name: 'Places',
    columns: ['saved_at', 'done', 'title', 'category', 'specialty', 'city', 'country', 'address', 'what_to_order', 'summary',
      'maps_url', 'lat', 'lng', 'place_id', 'times_saved', 'creator', 'source_url', 'thumbnail_url', 'notes'],
  },
  recipe: {
    name: 'Recipes',
    columns: ['saved_at', 'done', 'title', 'summary', 'time', 'servings', 'ingredients', 'steps',
      'creator', 'source_url', 'thumbnail_url', 'notes'],
  },
  idea: {
    name: 'Ideas',
    columns: ['saved_at', 'done', 'topic', 'guide', 'title', 'summary', 'takeaways', 'mentioned', 'suggested_topic',
      'creator', 'source_url', 'thumbnail_url', 'notes'],
  },
  guide: {
    name: 'Guides',
    columns: ['saved_at', 'done', 'guide', 'topic', 'videos', 'summary', 'takeaways', 'from', 'creator', 'source_url', 'notes'],
  },
  mention: {
    name: 'Mentions',
    columns: ['saved_at', 'status', 'name', 'kind', 'brand', 'why', 'price', 'topic', 'times_mentioned', 'shop_link',
      'from', 'creator', 'source_url', 'notes'],
  },
  failed: {
    name: 'Failed',
    columns: ['saved_at', 'source_url', 'error', 'creator'],
  },
};
const CONTENT_TYPES = ['place', 'recipe', 'idea'];
const MENTION_STATUSES = ['want', 'bought', 'tried', 'skip'];

const TOPICS_TAB = 'Topics';
const DEFAULT_TOPICS = ['Travel tips', 'Clothing', 'Career', 'AI', 'Video editing', 'Journaling', 'Organization'];

const PLACE_TYPES_TAB = 'Place types';
const DEFAULT_PLACE_TYPES = ['restaurant', 'cafe', 'bar', 'bakery & dessert', 'home & ceramics', 'clothing', 'beauty',
  'books & stationery', 'market', 'museum & gallery', 'sight', 'activity', 'stay'];

// Instagram/TikTok image links expire within days, so thumbnails are copied to Drive.
const THUMBNAIL_FOLDER = 'Save Faves thumbnails';
// The folder's name from before the rename; found and renamed the first time a thumbnail is saved.
const OLD_THUMBNAIL_FOLDER = 'Reel Saver thumbnails';

// Bump when this file changes, so a check of the web app shows which code is deployed.
const SCRIPT_VERSION = 7;

function doGet() {
  return json_({ ok: true, service: 'save-faves sheet', version: SCRIPT_VERSION });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Body is not JSON' });
  }
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret || body.secret !== secret) return json_({ ok: false, error: 'Wrong secret' });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (body.action === 'check') return json_(check_(body.source_url));
    if (body.action === 'write') return json_(write_(body.source_url, body.rows || []));
    if (body.action === 'mentions') return json_(readMentions_());
    if (body.action === 'cleanMentions') return json_(cleanMentions_(body));
    if (body.action === 'ideas') return json_(readIdeas_());
    if (body.action === 'assignGuides') return json_(assignGuides_(body.assignments || []));
    if (body.action === 'guideVideos') return json_({ ok: true, videos: guideVideos_(body.guide) });
    if (body.action === 'writeGuide') return json_(writeGuide_(body));
    if (body.action === 'failed') return json_(readFailed_());
    if (body.action === 'tidy') return json_(tidy_(body));
    if (body.action === 'placeNotes') return json_(readPlaceNotes_());
    if (body.action === 'setPlaceNotes') return json_(setPlaceNotes_(body.updates || []));
    return json_({ ok: false, error: 'Unknown action: ' + body.action });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

/** Is this URL already saved in Places, Recipes or Ideas? Also returns the topic, place type, guide and city lists. */
function check_(sourceUrl) {
  const found = savedRows_(sourceUrl);
  const result = {
    ok: true, exists: found.length > 0, topics: readTopics_(), place_types: readPlaceTypes_(), guides: guideNames_(),
    cities: cityNames_(),
  };
  if (found.length) {
    result.title = found[0].title;
    result.type = found[0].type;
    result.count = found.length;
  }
  return result;
}

/** Append rows to their tabs; earlier failed rows for the same URL are removed. */
function write_(sourceUrl, rows) {
  if (savedRows_(sourceUrl).length) return { ok: true, written: 0, duplicate: true };

  // Earlier failed rows, and mentions left over from a save that was deleted, are replaced.
  deleteRowsFor_(sheetFor_('failed'), sourceUrl);
  detachMentions_(sourceUrl);

  // Thumbnails are copied only for rows that become new rows (a repeat place joins an existing row).
  const thumbCache = {};
  const withThumbnail = function (row) {
    if (row.thumbnail_url) {
      thumbCache[row.thumbnail_url] = thumbCache[row.thumbnail_url] || saveThumbnail_(row.thumbnail_url);
      row.thumbnail_url = thumbCache[row.thumbnail_url];
    }
    return row;
  };
  const byType = {};
  rows.forEach(function (row) {
    const type = TABS[row.type] ? row.type : 'idea';
    (byType[type] = byType[type] || []).push(row);
  });
  let written = 0;
  const mergedPlaces = [];
  Object.keys(byType).forEach(function (type) {
    if (type === 'mention') written += mergeMentions_(byType[type]);
    else if (type === 'place') written += mergePlaces_(byType[type], withThumbnail, mergedPlaces);
    else written += append_(type, CONTENT_TYPES.indexOf(type) !== -1 ? byType[type].map(withThumbnail) : byType[type]);
  });
  // Places whose what_to_order now joins several saves' notes; the app rewrites those into one line.
  return { ok: true, written: written, merged_places: mergedPlaces };
}

// ---- Places: one row per place, listing every save that recommends it ----
// source_url and creator hold one line per save, in the same order; times_saved counts them.

const PLACE_LISTS = ['source_url', 'creator'];
// Filled from a later save when the row has them blank.
const PLACE_FILL = ['category', 'specialty', 'city', 'country', 'address', 'summary', 'maps_url', 'lat', 'lng', 'place_id'];

function placeKey_(row) {
  return { id: String(row.place_id || '').trim(), name: norm_(row.title), city: norm_(row.city) };
}

/** Same place: the same Google place, or the same name in the same city when one side has no place ID. */
function samePlace_(a, b) {
  if (a.id && b.id) return a.id === b.id;
  return a.name !== '' && a.name === b.name && a.city === b.city;
}

/** "coffee" + "matcha latte" → "coffee; matcha latte". A part already there is not repeated. */
function combineText_(a, b) {
  const parts = String(a || '').split(';').map(function (x) { return x.trim(); }).filter(String);
  const have = parts.map(norm_);
  String(b || '').split(';').map(function (x) { return x.trim(); }).filter(String).forEach(function (x) {
    if (have.indexOf(norm_(x)) === -1) { parts.push(x); have.push(norm_(x)); }
  });
  return parts.join('; ');
}

/** Adds a later save of the same place to `target`: its link and creator, what to order, and any blanks. */
function addPlaceSave_(target, row) {
  const urls = lines_(target.source_url);
  lines_(row.source_url).forEach(function (url, i) {
    if (urls.indexOf(url) !== -1) return;
    const creators = listOf_(target.creator, urls.length);
    creators.push(listOf_(row.creator, lines_(row.source_url).length)[i] || '');
    urls.push(url);
    target.source_url = urls.join('\n');
    target.creator = creators.join('\n');
  });
  target.times_saved = urls.length;
  target.what_to_order = combineText_(target.what_to_order, row.what_to_order);
  PLACE_FILL.forEach(function (c) { if ((target[c] === '' || target[c] === undefined || target[c] === null) && row[c]) target[c] = row[c]; });
}

/** The row's first link and title, which setPlaceNotes_ finds it by, with its notes. */
function placeNote_(row) {
  return { source_url: lines_(row.source_url)[0] || '', title: String(row.title || ''), what_to_order: String(row.what_to_order || '') };
}

/**
 * Adds each place to the row for the same place, or appends a new row. Returns rows touched.
 * Rows whose what_to_order now has several saves' notes are added to `mergedNotes`.
 */
function mergePlaces_(rows, prepareNew, mergedNotes) {
  const sheet = sheetFor_('place');
  const header = header_(sheet, TABS.place.columns);
  const last = sheet.getLastRow();
  const data = last < 2 ? [] : sheet.getRange(2, 1, last - 1, header.length).getValues();
  const keys = data.map(function (r) { return placeKey_(rowObject_(header, r)); });
  const changed = {};
  const fresh = [];

  rows.forEach(function (row) {
    const key = placeKey_(row);
    let i = -1;
    for (let k = 0; k < keys.length && i === -1; k++) if (samePlace_(keys[k], key)) i = k;
    for (let k = 0; k < fresh.length && i === -1; k++) if (samePlace_(placeKey_(fresh[k]), key)) i = data.length + k;
    if (i === -1) {
      fresh.push(Object.assign(prepareNew ? prepareNew(row) : row, { times_saved: 1 }));
      return;
    }
    const target = i < data.length ? rowObject_(header, data[i]) : fresh[i - data.length];
    addPlaceSave_(target, row);
    if (mergedNotes && String(target.what_to_order || '').indexOf(';') !== -1) {
      const note = placeNote_(target);
      const at = mergedNotes.map(function (n) { return n.source_url + '\n' + n.title; }).indexOf(note.source_url + '\n' + note.title);
      if (at === -1) mergedNotes.push(note);
      else mergedNotes[at] = note;
    }
    if (i < data.length) {
      data[i] = header.map(function (c) { return target[c]; });
      keys[i] = placeKey_(target);
      changed[i] = true;
    }
  });

  Object.keys(changed).forEach(function (i) {
    sheet.getRange(Number(i) + 2, 1, 1, header.length).setValues([data[i].map(function (v, c) { return cell_(header[c], v); })]);
  });
  return Object.keys(changed).length + append_('place', fresh);
}

/** The cities in the Places tab, most places first, each spelled the way most rows spell it. */
function cityNames_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.place.name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const header = header_(sheet, TABS.place.columns);
  const col = header.indexOf('city');
  const counts = {};
  const spellings = {};
  sheet.getRange(2, col + 1, sheet.getLastRow() - 1, 1).getValues().forEach(function (r) {
    const name = String(r[0] || '').trim();
    const key = norm_(name);
    if (!key || PLACEHOLDER_.test(name)) return;
    counts[key] = (counts[key] || 0) + 1;
    spellings[key] = spellings[key] || {};
    spellings[key][name] = (spellings[key][name] || 0) + 1;
  });
  return Object.keys(counts)
    .sort(function (a, b) { return counts[b] - counts[a]; })
    .map(function (key) {
      return Object.keys(spellings[key]).sort(function (a, b) { return spellings[key][b] - spellings[key][a]; })[0];
    });
}

// ---- One-time tidy (scripts/tidy-sheet.mjs drives it) ----

const PLACES_BACKUP = 'Places (backup)';
// What the model wrote instead of leaving a field empty, before the parser cleared these itself.
const PLACEHOLDER_ = /^(not (specified|mentioned|stated|provided|given|available)|unknown|various|n\/?a|none|tbd|-+|—)\.?$/i;
const PLACEHOLDER_COLUMNS = {
  place: ['category', 'specialty', 'city', 'country', 'address', 'what_to_order'],
  recipe: ['time', 'servings'],
};
const COUNTRY_NAMES = {
  'united states': 'USA', 'united states of america': 'USA', 'us': 'USA', 'u.s.': 'USA', 'u.s.a.': 'USA',
  'united kingdom': 'UK', 'great britain': 'UK', 'u.k.': 'UK',
};

/** Blanks placeholder cells in the given columns of row objects. Returns how many. */
function clearPlaceholders_(rows, columns) {
  let n = 0;
  rows.forEach(function (r) {
    columns.forEach(function (c) {
      if (typeof r[c] === 'string' && PLACEHOLDER_.test(r[c].trim())) { r[c] = ''; n++; }
    });
  });
  return n;
}

/**
 * Merges places saved more than once into one row each, blanks "Not specified"-style cells in Places and
 * Recipes, and writes "United States" and the like the way the rest of the sheet does ("USA").
 * { count, dry_run }: count is the Places row count from the preview; a different count means the tab
 * changed since, and nothing is done. Backs Places up to "Places (backup)" first.
 */
function tidy_(body) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TABS.place.name);
  const header = sheet ? header_(sheet, TABS.place.columns) : [];
  const data = sheet && sheet.getLastRow() >= 2 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).getValues() : [];
  if (!body.dry_run && Number(body.count) !== data.length) {
    return { ok: false, error: 'The Places tab changed since the preview (' + data.length + ' rows, expected ' + body.count + '). Run the preview again.' };
  }
  const rows = data.map(function (v) { return rowObject_(header, v); });
  let placeholders = clearPlaceholders_(rows, PLACEHOLDER_COLUMNS.place);
  let countries = 0;
  rows.forEach(function (r) {
    const name = COUNTRY_NAMES[String(r.country || '').trim().toLowerCase()];
    if (name) { r.country = name; countries++; }
  });

  // Oldest first, so each merged row keeps its first save's date, wording and thumbnail.
  const groups = [];
  rows.slice().sort(function (a, b) { return new Date(a.saved_at) - new Date(b.saved_at); }).forEach(function (r) {
    let g = null;
    for (let k = 0; k < groups.length && !g; k++) if (samePlace_(placeKey_(groups[k].row), placeKey_(r))) g = groups[k];
    if (!g) {
      const row = Object.assign({}, r);
      row.times_saved = lines_(row.source_url).length || 1;
      groups.push({ row: row, merged: 1, notes: r.notes ? [String(r.notes)] : [] });
      return;
    }
    g.merged++;
    addPlaceSave_(g.row, r);
    if (r.done === true) g.row.done = true;
    if (r.notes && g.notes.indexOf(String(r.notes)) === -1) g.notes.push(String(r.notes));
  });
  const merged = groups.filter(function (g) { return g.merged > 1; }).map(function (g) {
    return g.row.title + (g.row.city ? ' (' + g.row.city + ')' : '') + ': ' + g.merged + ' rows';
  });

  const recipes = ss.getSheetByName(TABS.recipe.name);
  const recipeHeader = recipes ? header_(recipes, TABS.recipe.columns) : [];
  const recipeData = recipes && recipes.getLastRow() >= 2 ? recipes.getRange(2, 1, recipes.getLastRow() - 1, recipeHeader.length).getValues() : [];
  const recipeRows = recipeData.map(function (v) { return rowObject_(recipeHeader, v); });
  const recipePlaceholders = clearPlaceholders_(recipeRows, PLACEHOLDER_COLUMNS.recipe);
  placeholders += recipePlaceholders;

  const result = {
    ok: true, count: data.length, before: data.length, after: groups.length, merged: merged,
    placeholders: placeholders, countries: countries,
  };
  if (body.dry_run) return result;

  if (data.length) {
    const old = ss.getSheetByName(PLACES_BACKUP);
    if (old) ss.deleteSheet(old);
    sheet.copyTo(ss).setName(PLACES_BACKUP);
    const out = groups.map(function (g) {
      g.row.notes = g.notes.join('\n');
      return header.map(function (c) { return cell_(c, g.row[c]); });
    });
    sheet.getRange(2, 1, data.length, header.length).clearContent().clearDataValidations();
    sheet.getRange(2, 1, out.length, header.length).setValues(out);
    const doneCol = header.indexOf('done');
    if (doneCol !== -1) sheet.getRange(2, doneCol + 1, out.length, 1).insertCheckboxes();
    sortNewestFirst_(sheet);
  }
  if (recipePlaceholders) {
    recipes.getRange(2, 1, recipeRows.length, recipeHeader.length)
      .setValues(recipeRows.map(function (r) { return recipeHeader.map(function (c) { return cell_(c, r[c]); }); }));
  }
  return result;
}

/** Places whose what_to_order joins several notes ("a; b"), for rewriting into one line. */
function readPlaceNotes_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.place.name);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, places: [] };
  const header = header_(sheet, TABS.place.columns);
  return {
    ok: true,
    places: sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).getValues()
      .map(function (v) { return placeNote_(rowObject_(header, v)); })
      .filter(function (n) { return n.what_to_order.indexOf(';') !== -1; }),
  };
}

/** Sets what_to_order on the rows with this first link and title: [{ source_url, title, what_to_order }]. */
function setPlaceNotes_(updates) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.place.name);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, updated: 0 };
  const header = header_(sheet, TABS.place.columns);
  const col = header.indexOf('what_to_order');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).getValues();
  let updated = 0;
  data.forEach(function (v, i) {
    const note = placeNote_(rowObject_(header, v));
    updates.forEach(function (u) {
      if (!u || !u.what_to_order || u.source_url !== note.source_url || norm_(u.title) !== norm_(note.title)) return;
      sheet.getRange(i + 2, col + 1).setValue(cell_('what_to_order', String(u.what_to_order)));
      updated++;
    });
  });
  return { ok: true, updated: updated };
}

/** Every Failed row, for scripts/retry-failed.mjs. */
function readFailed_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.failed.name);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, rows: [] };
  const header = header_(sheet, TABS.failed.columns);
  return {
    ok: true,
    rows: sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).getValues().map(function (v) {
      const r = rowObject_(header, v);
      return {
        saved_at: r.saved_at instanceof Date ? r.saved_at.toISOString() : String(r.saved_at || ''),
        source_url: String(r.source_url || ''), error: String(r.error || ''), creator: String(r.creator || ''),
      };
    }),
  };
}

function append_(type, rows) {
  if (!rows.length) return 0;
  const sheet = sheetFor_(type);
  const header = header_(sheet, TABS[type].columns);
  const values = rows.map(function (row) {
    return header.map(function (col) { return cell_(col, row[col]); });
  });
  const start = sheet.getLastRow() + 1;
  sheet.getRange(start, 1, values.length, header.length).setValues(values);
  const doneCol = header.indexOf('done');
  if (doneCol !== -1) sheet.getRange(start, doneCol + 1, values.length, 1).insertCheckboxes();
  const statusCol = header.indexOf('status');
  if (statusCol !== -1) {
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(MENTION_STATUSES, true).build();
    sheet.getRange(start, statusCol + 1, values.length, 1).setDataValidation(rule);
  }
  sortNewestFirst_(sheet);
  return values.length;
}

// ---- Mentions: one row per thing, listing every save that recommends it ----
// source_url, from and creator hold one line per save, in the same order; times_mentioned counts them.

const MENTION_LISTS = ['source_url', 'from', 'creator'];

function lines_(value) {
  return String(value || '').split('\n').map(function (s) { return s.trim(); }).filter(String);
}

/** A per-save list, padded or cut to n lines so it stays in step with source_url (a creator can be blank). */
function listOf_(value, n) {
  const list = value === '' || value === null || value === undefined ? [] : String(value).split('\n');
  while (list.length < n) list.push('');
  return list.slice(0, n);
}

/** Lower case, no accents, punctuation or leading "the", so "The Pitt" and "the pitt!" match. */
function norm_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '');
}

function mentionKeys_(name, brand) {
  const bare = norm_(name);
  const b = norm_(brand);
  return { bare: bare, brand: b, full: b && (' ' + bare + ' ').indexOf(' ' + b + ' ') === -1 ? b + ' ' + bare : bare };
}

/** Same thing: same name with its brand, or the same name where at most one side names a brand. */
function sameMention_(a, b) {
  return a.full === b.full || (a.bare === b.bare && (!a.brand || !b.brand || a.brand === b.brand));
}

/** Adds each mention to the row for the same thing, or appends a new row. Returns rows touched. */
function mergeMentions_(rows) {
  const sheet = sheetFor_('mention');
  const header = header_(sheet, TABS.mention.columns);
  const col = function (name) { return header.indexOf(name); };
  const last = sheet.getLastRow();
  const data = last < 2 ? [] : sheet.getRange(2, 1, last - 1, header.length).getValues();
  const keys = data.map(function (r) { return mentionKeys_(r[col('name')], r[col('brand')]); });
  const changed = {};
  const fresh = [];

  rows.forEach(function (row) {
    const key = mentionKeys_(row.name, row.brand);
    let i = -1;
    for (let k = 0; k < keys.length && i === -1; k++) if (sameMention_(keys[k], key)) i = k;
    if (i === -1) {
      for (let k = 0; k < fresh.length && i === -1; k++) {
        if (sameMention_(mentionKeys_(fresh[k].name, fresh[k].brand), key)) i = data.length + k;
      }
    }
    if (i === -1) {
      fresh.push(Object.assign({}, row, { times_mentioned: 1 }));
      return;
    }
    const target = i < data.length ? rowObject_(header, data[i]) : fresh[i - data.length];
    const urls = lines_(target.source_url);
    if (urls.indexOf(row.source_url) !== -1) return; // this save already counted
    MENTION_LISTS.forEach(function (c) { target[c] = listOf_(target[c], urls.length).concat([row[c] || '']).join('\n'); });
    target.times_mentioned = urls.length + 1;
    // The first save's wording stays; blanks get filled from later ones.
    ['kind', 'brand', 'why', 'price', 'topic', 'shop_link'].forEach(function (c) { if (!target[c] && row[c]) target[c] = row[c]; });
    if (i < data.length) {
      data[i] = header.map(function (c) { return target[c]; });
      changed[i] = true;
    }
  });

  Object.keys(changed).forEach(function (i) {
    sheet.getRange(Number(i) + 2, 1, 1, header.length).setValues([data[i].map(function (v, c) { return cell_(header[c], v); })]);
  });
  return Object.keys(changed).length + append_('mention', fresh);
}

/** Removes one save from the Mentions tab: its line goes, and a row with no saves left is deleted. */
function detachMentions_(sourceUrl) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.mention.name);
  if (!sheet || sheet.getLastRow() < 2 || !sourceUrl) return;
  const header = header_(sheet, TABS.mention.columns);
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    const row = rowObject_(header, data[i]);
    const urls = lines_(row.source_url);
    const at = urls.indexOf(sourceUrl);
    if (at === -1) continue;
    if (urls.length === 1) {
      sheet.deleteRow(i + 2);
      continue;
    }
    MENTION_LISTS.forEach(function (c) {
      const list = c === 'source_url' ? urls.slice() : listOf_(row[c], urls.length);
      list.splice(at, 1);
      row[c] = list.join('\n');
    });
    row.times_mentioned = urls.length - 1;
    sheet.getRange(i + 2, 1, 1, header.length).setValues([header.map(function (c) { return cell_(c, row[c]); })]);
  }
}

// ---- One-time Mentions cleanup (scripts/clean-mentions.mjs drives it) ----

const MENTIONS_BACKUP = 'Mentions (backup)';

/** Every Mentions row with its row number, for review. */
function readMentions_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.mention.name);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, count: 0, rows: [] };
  const header = header_(sheet, TABS.mention.columns);
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).getValues();
  return {
    ok: true,
    count: data.length,
    rows: data.map(function (values, i) {
      const r = rowObject_(header, values);
      return { row: i + 2, name: r.name, kind: r.kind, brand: r.brand, why: r.why, topic: r.topic, from: r.from };
    }),
  };
}

/**
 * Applies a reviewed plan: { count, remove: [row numbers], updates: [{ row, kind, shop_link }], dry_run }.
 * Backs the tab up first, then drops and fixes rows and merges duplicates into one row each.
 * Refuses if the tab has a different number of rows than when it was read.
 */
function cleanMentions_(body) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TABS.mention.name);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, before: 0, removed: 0, after: 0, merged: [] };
  const header = header_(sheet, TABS.mention.columns);
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).getValues();
  if (Number(body.count) !== data.length) {
    return { ok: false, error: 'The Mentions tab changed since it was reviewed (' + data.length + ' rows, expected ' + body.count + '). Run the preview again.' };
  }
  const remove = {};
  (body.remove || []).forEach(function (n) { remove[Number(n)] = true; });
  (body.updates || []).forEach(function (u) {
    const i = Number(u.row) - 2;
    if (!data[i]) return;
    if (u.kind) data[i][header.indexOf('kind')] = u.kind;
    if (u.shop_link) data[i][header.indexOf('shop_link')] = u.shop_link;
  });
  const kept = data.filter(function (_, i) { return !remove[i + 2]; }).map(function (v) { return rowObject_(header, v); });
  const grouped = groupMentions_(kept);
  const result = {
    ok: true,
    before: data.length,
    removed: data.length - kept.length,
    after: grouped.length,
    merged: grouped.filter(function (r) { return r._merged > 1; }).map(function (r) { return r.name + ' (' + r._merged + ' rows)'; }),
  };
  if (body.dry_run) return result;

  const old = ss.getSheetByName(MENTIONS_BACKUP);
  if (old) ss.deleteSheet(old);
  sheet.copyTo(ss).setName(MENTIONS_BACKUP);

  sheet.getRange(2, 1, data.length, header.length).clearContent().clearDataValidations();
  if (grouped.length) {
    sheet.getRange(2, 1, grouped.length, header.length)
      .setValues(grouped.map(function (r) { return header.map(function (c) { return cell_(c, r[c]); }); }));
    const statusCol = header.indexOf('status');
    if (statusCol !== -1) {
      const rule = SpreadsheetApp.newDataValidation().requireValueInList(MENTION_STATUSES, true).build();
      sheet.getRange(2, statusCol + 1, grouped.length, 1).setDataValidation(rule);
    }
    sortNewestFirst_(sheet);
  }
  return result;
}

/**
 * Folds rows that name the same thing into one: every save listed once, the earliest date, the first
 * wording, a status you changed from "want" kept, and all your notes kept.
 */
function groupMentions_(rows) {
  const groups = [];
  rows.forEach(function (r) {
    const key = mentionKeys_(r.name, r.brand);
    const urls = lines_(r.source_url);
    const lists = {};
    MENTION_LISTS.forEach(function (c) { lists[c] = c === 'source_url' ? urls : listOf_(r[c], urls.length); });
    let g = null;
    for (let k = 0; k < groups.length && !g; k++) if (sameMention_(groups[k].key, key)) g = groups[k];
    if (!g) {
      groups.push({ key: key, row: Object.assign({}, r, { _merged: 1 }), lists: lists, notes: r.notes ? [String(r.notes)] : [] });
      return;
    }
    const t = g.row;
    t._merged++;
    lists.source_url.forEach(function (u, i) {
      if (g.lists.source_url.indexOf(u) !== -1) return;
      MENTION_LISTS.forEach(function (c) { g.lists[c].push(lists[c][i]); });
    });
    ['kind', 'brand', 'why', 'price', 'topic', 'shop_link'].forEach(function (c) { if (!t[c] && r[c]) t[c] = r[c]; });
    if ((!t.status || t.status === 'want') && r.status && r.status !== 'want') t.status = r.status;
    if (r.saved_at && (!t.saved_at || new Date(r.saved_at) < new Date(t.saved_at))) t.saved_at = r.saved_at;
    if (r.notes && g.notes.indexOf(String(r.notes)) === -1) g.notes.push(String(r.notes));
  });
  return groups.map(function (g) {
    const r = g.row;
    MENTION_LISTS.forEach(function (c) { r[c] = g.lists[c].join('\n'); });
    r.times_mentioned = g.lists.source_url.length || 1;
    r.notes = g.notes.join('\n');
    return r;
  });
}

/** Run from the editor to merge duplicate Mentions rows without the review. Backs the tab up first. */
function mergeDuplicateMentions() {
  const read = readMentions_();
  const result = cleanMentions_({ count: read.count });
  Logger.log(JSON.stringify(result));
}

// ---- Guides: ideas on the same subject, combined into one row ----
// Each idea's guide name is set when it is saved (or by scripts/build-guides.mjs for older ones).
// The combined takeaways are written by the app; the lists of videos come from the Ideas tab.

/** Every Ideas row as objects, with its header. */
function ideaRows_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.idea.name);
  if (!sheet || sheet.getLastRow() < 2) return { sheet: sheet, header: [], rows: [] };
  const header = header_(sheet, TABS.idea.columns);
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).getValues();
  return { sheet: sheet, header: header, data: data, rows: data.map(function (v) { return rowObject_(header, v); }) };
}

/** The guide names in use, most videos first, each spelled the way it was first written. */
function guideNames_() {
  const counts = {};
  const names = [];
  ideaRows_().rows.forEach(function (r) {
    const name = String(r.guide || '').trim();
    const key = norm_(name);
    if (!key) return;
    if (!counts[key]) names.push({ key: key, name: name });
    counts[key] = (counts[key] || 0) + 1;
  });
  return names.sort(function (a, b) { return counts[b.key] - counts[a.key]; }).map(function (n) { return n.name; });
}

/** Every idea, for grouping the ones without a guide. */
function readIdeas_() {
  return {
    ok: true,
    rows: ideaRows_().rows.map(function (r) {
      return { source_url: r.source_url, title: r.title, summary: r.summary, topic: r.topic, guide: r.guide };
    }),
  };
}

/** Sets the guide column: [{ source_url, guide }]. Returns how many rows changed. */
function assignGuides_(assignments) {
  const byUrl = {};
  assignments.forEach(function (a) { if (a && a.source_url) byUrl[a.source_url] = String(a.guide || '').trim(); });
  const ideas = ideaRows_();
  if (!ideas.rows.length) return { ok: true, assigned: 0 };
  const urlCol = ideas.header.indexOf('source_url');
  const guideCol = ideas.header.indexOf('guide');
  let assigned = 0;
  ideas.data.forEach(function (r) {
    const guide = byUrl[r[urlCol]];
    if (guide === undefined || guide === r[guideCol]) return;
    r[guideCol] = guide;
    assigned++;
  });
  if (assigned) {
    ideas.sheet.getRange(2, 1, ideas.data.length, ideas.header.length)
      .setValues(ideas.data.map(function (r) { return r.map(function (v, c) { return cell_(ideas.header[c], v); }); }));
  }
  return { ok: true, assigned: assigned };
}

/** The ideas in one guide, newest first. */
function guideVideos_(guide) {
  const key = norm_(guide);
  if (!key) return [];
  return ideaRows_().rows
    .filter(function (r) { return norm_(r.guide) === key; })
    .map(function (r) {
      return {
        saved_at: r.saved_at instanceof Date ? r.saved_at.toISOString() : String(r.saved_at || ''),
        title: r.title, topic: r.topic, takeaways: r.takeaways, creator: r.creator, source_url: r.source_url,
      };
    })
    .sort(function (a, b) { return new Date(b.saved_at) - new Date(a.saved_at); });
}

/**
 * Writes one guide's row: { guide, summary, takeaways }. The videos, topic and date come from the Ideas tab;
 * your done and notes are kept. A guide with fewer than two videos has no row.
 */
function writeGuide_(body) {
  const videos = guideVideos_(body.guide);
  const sheet = sheetFor_('guide');
  const header = header_(sheet, TABS.guide.columns);
  const last = sheet.getLastRow();
  const data = last < 2 ? [] : sheet.getRange(2, 1, last - 1, header.length).getValues();
  const at = data.map(function (r) { return norm_(r[header.indexOf('guide')]); }).indexOf(norm_(body.guide));
  if (videos.length < 2) {
    if (at !== -1) sheet.deleteRow(at + 2);
    return { ok: true, written: 0, videos: videos.length };
  }
  const topics = {};
  videos.forEach(function (v) { if (v.topic) topics[v.topic] = (topics[v.topic] || 0) + 1; });
  const old = at === -1 ? {} : rowObject_(header, data[at]);
  const row = {
    saved_at: videos[0].saved_at,
    done: old.done === true,
    guide: old.guide || body.guide,
    topic: Object.keys(topics).sort(function (a, b) { return topics[b] - topics[a]; })[0] || '',
    videos: videos.length,
    summary: body.summary || '',
    takeaways: body.takeaways || '',
    from: videos.map(function (v) { return v.title; }).join('\n'),
    creator: videos.map(function (v) { return v.creator || ''; }).join('\n'),
    source_url: videos.map(function (v) { return v.source_url; }).join('\n'),
    notes: old.notes || '',
  };
  if (at === -1) return { ok: true, written: append_('guide', [row]), videos: videos.length };
  sheet.getRange(at + 2, 1, 1, header.length).setValues([header.map(function (c) { return cell_(c, row[c]); })]);
  sortNewestFirst_(sheet);
  return { ok: true, written: 1, videos: videos.length };
}

function rowObject_(header, values) {
  const out = {};
  header.forEach(function (c, i) { out[c] = values[i]; });
  return out;
}

function deleteRowsFor_(sheet, sourceUrl) {
  rowsIn_(sheet, sourceUrl).map(function (r) { return r.rowNumber; })
    .sort(function (a, b) { return b - a; })
    .forEach(function (n) { sheet.deleteRow(n); });
}

function cell_(col, value) {
  if (col === 'done') return value === true;
  if (value === undefined || value === null) return '';
  if (col === 'saved_at' && value) return new Date(value);
  // Stop text like "=..." from being read as a formula.
  if (typeof value === 'string' && /^[=+@]/.test(value)) return "'" + value;
  return value;
}

/** Rows for this URL across Places, Recipes and Ideas. */
function savedRows_(sourceUrl) {
  let out = [];
  CONTENT_TYPES.forEach(function (type) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS[type].name);
    if (sheet) out = out.concat(rowsIn_(sheet, sourceUrl).map(function (r) { r.type = type; return r; }));
  });
  return out;
}

function rowsIn_(sheet, sourceUrl) {
  const last = sheet.getLastRow();
  if (last < 2 || !sourceUrl) return [];
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const urlCol = header.indexOf('source_url');
  const titleCol = header.indexOf('title');
  if (urlCol === -1) return [];
  const data = sheet.getRange(2, 1, last - 1, header.length).getValues();
  const out = [];
  // A place saved from several posts lists one link per line.
  data.forEach(function (r, i) {
    if (lines_(r[urlCol]).indexOf(sourceUrl) !== -1) out.push({ rowNumber: i + 2, title: titleCol === -1 ? '' : r[titleCol] });
  });
  return out;
}

function sheetFor_(type) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const name = TABS[type].name;
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(TABS[type].columns);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, TABS[type].columns.length).setFontWeight('bold');
  }
  return sheet;
}

/** Header names as they are in the sheet; any missing columns are added at the end. */
function header_(sheet, columns) {
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  columns.forEach(function (col) {
    if (header.indexOf(col) === -1) {
      header.push(col);
      sheet.getRange(1, header.length).setValue(col).setFontWeight('bold');
    }
  });
  return header;
}

function readTopics_() {
  return readList_(TOPICS_TAB, 'topic', DEFAULT_TOPICS, 'Add a row to add a topic. "Other" is always included.');
}

function readPlaceTypes_() {
  return readList_(PLACE_TYPES_TAB, 'place type', DEFAULT_PLACE_TYPES,
    'Add a row to add a place type. "other" is always included.');
}

/** A one-column list tab (Topics, Place types), created with the defaults the first time. */
function readList_(tabName, header, defaults, note) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    sheet.getRange(1, 1, defaults.length + 1, 1)
      .setValues([[header]].concat(defaults.map(function (t) { return [t]; })));
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1).setFontWeight('bold');
    sheet.getRange(1, 2).setValue(note).setFontStyle('italic');
  }
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, 1).getValues()
    .map(function (r) { return String(r[0]).trim(); })
    .filter(function (t) { return t; });
}

/** The thumbnails folder: "Save Faves thumbnails", the old "Reel Saver thumbnails" renamed, or a new one. */
function thumbnailFolder_() {
  const current = DriveApp.getFoldersByName(THUMBNAIL_FOLDER);
  if (current.hasNext()) return current.next();
  const old = DriveApp.getFoldersByName(OLD_THUMBNAIL_FOLDER);
  if (old.hasNext()) return old.next().setName(THUMBNAIL_FOLDER);
  return DriveApp.createFolder(THUMBNAIL_FOLDER);
}

function saveThumbnail_(url) {
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) return url;
    const folder = thumbnailFolder_();
    const file = folder.createFile(res.getBlob().setName('thumb-' + Date.now() + '.jpg'));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w600';
  } catch (err) {
    return url; // keep the original link rather than failing the save
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** "1-2-3 Shibuya, Tokyo 150-0002, Japan" → "Japan". */
function countryFromAddress_(address) {
  const last = String(address || '').split(',').pop().trim();
  return /\d/.test(last) ? '' : last;
}

/**
 * One-time move from the old single "Saves" tab into Places / Recipes / Ideas / Failed.
 * Run it once from the editor. The old tab is kept, renamed to "Saves (old)".
 */
function migrateSaves() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const old = ss.getSheetByName('Saves');
  if (!old || old.getLastRow() < 2) {
    Logger.log('No "Saves" tab with rows to move.');
    return;
  }
  const values = old.getDataRange().getValues();
  const header = values[0].map(String);
  const byType = { place: [], recipe: [], idea: [], failed: [] };
  values.slice(1).forEach(function (cells) {
    const r = {};
    header.forEach(function (h, i) { r[h] = cells[i]; });
    if (!r.source_url) return;
    const base = {
      saved_at: r.saved_at, title: r.title, summary: r.summary, source_url: r.source_url,
      creator: r.creator, thumbnail_url: r.thumbnail_url, notes: r.notes, done: r.status === 'done',
    };
    if (r.type === 'place') {
      byType.place.push(Object.assign(base, {
        category: r.category, city: r.place_city, country: countryFromAddress_(r.place_address),
        address: r.place_address, what_to_order: String(r.details || '').replace(/^Order:\s*/, ''),
        maps_url: r.maps_url, lat: r.lat, lng: r.lng, place_id: r.place_id,
      }));
    } else if (r.type === 'recipe') {
      byType.recipe.push(Object.assign(base, { ingredients: r.recipe_ingredients, steps: r.recipe_steps, time: r.details }));
    } else if (r.type === 'failed') {
      byType.failed.push({ saved_at: r.saved_at, source_url: r.source_url, error: r.summary, creator: r.creator });
    } else {
      byType.idea.push(Object.assign(base, { topic: 'Other', suggested_topic: r.category, takeaways: r.details }));
    }
  });
  Object.keys(byType).forEach(function (type) { append_(type, byType[type]); });
  old.setName('Saves (old)');
  readTopics_();
  Logger.log('Moved: ' + Object.keys(byType).map(function (t) { return t + ' ' + byType[t].length; }).join(', '));
}

// Keyword guesses for recategorizePlaces(), checked in order against the old category and the title.
const PLACE_TYPE_KEYWORDS = [
  ['home & ceramics', /ceramic|pottery|glass|home|decor|interior|furniture|homeware|kitchenware|candle/],
  ['bakery & dessert', /bakery|bake|dessert|pastr|ice cream|gelato|donut|doughnut|cake|chocolate|sweet/],
  ['cafe', /cafe|café|coffee|\btea\b|matcha|espresso/],
  ['bar', /\bbar\b|cocktail|wine|pub|brewery|beer|izakaya|speakeasy/],
  ['clothing', /cloth|boutique|fashion|vintage|thrift|apparel|denim|shoe|jewel/],
  ['beauty', /beauty|cosmetic|skincare|salon|spa|nail|perfume/],
  ['books & stationery', /book|stationer|paper|pen shop/],
  ['market', /market|bazaar|grocery|deli/],
  ['museum & gallery', /museum|gallery|exhibit|\bart\b/],
  ['stay', /hotel|hostel|ryokan|inn\b|bnb|resort|stay/],
  ['sight', /temple|shrine|park|garden|view|landmark|castle|bridge|beach|sight/],
  ['activity', /class|workshop|tour|activity|hike|onsen|karaoke/],
  ['restaurant', /restaurant|food|ramen|sushi|pizza|taco|noodle|bistro|diner|eat|bbq|burger|udon|curry/],
];

/**
 * One-time cleanup: puts older free-text place categories onto the Place types list.
 * The old wording moves to "specialty" so nothing is lost. Run it once from the editor;
 * check the rows it logs as "other" and fix those by hand.
 */
function recategorizePlaces() {
  const sheet = sheetFor_('place');
  const header = header_(sheet, TABS.place.columns);
  const last = sheet.getLastRow();
  if (last < 2) return;
  const types = readPlaceTypes_().map(function (t) { return t.toLowerCase(); });
  const catCol = header.indexOf('category');
  const specCol = header.indexOf('specialty');
  const titleCol = header.indexOf('title');
  const range = sheet.getRange(2, 1, last - 1, header.length);
  const values = range.getValues();
  const unmatched = [];
  let changed = 0;
  values.forEach(function (row) {
    const old = String(row[catCol] || '').trim();
    if (types.indexOf(old.toLowerCase()) !== -1) return; // already on the list
    const text = (old + ' ' + row[titleCol]).toLowerCase();
    const hit = PLACE_TYPE_KEYWORDS.filter(function (k) {
      return types.indexOf(k[0]) !== -1 && k[1].test(text);
    })[0];
    if (old && !row[specCol]) row[specCol] = old;
    row[catCol] = hit ? hit[0] : 'other';
    if (!hit) unmatched.push(row[titleCol]);
    changed++;
  });
  range.setValues(values);
  Logger.log('Updated ' + changed + ' places. Set to "other", check by hand: ' + (unmatched.join(', ') || 'none'));
}

/**
 * One-time: turns the "mentioned" lists on existing Ideas rows into Mentions rows.
 * Kind, brand, why and price stay empty for these; new saves fill them in. Safe to re-run:
 * ideas that already have Mentions rows are skipped.
 */
function backfillMentions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ideas = ss.getSheetByName(TABS.idea.name);
  if (!ideas || ideas.getLastRow() < 2) {
    Logger.log('No Ideas rows.');
    return;
  }
  const mentionsSheet = sheetFor_('mention');
  const mentionUrls = {};
  if (mentionsSheet.getLastRow() >= 2) {
    const urlCol = header_(mentionsSheet, TABS.mention.columns).indexOf('source_url') + 1;
    mentionsSheet.getRange(2, urlCol, mentionsSheet.getLastRow() - 1, 1).getValues()
      .forEach(function (r) { lines_(r[0]).forEach(function (u) { mentionUrls[u] = true; }); });
  }
  const values = ideas.getDataRange().getValues();
  const header = values[0].map(String);
  const col = function (name) { return header.indexOf(name); };
  const rows = [];
  values.slice(1).forEach(function (r) {
    const url = r[col('source_url')];
    const names = String(r[col('mentioned')] || '').split(',').map(function (n) { return n.trim(); }).filter(String);
    if (!url || !names.length || mentionUrls[url]) return;
    names.forEach(function (name) {
      rows.push({
        saved_at: r[col('saved_at')], status: 'want', name: name, topic: r[col('topic')],
        shop_link: 'https://www.google.com/search?tbm=shop&q=' + encodeURIComponent(name),
        from: r[col('title')], creator: r[col('creator')], source_url: url,
      });
    });
  });
  mergeMentions_(rows);
  Logger.log('Added ' + rows.length + ' mentions.');
}

/** Newest saves at the top. Checkboxes and dropdowns move with their rows. */
function sortNewestFirst_(sheet) {
  const last = sheet.getLastRow();
  if (last < 3) return;
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const col = header.indexOf('saved_at');
  if (col === -1) return;
  sheet.getRange(2, 1, last - 1, header.length).sort({ column: col + 1, ascending: false });
}

/** Run once from the editor to sort the tabs you already have; new saves keep them sorted. */
function sortAllTabs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (type) {
    const sheet = ss.getSheetByName(TABS[type].name);
    if (sheet) sortNewestFirst_(sheet);
  });
  Logger.log('Sorted newest first.');
}

/**
 * Run from the editor after adding a topic: Ideas filed under "Other" whose suggested_topic is now on
 * the Topics tab move to it (and their Mentions rows follow). Other rows are left alone.
 */
function applyNewTopics() {
  Logger.log(JSON.stringify(applyNewTopics_()));
}

function applyNewTopics_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const byName = {};
  readTopics_().forEach(function (t) { byName[t.toLowerCase()] = t; });
  const moved = {};
  const ideas = ss.getSheetByName(TABS.idea.name);
  let ideasMoved = 0;
  if (ideas && ideas.getLastRow() >= 2) {
    const header = header_(ideas, TABS.idea.columns);
    const range = ideas.getRange(2, 1, ideas.getLastRow() - 1, header.length);
    const data = range.getValues();
    const topic = header.indexOf('topic');
    const suggested = header.indexOf('suggested_topic');
    const url = header.indexOf('source_url');
    data.forEach(function (r) {
      const target = byName[String(r[suggested] || '').trim().toLowerCase()];
      if (String(r[topic]).toLowerCase() !== 'other' || !target) return;
      r[topic] = target;
      r[suggested] = '';
      moved[r[url]] = target;
      ideasMoved++;
    });
    if (ideasMoved) range.setValues(data.map(function (r) { return r.map(function (v, c) { return cell_(header[c], v); }); }));
  }
  const mentions = ss.getSheetByName(TABS.mention.name);
  let mentionsMoved = 0;
  if (ideasMoved && mentions && mentions.getLastRow() >= 2) {
    const header = header_(mentions, TABS.mention.columns);
    const range = mentions.getRange(2, 1, mentions.getLastRow() - 1, header.length);
    const data = range.getValues();
    const topic = header.indexOf('topic');
    const url = header.indexOf('source_url');
    data.forEach(function (r) {
      if (String(r[topic]).toLowerCase() !== 'other') return;
      const hit = lines_(r[url]).map(function (u) { return moved[u]; }).filter(String)[0];
      if (hit) {
        r[topic] = hit;
        mentionsMoved++;
      }
    });
    if (mentionsMoved) range.setValues(data.map(function (r) { return r.map(function (v, c) { return cell_(header[c], v); }); }));
  }
  return { ideas: ideasMoved, mentions: mentionsMoved };
}

/** Build step 1: run this from the editor to check the sheet with a hand-written row. */
function testWrite() {
  const result = write_('https://www.instagram.com/reel/TEST123/', [{
    type: 'place',
    saved_at: new Date().toISOString(),
    title: 'Test Ramen Bar',
    summary: 'Hand-written test row. Delete me.',
    category: 'restaurant',
    specialty: 'ramen',
    city: 'New York',
    country: 'United States',
    what_to_order: 'tonkotsu',
    source_url: 'https://www.instagram.com/reel/TEST123/',
    creator: '@test',
  }]);
  readTopics_();
  readPlaceTypes_();
  Logger.log(JSON.stringify(result));
}
