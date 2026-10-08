/**
 * Harnais de tests hors ligne : charge les fichiers .gs dans un contexte isolé
 * (comme Apps Script, tous les fichiers partagent la même portée globale),
 * remplace Sheets par des tables en mémoire, fige l'horloge.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadCore() {
  const ctx = { console };
  vm.createContext(ctx);
  // PPM_BUNDLE=dist/PPM_Core.gs : les tests tournent sur le fichier unique fabriqué par tools/build.js.
  if (process.env.PPM_BUNDLE) {
    vm.runInContext(fs.readFileSync(path.resolve(process.env.PPM_BUNDLE), 'utf8'), ctx, { filename: 'PPM_Core.gs' });
  }
  const dir = path.join(__dirname, '..', 'src');
  (process.env.PPM_BUNDLE ? [] : fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort()).forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  });
  return ctx;
}

/** Tables en mémoire avec la même interface que l'adaptateur Sheets. */
function memoryProvider(ctx) {
  const tables = {};
  return function (name) {
    if (!tables[name]) {
      const headers = ctx.tableColumns(name);
      const rows = [];
      const clean = (o) => { const r = {}; headers.forEach((h) => { r[h] = o[h] === undefined || o[h] === null ? '' : o[h]; }); return r; };
      tables[name] = {
        name,
        headers: () => headers.slice(),
        readAll: () => rows.map((r) => ({ ...r })),
        findRow: (id) => { const i = rows.findIndex((r) => String(r.id) === String(id)); return i < 0 ? -1 : i + 2; },
        readRow: (n) => ({ ...rows[n - 2] }),
        writeRow: (n, o) => { rows[n - 2] = clean(o); },
        updateRows: (list) => list.forEach((x) => { rows[x.row - 2] = clean(x.obj); }),
        appendRows: (objs) => objs.forEach((o) => rows.push(clean(o))),
        replaceAll: (objs) => { rows.length = 0; objs.forEach((o) => rows.push(clean(o))); },
        _rows: rows
      };
    }
    return tables[name];
  };
}

/** Contexte prêt à l'emploi : horloge fixe, propriétés, tables vides, mails capturés. */
function freshCore(opts = {}) {
  const ctx = loadCore();
  let t = Date.parse(opts.now || '2026-10-05T08:00:00.000Z');
  ctx.CLOCK = () => (t += 1); // strictement croissante : ordre des événements garanti
  ctx.PROPERTY_OVERRIDES = { PPM_DOMAIN: 'entreprise.com', PPM_ADMINS: 'admin@entreprise.com', PPM_COPILOT: 'oui' }; // le copilote est en suspens par défaut : les tests de ses fonctions l'activent
  ctx.TABLE_PROVIDER = memoryProvider(ctx);
  ctx.IDEMPOTENCY_STORE = {};
  ctx.SENT_MAILS = [];
  return ctx;
}

/** Faux cache du script (CacheService) : compte les appels, peut tomber en panne ou expirer. */
function fakeCache() {
  const store = {};
  const C = {
    calls: 0, fail: false, store,
    get: (k) => { C.calls++; if (C.fail) throw new Error('cache en panne'); return k in store ? store[k] : null; },
    getAll: (keys) => { C.calls++; if (C.fail) throw new Error('cache en panne'); const o = {}; keys.forEach((k) => { if (k in store) o[k] = store[k]; }); return o; },
    put: (k, v) => { C.calls++; if (C.fail) throw new Error('cache en panne'); store[k] = String(v); },
    putAll: (m) => { C.calls++; if (C.fail) throw new Error('cache en panne'); Object.keys(m).forEach((k) => { store[k] = String(m[k]); }); },
    expireAll: () => { Object.keys(store).forEach((k) => delete store[k]); }
  };
  return C;
}

/** Faux services Google (agenda, Drive, annuaire) pour les tests : état inspectable dans _cal, _drive. */
function fakeWorkspace(directory = {}) {
  const cal = { calendars: {}, shares: {}, seq: 0 };
  const drive = { folders: { root: { name: 'PPM Projets', parent: null } }, editors: {}, seq: 0 };
  const W = {
    available: true, calls: [], fail: false,
    calendar: {
      create: (name) => { const id = 'cal' + (++cal.seq); cal.calendars[id] = { name, events: {} }; return id; },
      url: (id) => 'https://calendar.test/' + id,
      upsert: (calId, eventId, ev) => {
        if (W.fail) throw new Error('Agenda indisponible');
        const c = cal.calendars[calId];
        if (!c) throw new Error('Agenda introuvable');
        const id = eventId && c.events[eventId] ? eventId : 'ev' + (++cal.seq);
        c.events[id] = JSON.parse(JSON.stringify(ev));
        W.calls.push(eventId ? 'update' : 'create');
        return id;
      },
      remove: (calId, eventId) => { delete cal.calendars[calId].events[eventId]; W.calls.push('remove'); },
      share: (calId, emails) => {
        const s = (cal.shares[calId] = cal.shares[calId] || {});
        let n = 0;
        emails.forEach((m) => { if (!s[m]) { s[m] = true; n++; } });
        return n;
      }
    },
    drive: {
      root: () => 'root',
      url: (id) => 'https://drive.test/' + id,
      ensureFolder: (parentId, name, folderId) => {
        if (folderId && drive.folders[folderId]) { Object.assign(drive.folders[folderId], { name, parent: parentId }); W.calls.push('folder-update'); return folderId; }
        const id = 'f' + (++drive.seq);
        drive.folders[id] = { name, parent: parentId };
        W.calls.push('folder-create');
        return id;
      },
      share: (fid, emails) => {
        const s = (drive.editors[fid] = drive.editors[fid] || {});
        let n = 0;
        emails.forEach((m) => { if (!s[m]) { s[m] = true; n++; } });
        return n;
      }
    },
    directory: { lookup: (email) => directory[email] || null },
    _cal: cal, _drive: drive
  };
  return W;
}

// ------------------------------------------------------------ mini-runner
const results = { passed: 0, failed: 0, failures: [] };

function test(name, fn) {
  try {
    fn();
    results.passed++;
    process.stdout.write('  ✓ ' + name + '\n');
  } catch (e) {
    results.failed++;
    results.failures.push({ name, error: e });
    process.stdout.write('  ✗ ' + name + '\n    ' + (e && e.message) + '\n');
  }
}

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((msg ? msg + ' — ' : '') + 'attendu ' + b + ', obtenu ' + a);
}

function ok(cond, msg) {
  if (!cond) throw new Error(msg || 'condition fausse');
}

function throwsCode(fn, code) {
  try { fn(); } catch (e) {
    if (e.code === code) return;
    throw new Error('code attendu ' + code + ', obtenu ' + (e.code || e.message));
  }
  throw new Error('exception ' + code + ' attendue');
}

module.exports = { loadCore, freshCore, memoryProvider, fakeWorkspace, fakeCache, test, eq, ok, throwsCode, results };
