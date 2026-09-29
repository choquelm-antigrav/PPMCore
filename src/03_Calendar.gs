/**
 * PPM Core — calendriers de jours ouvrés (H8 : France, Allemagne, Royaume-Uni, Inde).
 *
 * Toutes les dates sont des chaînes AAAA-MM-JJ, calculées en UTC pour éviter
 * tout décalage de fuseau. Les jours fériés sont calculés (Pâques par l'algorithme
 * grégorien anonyme), pas saisis à la main.
 *
 * Périmètre volontairement national :
 *  - FR : fériés légaux nationaux (hors Alsace-Moselle). Le lundi de Pentecôte est inclus ;
 *         si l'entreprise en fait sa journée de solidarité travaillée, le retirer du HolidaySet.
 *  - DE : fériés fédéraux uniquement (les fériés des Länder sont à ajouter par site).
 *  - UK : Angleterre et Pays de Galles, avec reports quand un férié tombe un week-end.
 *         Les fériés exceptionnels (événements royaux) sont à ajouter à la main.
 *  - IN : les trois fériés nationaux ; le reste varie selon l'État et se complète par site.
 */

var DAY_MS = 86400000;

function parseYmd(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) throw new PpmError('VALIDATION', 'Date invalide : ' + s);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fmtYmd(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function addCalendarDays(s, n) {
  return fmtYmd(parseYmd(s) + n * DAY_MS);
}

/** 0 = dimanche … 6 = samedi. */
function weekdayOf(s) {
  return new Date(parseYmd(s)).getUTCDay();
}

function ymd(year, month, day) {
  return fmtYmd(Date.UTC(year, month - 1, day));
}

/** Dimanche de Pâques (algorithme grégorien anonyme). */
function easterSunday(year) {
  var a = year % 19;
  var b = Math.floor(year / 100), c = year % 100;
  var d = Math.floor(b / 4), e = b % 4;
  var f = Math.floor((b + 8) / 25);
  var g = Math.floor((b - f + 1) / 3);
  var h = (19 * a + b - d - g + 15) % 30;
  var i = Math.floor(c / 4), k = c % 4;
  var l = (32 + 2 * e + 2 * i - h - k) % 7;
  var m = Math.floor((a + 11 * h + 22 * l) / 451);
  var month = Math.floor((h + l - 7 * m + 114) / 31);
  var day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(year, month, day);
}

/** n-ième jour de semaine du mois (n = -1 : le dernier). weekday : 0 = dimanche. */
function nthWeekdayOfMonth(year, month, weekday, n) {
  if (n > 0) {
    var first = ymd(year, month, 1);
    var offset = (weekday - weekdayOf(first) + 7) % 7;
    return addCalendarDays(first, offset + (n - 1) * 7);
  }
  var last = fmtYmd(Date.UTC(year, month, 0));
  var back = (weekdayOf(last) - weekday + 7) % 7;
  return addCalendarDays(last, -back);
}

function isWeekend(s) {
  var d = weekdayOf(s);
  return d === 0 || d === 6;
}

/**
 * Applique la règle britannique de report : un férié tombant un week-end passe
 * au premier jour de semaine libre suivant (en tenant compte des autres fériés).
 */
function withUkSubstitutes(list) {
  var taken = {};
  list.forEach(function (h) { if (!isWeekend(h.date)) taken[h.date] = true; });
  return list.map(function (h) {
    if (!isWeekend(h.date)) return h;
    var d = h.date;
    do { d = addCalendarDays(d, 1); } while (isWeekend(d) || taken[d]);
    taken[d] = true;
    return { date: d, label: h.label + ' (report)' };
  });
}

/** Liste des fériés d'un pays pour une année : [{date, label}], triée. */
function holidaysFor(country, year) {
  var E = easterSunday(year);
  var list;
  switch (country) {
    case 'FR':
      list = [
        { date: ymd(year, 1, 1), label: 'Jour de l’an' },
        { date: addCalendarDays(E, 1), label: 'Lundi de Pâques' },
        { date: ymd(year, 5, 1), label: 'Fête du Travail' },
        { date: ymd(year, 5, 8), label: 'Victoire 1945' },
        { date: addCalendarDays(E, 39), label: 'Ascension' },
        { date: addCalendarDays(E, 50), label: 'Lundi de Pentecôte' },
        { date: ymd(year, 7, 14), label: 'Fête nationale' },
        { date: ymd(year, 8, 15), label: 'Assomption' },
        { date: ymd(year, 11, 1), label: 'Toussaint' },
        { date: ymd(year, 11, 11), label: 'Armistice 1918' },
        { date: ymd(year, 12, 25), label: 'Noël' }
      ];
      break;
    case 'DE':
      list = [
        { date: ymd(year, 1, 1), label: 'Neujahr' },
        { date: addCalendarDays(E, -2), label: 'Karfreitag' },
        { date: addCalendarDays(E, 1), label: 'Ostermontag' },
        { date: ymd(year, 5, 1), label: 'Tag der Arbeit' },
        { date: addCalendarDays(E, 39), label: 'Christi Himmelfahrt' },
        { date: addCalendarDays(E, 50), label: 'Pfingstmontag' },
        { date: ymd(year, 10, 3), label: 'Tag der Deutschen Einheit' },
        { date: ymd(year, 12, 25), label: '1. Weihnachtstag' },
        { date: ymd(year, 12, 26), label: '2. Weihnachtstag' }
      ];
      break;
    case 'UK':
      list = withUkSubstitutes([
        { date: ymd(year, 1, 1), label: 'New Year’s Day' },
        { date: addCalendarDays(E, -2), label: 'Good Friday' },
        { date: addCalendarDays(E, 1), label: 'Easter Monday' },
        { date: nthWeekdayOfMonth(year, 5, 1, 1), label: 'Early May bank holiday' },
        { date: nthWeekdayOfMonth(year, 5, 1, -1), label: 'Spring bank holiday' },
        { date: nthWeekdayOfMonth(year, 8, 1, -1), label: 'Summer bank holiday' },
        { date: ymd(year, 12, 25), label: 'Christmas Day' },
        { date: ymd(year, 12, 26), label: 'Boxing Day' }
      ]);
      break;
    case 'IN':
      list = [
        { date: ymd(year, 1, 26), label: 'Republic Day' },
        { date: ymd(year, 8, 15), label: 'Independence Day' },
        { date: ymd(year, 10, 2), label: 'Gandhi Jayanti' }
      ];
      break;
    default:
      throw new PpmError('VALIDATION', 'Pays sans calendrier : ' + country);
  }
  return list.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}

/** Transforme une liste de dates (ou de {date}) en dictionnaire de recherche. */
function holidayMap(list) {
  var map = {};
  (list || []).forEach(function (h) { map[typeof h === 'string' ? h : h.date] = true; });
  return map;
}

function isWorkingDay(s, hol) {
  return !isWeekend(s) && !(hol && hol[s]);
}

/** Premier jour ouvré à partir de s (s inclus). */
function nextWorkingDay(s, hol) {
  var d = s;
  while (!isWorkingDay(d, hol)) d = addCalendarDays(d, 1);
  return d;
}

/**
 * Avance (ou recule si n < 0) de n jours ouvrés. n = 0 renvoie s inchangé.
 */
function addWorkingDays(s, n, hol) {
  var step = n < 0 ? -1 : 1, count = Math.abs(n), d = s;
  while (count > 0) {
    d = addCalendarDays(d, step);
    if (isWorkingDay(d, hol)) count--;
  }
  return d;
}

/**
 * Nombre de jours ouvrés entre a et b, bornes incluses (négatif si b < a).
 */
function workingDaysBetween(a, b, hol) {
  if (a === b) return isWorkingDay(a, hol) ? 1 : 0;
  var sign = b < a ? -1 : 1;
  var from = sign > 0 ? a : b, to = sign > 0 ? b : a;
  var n = 0;
  for (var d = from; d <= to; d = addCalendarDays(d, 1)) {
    if (isWorkingDay(d, hol)) n++;
  }
  return sign * n;
}
