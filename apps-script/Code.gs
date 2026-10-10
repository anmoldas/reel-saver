/**
 * Reel Saver: Sheet write endpoint.
 *
 * Setup: Extensions > Apps Script in your Sheet, paste this file, then
 * Project Settings > Script properties > add SECRET (same value as the Vercel SECRET).
 * Deploy > New deployment > Web app, execute as Me, access Anyone.
 *
 * Rows land in one tab per type: Places, Recipes, Ideas, and Failed for errors.
 * Idea topics come from the Topics tab: add a row there to add a topic.
 */

const TABS = {
  place: {
    name: 'Places',
    columns: ['saved_at', 'done', 'title', 'category', 'specialty', 'city', 'country', 'address', 'what_to_order', 'summary',
      'maps_url', 'lat', 'lng', 'place_id', 'creator', 'source_url', 'thumbnail_url', 'notes'],
  },
  recipe: {
    name: 'Recipes',
    columns: ['saved_at', 'done', 'title', 'summary', 'time', 'servings', 'ingredients', 'steps',
      'creator', 'source_url', 'thumbnail_url', 'notes'],
  },
  idea: {
    name: 'Ideas',
    columns: ['saved_at', 'done', 'topic', 'title', 'summary', 'takeaways', 'mentioned', 'suggested_topic',
      'creator', 'source_url', 'thumbnail_url', 'notes'],
  },
  failed: {
    name: 'Failed',
    columns: ['saved_at', 'source_url', 'error', 'creator'],
  },
};
const CONTENT_TYPES = ['place', 'recipe', 'idea'];

const TOPICS_TAB = 'Topics';
const DEFAULT_TOPICS = ['Travel tips', 'Clothing', 'Career', 'AI', 'Video editing', 'Journaling', 'Organization'];

const PLACE_TYPES_TAB = 'Place types';
const DEFAULT_PLACE_TYPES = ['restaurant', 'cafe', 'bar', 'bakery & dessert', 'home & ceramics', 'clothing', 'beauty',
  'books & stationery', 'market', 'museum & gallery', 'sight', 'activity', 'stay'];

// Instagram/TikTok image links expire within days, so thumbnails are copied to Drive.
const THUMBNAIL_FOLDER = 'Reel Saver thumbnails';

function doGet() {
  return json_({ ok: true, service: 'reel-saver sheet' });
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
    return json_({ ok: false, error: 'Unknown action: ' + body.action });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

/** Is this URL already saved in Places, Recipes or Ideas? Also returns the topic list. */
function check_(sourceUrl) {
  const found = savedRows_(sourceUrl);
  const result = { ok: true, exists: found.length > 0, topics: readTopics_(), place_types: readPlaceTypes_() };
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

  const failedSheet = sheetFor_('failed');
  rowsIn_(failedSheet, sourceUrl).map(function (r) { return r.rowNumber; })
    .sort(function (a, b) { return b - a; })
    .forEach(function (n) { failedSheet.deleteRow(n); });

  const thumbCache = {};
  const byType = {};
  rows.forEach(function (row) {
    const type = TABS[row.type] ? row.type : 'idea';
    if (row.thumbnail_url && type !== 'failed') {
      thumbCache[row.thumbnail_url] = thumbCache[row.thumbnail_url] || saveThumbnail_(row.thumbnail_url);
      row.thumbnail_url = thumbCache[row.thumbnail_url];
    }
    (byType[type] = byType[type] || []).push(row);
  });
  let written = 0;
  Object.keys(byType).forEach(function (type) { written += append_(type, byType[type]); });
  return { ok: true, written: written };
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
  return values.length;
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
  data.forEach(function (r, i) {
    if (r[urlCol] === sourceUrl) out.push({ rowNumber: i + 2, title: titleCol === -1 ? '' : r[titleCol] });
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

function saveThumbnail_(url) {
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) return url;
    const folders = DriveApp.getFoldersByName(THUMBNAIL_FOLDER);
    const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(THUMBNAIL_FOLDER);
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
