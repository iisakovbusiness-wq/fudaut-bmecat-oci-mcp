/**
 * Werkzeug 3: csv_to_bmecat_2005
 * Konvertiert Großhandels-Preislisten (CSV mit ";" oder "," oder JSON) in sauberes,
 * XML-escaped BMEcat-2005-T_NEW_CATALOG-XML mit HEADER, SUPPLIER, PRODUCT-Blöcken und Staffelpreisen.
 */

import { normalisiereCsvEinheit, pruefeGtin, pruefeKlassifikation, pruefeWaehrung } from "./codes.js";
import { SCALE, divScaled, parseFlexScaled, scaledAlsText } from "./math.js";
import { escapeXml } from "./xml.js";

export interface CsvToBmecatOptions {
  inhalt: string;
  katalogId?: string;
  katalogName?: string;
  katalogVersion?: string;
  sprache?: string;
  waehrung?: string;
  lieferantName?: string;
  lieferantId?: string;
  generierungsDatum?: string;
  stueckEinheit?: "C62" | "PCE";
}

export interface CsvToBmecatFinding {
  zeile: number;
  feld: string;
  code: string;
  meldung: string;
}

export interface CsvToBmecatResult {
  ok: boolean;
  eingabeTyp: "CSV" | "JSON";
  artikelAnzahl: number;
  staffelpreiseAnzahl: number;
  normalisierteEinheiten: number;
  waehrung: string;
  xml: string | null;
  fehlerAnzahl: number;
  befunde: CsvToBmecatFinding[];
}

interface TierSpec {
  abMengeScaled: bigint;
  abMengeText: string;
  preisText: string;
}

interface NormalizedProductInput {
  zeile: number;
  sku: string;
  gtin: string | null;
  kurztext: string;
  langtext: string | null;
  einheit: string;
  preiseinheit: string;
  waehrung: string;
  taxDecimal: string;
  hersteller: string | null;
  han: string | null;
  lieferzeitTage: string | null;
  klassSystem: string | null;
  klassGruppe: string | null;
  staffeln: TierSpec[];
}

function erkenneTrennzeichen(headerZeile: string): string {
  const zaehleUnquoted = (sep: string): number => {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < headerZeile.length; i++) {
      const ch = headerZeile[i]!;
      if (ch === "\"") inQuotes = !inQuotes;
      else if (!inQuotes && ch === sep) count++;
    }
    return count;
  };
  const semi = zaehleUnquoted(";");
  const comma = zaehleUnquoted(",");
  const tab = zaehleUnquoted("\t");
  if (semi >= comma && semi >= tab && semi > 0) return ";";
  if (tab > comma && tab > 0) return "\t";
  return ",";
}

/** RFC-4180 CSV-Parser mit Unterstützung für Anführungszeichen, ""-Escaping, CRLF und LF. */
function parseCsvRows(raw: string): Array<{ zeile: number; felder: string[] }> {
  const text = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  const ersteZeileEnd = text.search(/\r?\n/);
  const ersteZeile = ersteZeileEnd >= 0 ? text.slice(0, ersteZeileEnd) : text;
  const sep = erkenneTrennzeichen(ersteZeile);

  const rows: Array<{ zeile: number; felder: string[] }> = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let lineNum = 1;
  let rowStartLine = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === "\"") {
        if (text[i + 1] === "\"") {
          field += "\"";
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") lineNum++;
        field += ch;
      }
      continue;
    }

    if (ch === "\"") {
      inQuotes = true;
    } else if (ch === sep) {
      row.push(field.trim());
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field.trim());
      if (row.some((c) => c !== "")) {
        rows.push({ zeile: rowStartLine, felder: row });
      }
      row = [];
      field = "";
      lineNum++;
      rowStartLine = lineNum;
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field.trim());
    if (row.some((c) => c !== "")) {
      rows.push({ zeile: rowStartLine, felder: row });
    }
  }
  return rows;
}

function normKey(k: string): string {
  return k
    .trim()
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .replace(/[^a-z0-9]/g, "");
}

function holeFeld(obj: Record<string, unknown>, ...kandidaten: string[]): string | null {
  const lookup = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) {
    lookup.set(normKey(k), v);
  }
  for (const cand of kandidaten) {
    const v = lookup.get(normKey(cand));
    if (v !== undefined && v !== null) {
      const s = String(v).trim();
      if (s !== "") return s;
    }
  }
  return null;
}

function parseTaxAsDecimal(raw: string | null): string | null {
  if (!raw) return "0.19";
  const cleaned = raw.trim().replaceAll("%", "").trim();
  const scaled = parseFlexScaled(cleaned);
  if (scaled === null || scaled < 0n) return null;
  if (scaled <= SCALE) {
    return scaledAlsText(scaled, 2);
  }
  if (scaled <= 100n * SCALE) {
    const dec = divScaled(scaled, 100n * SCALE);
    return scaledAlsText(dec, 2);
  }
  return null;
}

function parseInlineTiers(raw: string): Array<{ ab: string; preis: string }> {
  const out: Array<{ ab: string; preis: string }> = [];
  for (const part of raw.split("|")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const sepIdx = trimmed.includes(":") ? trimmed.indexOf(":") : trimmed.indexOf("=");
    if (sepIdx <= 0) continue;
    out.push({
      ab: trimmed.slice(0, sepIdx).trim(),
      preis: trimmed.slice(sepIdx + 1).trim(),
    });
  }
  return out;
}

function formatPriceAmount(scaled: bigint): string {
  const txt = scaledAlsText(scaled, 2);
  return txt;
}

/** Erzeugt aus Großhandels-CSV oder JSON ein validiertes, XML-escaped BMEcat-2005-Dokument. */
export function convertCsvOrJsonToBmecat2005(opts: CsvToBmecatOptions): CsvToBmecatResult {
  const trimmed = opts.inhalt.trim();
  const defaultWaehrung = (opts.waehrung ?? "EUR").trim().toUpperCase();
  const stueckZiel = opts.stueckEinheit ?? "C62";
  const befunde: CsvToBmecatFinding[] = [];

  if (!pruefeWaehrung(defaultWaehrung)) {
    return {
      ok: false,
      eingabeTyp: trimmed.startsWith("[") || trimmed.startsWith("{") ? "JSON" : "CSV",
      artikelAnzahl: 0,
      staffelpreiseAnzahl: 0,
      normalisierteEinheiten: 0,
      waehrung: defaultWaehrung,
      xml: null,
      fehlerAnzahl: 1,
      befunde: [{ zeile: 1, feld: "waehrung", code: "BMECAT_WAEHRUNG_UNGUELTIG", meldung: `Ungültige Währung "${defaultWaehrung}".` }],
    };
  }

  let eingabeTyp: "CSV" | "JSON" = "CSV";
  let rawItems: Array<{ zeile: number; data: Record<string, unknown> }> = [];
  let jsonHeader: Record<string, unknown> = {};

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    eingabeTyp = "JSON";
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        rawItems = parsed
          .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
          .map((data, idx) => ({ zeile: idx + 1, data }));
      } else if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        if (obj["header"] && typeof obj["header"] === "object") {
          jsonHeader = obj["header"] as Record<string, unknown>;
        }
        const arr = obj["artikel"] ?? obj["produkte"] ?? obj["products"] ?? obj["items"] ?? [];
        if (Array.isArray(arr)) {
          rawItems = arr
            .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
            .map((data, idx) => ({ zeile: idx + 1, data }));
        }
      }
    } catch (err) {
      return {
        ok: false,
        eingabeTyp: "JSON",
        artikelAnzahl: 0,
        staffelpreiseAnzahl: 0,
        normalisierteEinheiten: 0,
        waehrung: defaultWaehrung,
        xml: null,
        fehlerAnzahl: 1,
        befunde: [{ zeile: 1, feld: "JSON", code: "EINGABE_JSON_UNGUELTIG", meldung: `Ungültiges JSON: ${(err as Error).message}` }],
      };
    }
  } else {
    const parsedRows = parseCsvRows(trimmed);
    if (parsedRows.length < 2) {
      return {
        ok: false,
        eingabeTyp: "CSV",
        artikelAnzahl: 0,
        staffelpreiseAnzahl: 0,
        normalisierteEinheiten: 0,
        waehrung: defaultWaehrung,
        xml: null,
        fehlerAnzahl: 1,
        befunde: [{ zeile: 1, feld: "CSV", code: "CSV_LEER", meldung: "CSV benötigt eine Kopfzeile und mindestens eine Artikelzeile." }],
      };
    }
    const headers = parsedRows[0]!.felder;
    for (let r = 1; r < parsedRows.length; r++) {
      const row = parsedRows[r]!;
      const rec: Record<string, unknown> = {};
      for (let c = 0; c < headers.length; c++) {
        rec[headers[c]!] = row.felder[c] ?? "";
      }
      rawItems.push({ zeile: row.zeile, data: rec });
    }
  }

  if (rawItems.length === 0) {
    return {
      ok: false,
      eingabeTyp,
      artikelAnzahl: 0,
      staffelpreiseAnzahl: 0,
      normalisierteEinheiten: 0,
      waehrung: defaultWaehrung,
      xml: null,
      fehlerAnzahl: 1,
      befunde: [{ zeile: 1, feld: eingabeTyp, code: "KEINE_ARTIKEL", meldung: "Keine Artikelzeilen gefunden." }],
    };
  }

  const produkteMap = new Map<string, NormalizedProductInput>();
  let normalisierteEinheiten = 0;

  for (const { zeile, data } of rawItems) {
    const sku = holeFeld(data, "artikelnummer", "supplier_aid", "supplier_pid", "sku", "artnr", "art_nr", "pid");
    if (!sku) {
      befunde.push({ zeile, feld: "artikelnummer", code: "CSV_ARTIKELNUMMER_FEHLT", meldung: `Zeile ${zeile}: Artikelnummer (SKU / SUPPLIER_PID) fehlt.` });
      continue;
    }

    const preisRaw = holeFeld(data, "preis", "preis_netto", "price", "price_amount", "vk_netto", "ek_netto", "netto");
    const abRaw = holeFeld(data, "staffel_ab", "ab_menge", "lower_bound", "ab") ?? "1";
    const abScaled = parseFlexScaled(abRaw);
    if (abScaled === null || abScaled <= 0n) {
      befunde.push({ zeile, feld: "staffel_ab", code: "CSV_STAFFEL_UNGUELTIG", meldung: `Zeile ${zeile} (${sku}): Staffelmenge "${abRaw}" muss > 0 sein.` });
      continue;
    }

    const rowTiers: TierSpec[] = [];
    if (preisRaw !== null) {
      const pScaled = parseFlexScaled(preisRaw);
      if (pScaled === null || pScaled < 0n) {
        befunde.push({ zeile, feld: "preis", code: "CSV_PREIS_UNGUELTIG", meldung: `Zeile ${zeile} (${sku}): Preis "${preisRaw}" ist ungültig oder negativ.` });
        continue;
      }
      rowTiers.push({
        abMengeScaled: abScaled,
        abMengeText: scaledAlsText(abScaled),
        preisText: formatPriceAmount(pScaled),
      });
    }

    // Zusätzliche Staffel-Spalten (staffel1_ab / staffel1_preis ... staffel5_ab / staffel5_preis)
    for (let idx = 1; idx <= 5; idx++) {
      const sAb = holeFeld(data, `staffel${idx}_ab`, `staffel_${idx}_ab`, `ab${idx}`);
      const sPr = holeFeld(data, `staffel${idx}_preis`, `staffel_${idx}_preis`, `preis${idx}`);
      if (sAb && sPr) {
        const abS = parseFlexScaled(sAb);
        const prS = parseFlexScaled(sPr);
        if (abS === null || abS <= 0n || prS === null || prS < 0n) {
          befunde.push({ zeile, feld: `staffel${idx}`, code: "CSV_STAFFEL_UNGUELTIG", meldung: `Zeile ${zeile} (${sku}): Ungültige Staffel ${idx} (${sAb}: ${sPr}).` });
        } else {
          rowTiers.push({ abMengeScaled: abS, abMengeText: scaledAlsText(abS), preisText: formatPriceAmount(prS) });
        }
      }
    }

    // Kompakte Staffelpreise-Spalte ("10:11.20|50:9.95") oder JSON-Array
    const rawCompactTiers = data["staffelpreise"] ?? data["tier_prices"];
    if (Array.isArray(rawCompactTiers)) {
      for (const entry of rawCompactTiers) {
        if (entry && typeof entry === "object") {
          const eObj = entry as Record<string, unknown>;
          const sAb = holeFeld(eObj, "ab", "abMenge", "lowerBound", "lower_bound");
          const sPr = holeFeld(eObj, "preis", "preisNetto", "price", "price_amount");
          if (sAb && sPr) {
            const abS = parseFlexScaled(sAb);
            const prS = parseFlexScaled(sPr);
            if (abS && abS > 0n && prS !== null && prS >= 0n) {
              rowTiers.push({ abMengeScaled: abS, abMengeText: scaledAlsText(abS), preisText: formatPriceAmount(prS) });
            } else {
              befunde.push({ zeile, feld: "staffelpreise", code: "CSV_STAFFEL_UNGUELTIG", meldung: `Zeile ${zeile} (${sku}): Ungültiger JSON-Staffeleintrag.` });
            }
          }
        }
      }
    } else {
      const compactText = holeFeld(data, "staffelpreise", "staffeln", "tier_prices");
      if (compactText) {
        for (const t of parseInlineTiers(compactText)) {
          const abS = parseFlexScaled(t.ab);
          const prS = parseFlexScaled(t.preis);
          if (abS === null || abS <= 0n || prS === null || prS < 0n) {
            befunde.push({ zeile, feld: "staffelpreise", code: "CSV_STAFFEL_UNGUELTIG", meldung: `Zeile ${zeile} (${sku}): Ungültige Staffel "${t.ab}:${t.preis}".` });
          } else {
            rowTiers.push({ abMengeScaled: abS, abMengeText: scaledAlsText(abS), preisText: formatPriceAmount(prS) });
          }
        }
      }
    }

    const existing = produkteMap.get(sku);
    if (existing) {
      for (const t of rowTiers) {
        if (!existing.staffeln.some((x) => x.abMengeScaled === t.abMengeScaled)) {
          existing.staffeln.push(t);
        }
      }
      continue;
    }

    const kurztext = holeFeld(data, "kurztext", "description_short", "bezeichnung", "name", "artikelname", "title");
    if (!kurztext) {
      befunde.push({ zeile, feld: "kurztext", code: "CSV_KURZTEXT_FEHLT", meldung: `Zeile ${zeile} (${sku}): Kurztext / Artikelbezeichnung fehlt.` });
      continue;
    }
    if (rowTiers.length === 0) {
      befunde.push({ zeile, feld: "preis", code: "CSV_PREIS_FEHLT", meldung: `Zeile ${zeile} (${sku}): Mindestens ein Netto-Preis ist erforderlich.` });
      continue;
    }

    const gtinRaw = holeFeld(data, "gtin", "ean", "ean13", "barcode");
    if (gtinRaw) {
      const gChk = pruefeGtin(gtinRaw);
      if (!gChk.valid) {
        befunde.push({ zeile, feld: "gtin", code: gChk.errorCode ?? "BMECAT_EAN_PRUEFZIFFER_FEHLER", meldung: `Zeile ${zeile} (${sku}): ${gChk.message}` });
      }
    }

    const einheitRaw = holeFeld(data, "einheit", "order_unit", "mengeneinheit", "me", "unit") ?? stueckZiel;
    const normUnit = normalisiereCsvEinheit(einheitRaw, stueckZiel);
    if (normUnit.geaendert) normalisierteEinheiten++;

    const preiseinheitRaw = holeFeld(data, "preiseinheit", "price_quantity", "pe") ?? "1";
    const peScaled = parseFlexScaled(preiseinheitRaw);
    if (peScaled === null || peScaled <= 0n) {
      befunde.push({ zeile, feld: "preiseinheit", code: "CSV_PREISEINHEIT_UNGUELTIG", meldung: `Zeile ${zeile} (${sku}): Preiseinheit "${preiseinheitRaw}" muss > 0 sein.` });
    }

    const rowWaehrung = (holeFeld(data, "waehrung", "currency") ?? defaultWaehrung).toUpperCase();
    if (!pruefeWaehrung(rowWaehrung)) {
      befunde.push({ zeile, feld: "waehrung", code: "BMECAT_WAEHRUNG_UNGUELTIG", meldung: `Zeile ${zeile} (${sku}): Währung "${rowWaehrung}" ungültig.` });
    }

    const taxDec = parseTaxAsDecimal(holeFeld(data, "mwst", "steuersatz", "tax", "ust"));
    if (taxDec === null) {
      befunde.push({ zeile, feld: "mwst", code: "CSV_MWST_UNGUELTIG", meldung: `Zeile ${zeile} (${sku}): MwSt.-Satz ist ungültig.` });
    }

    let klassSystem = holeFeld(data, "klassifikation_system", "klasssystem", "reference_feature_system_name");
    let klassGruppe = holeFeld(data, "klassifikation_id", "klass_id", "reference_feature_group_id");
    const etimDirekt = holeFeld(data, "etim", "etim_klasse");
    const eclassDirekt = holeFeld(data, "eclass", "eclass_klasse");
    if (!klassGruppe && etimDirekt) {
      klassSystem = klassSystem ?? "ETIM-9.0";
      klassGruppe = etimDirekt;
    } else if (!klassGruppe && eclassDirekt) {
      klassSystem = klassSystem ?? "ECLASS-14.0";
      klassGruppe = eclassDirekt;
    }
    if (klassSystem || klassGruppe) {
      const kChk = pruefeKlassifikation(klassSystem, klassGruppe);
      if (!kChk.valid && kChk.code) {
        befunde.push({ zeile, feld: "klassifikation", code: kChk.code, meldung: `Zeile ${zeile} (${sku}): ${kChk.message}` });
      }
    }

    produkteMap.set(sku, {
      zeile,
      sku,
      gtin: gtinRaw,
      kurztext,
      langtext: holeFeld(data, "langtext", "description_long", "beschreibung", "description"),
      einheit: normUnit.code,
      preiseinheit: peScaled && peScaled > 0n ? scaledAlsText(peScaled) : "1",
      waehrung: rowWaehrung,
      taxDecimal: taxDec ?? "0.19",
      hersteller: holeFeld(data, "hersteller", "manufacturer_name"),
      han: holeFeld(data, "han", "hersteller_artnr", "manufacturer_pid", "manufacturer_aid"),
      lieferzeitTage: holeFeld(data, "lieferzeit", "lieferzeit_tage", "delivery_time"),
      klassSystem,
      klassGruppe,
      staffeln: rowTiers,
    });
  }

  if (befunde.length > 0) {
    return {
      ok: false,
      eingabeTyp,
      artikelAnzahl: produkteMap.size,
      staffelpreiseAnzahl: 0,
      normalisierteEinheiten,
      waehrung: defaultWaehrung,
      xml: null,
      fehlerAnzahl: befunde.length,
      befunde,
    };
  }

  const katId = opts.katalogId ?? holeFeld(jsonHeader, "katalogId", "catalogId") ?? "KAT-2005-01";
  const katName = opts.katalogName ?? holeFeld(jsonHeader, "katalogName", "catalogName") ?? "Technischer Großhandel Katalog";
  const katVer = opts.katalogVersion ?? holeFeld(jsonHeader, "katalogVersion", "catalogVersion") ?? "1.0";
  const sprache = opts.sprache ?? holeFeld(jsonHeader, "sprache", "language") ?? "deu";
  const lieferantName = opts.lieferantName ?? holeFeld(jsonHeader, "lieferantName", "supplierName") ?? "Musterhandel Technischer Großhandel GmbH (Example)";
  const lieferantId = opts.lieferantId ?? holeFeld(jsonHeader, "lieferantId", "supplierId") ?? "SUP-EXAMPLE-001";
  const datum = opts.generierungsDatum ?? new Date().toISOString().slice(0, 10);

  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<BMECAT version="2005" xmlns="http://www.bmecat.org/bmecat/2005">`,
    `  <HEADER>`,
    `    <GENERATOR_INFO>fudaut-bmecat-oci-mcp v1.0.0</GENERATOR_INFO>`,
    `    <CATALOG>`,
    `      <LANGUAGE>${escapeXml(sprache)}</LANGUAGE>`,
    `      <CATALOG_ID>${escapeXml(katId)}</CATALOG_ID>`,
    `      <CATALOG_VERSION>${escapeXml(katVer)}</CATALOG_VERSION>`,
    `      <CATALOG_NAME>${escapeXml(katName)}</CATALOG_NAME>`,
    `      <DATETIME type="generation_date">`,
    `        <DATE>${escapeXml(datum)}</DATE>`,
    `      </DATETIME>`,
    `      <CURRENCY>${escapeXml(defaultWaehrung)}</CURRENCY>`,
    `    </CATALOG>`,
    `    <SUPPLIER>`,
    `      <SUPPLIER_ID type="supplier_specific">${escapeXml(lieferantId)}</SUPPLIER_ID>`,
    `      <SUPPLIER_NAME>${escapeXml(lieferantName)}</SUPPLIER_NAME>`,
    `    </SUPPLIER>`,
    `  </HEADER>`,
    `  <T_NEW_CATALOG>`,
  ];

  let staffelpreiseAnzahl = 0;
  for (const prod of produkteMap.values()) {
    const sortedStaffeln = [...prod.staffeln].sort((a, b) =>
      a.abMengeScaled < b.abMengeScaled ? -1 : a.abMengeScaled > b.abMengeScaled ? 1 : 0,
    );
    lines.push(`    <PRODUCT mode="new">`);
    lines.push(`      <SUPPLIER_PID>${escapeXml(prod.sku)}</SUPPLIER_PID>`);
    lines.push(`      <PRODUCT_DETAILS>`);
    lines.push(`        <DESCRIPTION_SHORT>${escapeXml(prod.kurztext)}</DESCRIPTION_SHORT>`);
    if (prod.langtext) {
      lines.push(`        <DESCRIPTION_LONG>${escapeXml(prod.langtext)}</DESCRIPTION_LONG>`);
    }
    if (prod.gtin) {
      lines.push(`        <INTERNATIONAL_PID type="ean">${escapeXml(prod.gtin)}</INTERNATIONAL_PID>`);
    }
    if (prod.han) {
      lines.push(`        <MANUFACTURER_PID>${escapeXml(prod.han)}</MANUFACTURER_PID>`);
    }
    if (prod.hersteller) {
      lines.push(`        <MANUFACTURER_NAME>${escapeXml(prod.hersteller)}</MANUFACTURER_NAME>`);
    }
    if (prod.lieferzeitTage) {
      lines.push(`        <DELIVERY_TIME>${escapeXml(prod.lieferzeitTage)}</DELIVERY_TIME>`);
    }
    lines.push(`      </PRODUCT_DETAILS>`);

    if (prod.klassSystem && prod.klassGruppe) {
      lines.push(`      <PRODUCT_FEATURES>`);
      lines.push(`        <REFERENCE_FEATURE_SYSTEM_NAME>${escapeXml(prod.klassSystem)}</REFERENCE_FEATURE_SYSTEM_NAME>`);
      lines.push(`        <REFERENCE_FEATURE_GROUP_ID>${escapeXml(prod.klassGruppe)}</REFERENCE_FEATURE_GROUP_ID>`);
      lines.push(`      </PRODUCT_FEATURES>`);
    }

    lines.push(`      <PRODUCT_ORDER_DETAILS>`);
    lines.push(`        <ORDER_UNIT>${escapeXml(prod.einheit)}</ORDER_UNIT>`);
    if (prod.preiseinheit !== "1") {
      lines.push(`        <PRICE_QUANTITY>${escapeXml(prod.preiseinheit)}</PRICE_QUANTITY>`);
    }
    lines.push(`      </PRODUCT_ORDER_DETAILS>`);

    lines.push(`      <PRODUCT_PRICE_DETAILS>`);
    for (const st of sortedStaffeln) {
      staffelpreiseAnzahl++;
      lines.push(`        <PRODUCT_PRICE price_type="net_list">`);
      lines.push(`          <PRICE_AMOUNT>${escapeXml(st.preisText)}</PRICE_AMOUNT>`);
      lines.push(`          <PRICE_CURRENCY>${escapeXml(prod.waehrung)}</PRICE_CURRENCY>`);
      lines.push(`          <TAX>${escapeXml(prod.taxDecimal)}</TAX>`);
      lines.push(`          <LOWER_BOUND>${escapeXml(st.abMengeText)}</LOWER_BOUND>`);
      lines.push(`        </PRODUCT_PRICE>`);
    }
    lines.push(`      </PRODUCT_PRICE_DETAILS>`);
    lines.push(`    </PRODUCT>`);
  }

  lines.push(`  </T_NEW_CATALOG>`);
  lines.push(`</BMECAT>`);

  return {
    ok: true,
    eingabeTyp,
    artikelAnzahl: produkteMap.size,
    staffelpreiseAnzahl,
    normalisierteEinheiten,
    waehrung: defaultWaehrung,
    xml: `${lines.join("\n")}\n`,
    fehlerAnzahl: 0,
    befunde: [],
  };
}
