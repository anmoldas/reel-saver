/**
 * Loc Saver: Sheet write endpoint.
 *
 * Setup: Extensions > Apps Script in your Sheet, paste this file, then
 * Project Settings > Script properties > add SECRET (same value as the Vercel SECRET).
 * Deploy > New deployment > Web app, execute as Me, access Anyone.
 */

const SHEET_NAME = 'Saves';
const COLUMNS = [
  'saved_at', 'type', 'title', 'summary', 'details', 'source_url', 'creator', 'thumbnail_url',
  'recipe_ingredients', 'recipe_steps', 'place_name', 'place_address', 'place_city',
  'lat', 'lng', 'maps_url', 'place_id', 'category', 'notes', 'status',
];
// Instagram/TikTok image links expire within days, so thumbnails are copied to Drive.
const THUMBNAIL_FOLDER = 'Loc Saver thumbnails';

function doGet() {
  return json_({ ok: true, service: 'loc-saver sheet' });
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

/** Is there a non-failed row for this URL? */
function check_(sourceUrl) {
  const found = rowsFor_(sourceUrl).filter(function (r) { return r.type !== 'failed'; });
  return found.length
    ? { ok: true, exists: true, title: found[0].title, type: found[0].type, count: found.length }
    : { ok: true, exists: false };
}

/** Append rows; earlier "failed" rows for the same URL are replaced. */
function write_(sourceUrl, rows) {
  const sheet = sheet_();
  const existing = rowsFor_(sourceUrl);
  if (existing.some(function (r) { return r.type !== 'failed'; })) {
    return { ok: true, written: 0, duplicate: true };
  }
  // Delete old failed rows, bottom-up so row numbers stay valid.
  existing.map(function (r) { return r.rowNumber; }).sort(function (a, b) { return b - a; })
    .forEach(function (n) { sheet.deleteRow(n); });

  if (!rows.length) return { ok: true, written: 0 };
  const header = header_(sheet);
  const thumbCache = {};
  const values = rows.map(function (row) {
    if (row.thumbnail_url) {
      thumbCache[row.thumbnail_url] = thumbCache[row.thumbnail_url] || saveThumbnail_(row.thumbnail_url);
      row.thumbnail_url = thumbCache[row.thumbnail_url];
    }
    return header.map(function (col) { return cell_(col, row[col]); });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, header.length).setValues(values);
  return { ok: true, written: values.length };
}

function cell_(col, value) {
  if (value === undefined || value === null) return '';
  if (col === 'saved_at' && value) return new Date(value);
  // Stop text like "=..." from being read as a formula.
  if (typeof value === 'string' && /^[=+@]/.test(value)) return "'" + value;
  return value;
}

function rowsFor_(sourceUrl) {
  const sheet = sheet_();
  const header = header_(sheet);
  const urlCol = header.indexOf('source_url');
  const typeCol = header.indexOf('type');
  const titleCol = header.indexOf('title');
  const last = sheet.getLastRow();
  if (last < 2 || !sourceUrl) return [];
  const data = sheet.getRange(2, 1, last - 1, header.length).getValues();
  const out = [];
  data.forEach(function (r, i) {
    if (r[urlCol] === sourceUrl) out.push({ rowNumber: i + 2, type: r[typeCol], title: r[titleCol] });
  });
  return out;
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
  }
  return sheet;
}

/** Header names as they are in the sheet; any missing columns are added at the end. */
function header_(sheet) {
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  COLUMNS.forEach(function (col) {
    if (header.indexOf(col) === -1) {
      header.push(col);
      sheet.getRange(1, header.length).setValue(col).setFontWeight('bold');
    }
  });
  return header;
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

/** Build step 1: run this from the editor to check the sheet with a hand-written row. */
function testWrite() {
  const result = write_('https://www.instagram.com/reel/TEST123/', [{
    saved_at: new Date().toISOString(),
    type: 'place',
    title: 'Test Ramen Bar',
    summary: 'Hand-written test row. Delete me.',
    details: 'Order: tonkotsu',
    source_url: 'https://www.instagram.com/reel/TEST123/',
    creator: '@test',
    place_name: 'Test Ramen Bar',
    place_city: 'New York',
    category: 'ramen',
    status: 'to try',
  }]);
  Logger.log(JSON.stringify(result));
}
