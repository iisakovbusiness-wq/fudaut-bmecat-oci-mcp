/**
 * Werkzeug 4: validate_oci_cart
 * Validiert SAP OCI 4.0 / 5.0 PunchOut-Warenkorb-Payloads (JSON, application/x-www-form-urlencoded oder HTML-Formular):
 * - 1-basierte Indizierung NEW_ITEM-FIELD[n]
 * - Pflichtfelder DESCRIPTION, QUANTITY, UNIT, PRICE, PRICEUNIT, CURRENCY
 * - UN/ECE-Einheitenprüfung (weist STK/KG/M mit Ersatzvorschlag PCE/C62/KGM/MTR ab)
 * - Feldlängen-Grenzen (<= 40 Zeichen für DESCRIPTION/MATNR/VENDORMAT/MATGROUP, <= 255 für LONGTEXT/ATTACHMENT)
 * - Exakte BigInt-Warenkorbsummen je Währung
 */

import { pruefeUneceEinheit, pruefeWaehrung } from "./codes.js";
import { SCALE, centsAlsIso, divScaled, mulScaled, parseXmlScaled, scaledToCents } from "./math.js";
import { decodeXmlEntities } from "./xml.js";

export interface OciFinding {
  stufe: "fehler" | "warnung";
  index: number | null;
  feld: string;
  code: string;
  meldung: string;
}

export interface OciValidatedItem {
  index: number;
  description: string | null;
  quantity: string | null;
  unit: string | null;
  price: string | null;
  priceunit: string;
  currency: string | null;
  matgroup: string | null;
  matnr: string | null;
  vendormat: string | null;
  lineTotalIso: string | null;
  lineTotalCent: number | null;
}

export interface OciValidationResult {
  ok: boolean;
  eingabeFormat: "JSON" | "FORM_URLENCODED" | "HTML_FORM";
  positionenAnzahl: number;
  summenJeWaehrung: Record<string, { cent: number; iso: string }>;
  positionen: OciValidatedItem[];
  fehlerAnzahl: number;
  warnungAnzahl: number;
  befunde: OciFinding[];
}

const OCI_MAX_40_FIELDS = new Set([
  "DESCRIPTION",
  "MATNR",
  "VENDORMAT",
  "MANUFACTMAT",
  "MATGROUP",
  "VENDOR",
  "MANUFACTCODE",
  "CONTRACT",
  "EXT_CATEGORY_ID",
]);

const OCI_MAX_255_FIELDS = new Set([
  "LONGTEXT",
  "ATTACHMENT",
  "ATTACHMENT_TITLE",
  "EXT_PRODUCT_ID",
  "CUST_FIELD5",
]);

function extrahiereFelderAusHtmlForm(raw: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const inputRx = /<input\b([^>]+)>/gi;
  let m: RegExpExecArray | null;
  while ((m = inputRx.exec(raw)) !== null) {
    const attrStr = m[1] ?? "";
    const nameM = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrStr);
    const valM = /\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrStr);
    const name = nameM ? (nameM[1] ?? nameM[2] ?? "") : "";
    const val = valM ? (valM[1] ?? valM[2] ?? "") : "";
    if (name) {
      out.push([decodeXmlEntities(name), decodeXmlEntities(val)]);
    }
  }
  return out;
}

function extrahiereFelderAusFormText(raw: string): Array<[string, string]> {
  const trimmed = raw.trim();
  if (!trimmed.includes("\n")) {
    const params = new URLSearchParams(trimmed);
    return [...params.entries()];
  }
  // Mehrzeiliges Key=Value-Format
  const out: Array<[string, string]> = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    const eq = l.indexOf("=");
    if (eq > 0) {
      const k = l.slice(0, eq).trim();
      const v = l.slice(eq + 1).trim();
      out.push([decodeFormValue(k), decodeFormValue(v)]);
    }
  }
  return out;
}

function decodeFormValue(s: string): string {
  if (!/%[0-9A-Fa-f]{2}|\+/.test(s)) return s;
  try {
    return decodeURIComponent(s.replaceAll("+", " "));
  } catch {
    return s;
  }
}

function parseJsonOci(raw: string): Array<[string, string]> {
  const parsed = JSON.parse(raw) as unknown;
  const pairs: Array<[string, string]> = [];

  if (Array.isArray(parsed)) {
    parsed.forEach((item, idx) => {
      if (item && typeof item === "object") {
        for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
          if (v === undefined || v === null) continue;
          const cleanKey = k.trim().toUpperCase().replace(/^NEW_ITEM-/, "").replace(/\[\d+\]$/, "");
          pairs.push([`NEW_ITEM-${cleanKey}[${idx + 1}]`, String(v)]);
        }
      }
    });
    return pairs;
  }

  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const listCandidate = obj["items"] ?? obj["cart"] ?? obj["positions"];
    if (Array.isArray(listCandidate)) {
      listCandidate.forEach((item, idx) => {
        if (item && typeof item === "object") {
          for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
            if (v === undefined || v === null) continue;
            const cleanKey = k.trim().toUpperCase().replace(/^NEW_ITEM-/, "").replace(/\[\d+\]$/, "");
            pairs.push([`NEW_ITEM-${cleanKey}[${idx + 1}]`, String(v)]);
          }
        }
      });
      return pairs;
    }

    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined && v !== null) {
        pairs.push([k.trim(), String(v)]);
      }
    }
  }

  return pairs;
}

/** Validiert ein SAP OCI 4.0 / 5.0 PunchOut-Warenkorb-Payload. */
export function validateOciCartPayload(rawInput: string): OciValidationResult {
  const trimmed = rawInput.trim();
  const befunde: OciFinding[] = [];
  let eingabeFormat: OciValidationResult["eingabeFormat"] = "FORM_URLENCODED";
  let pairs: Array<[string, string]> = [];

  if (!trimmed) {
    return {
      ok: false,
      eingabeFormat,
      positionenAnzahl: 0,
      summenJeWaehrung: {},
      positionen: [],
      fehlerAnzahl: 1,
      warnungAnzahl: 0,
      befunde: [{ stufe: "fehler", index: null, feld: "PAYLOAD", code: "OCI_LEER", meldung: "SAP-OCI-Payload ist leer." }],
    };
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    eingabeFormat = "JSON";
    try {
      pairs = parseJsonOci(trimmed);
    } catch (err) {
      return {
        ok: false,
        eingabeFormat,
        positionenAnzahl: 0,
        summenJeWaehrung: {},
        positionen: [],
        fehlerAnzahl: 1,
        warnungAnzahl: 0,
        befunde: [{ stufe: "fehler", index: null, feld: "JSON", code: "OCI_JSON_UNGUELTIG", meldung: `Ungültiges JSON: ${(err as Error).message}` }],
      };
    }
  } else if (/<input\b/i.test(trimmed)) {
    eingabeFormat = "HTML_FORM";
    pairs = extrahiereFelderAusHtmlForm(trimmed);
  } else {
    eingabeFormat = "FORM_URLENCODED";
    pairs = extrahiereFelderAusFormText(trimmed);
  }

  const itemFields = new Map<number, Map<string, string>>();
  const longtext132Chunks = new Map<number, string[]>();

  for (const [rawKey, rawVal] of pairs) {
    const key = rawKey.trim();
    const val = rawVal;

    // Sonderformat SAP OCI Longtext: NEW_ITEM-LONGTEXT_1:132[]
    const ltMatch = /^NEW_ITEM-LONGTEXT_(-?\d+):132\[\]$/i.exec(key);
    if (ltMatch) {
      const idx = Number.parseInt(ltMatch[1]!, 10);
      if (idx <= 0) {
        befunde.push({
          stufe: "fehler",
          index: idx,
          feld: key,
          code: "OCI_INDEX_UNGUELTIG",
          meldung: `Ungültiger OCI-Index ${idx} in "${key}"; SAP OCI erwartet 1-basierte Indizes (>= 1).`,
        });
      } else {
        const arr = longtext132Chunks.get(idx) ?? [];
        arr.push(val);
        longtext132Chunks.set(idx, arr);
        if (!itemFields.has(idx)) itemFields.set(idx, new Map());
      }
      continue;
    }

    const match = /^NEW_ITEM-([A-Z0-9_]+)\[([^\]]+)\]$/i.exec(key);
    if (!match) continue;

    const fieldName = match[1]!.toUpperCase();
    const rawIdx = match[2]!.trim();
    if (!/^-?\d+$/.test(rawIdx)) {
      befunde.push({
        stufe: "fehler",
        index: null,
        feld: key,
        code: "OCI_INDEX_UNGUELTIG",
        meldung: `Ungültiger Positionsindex "${rawIdx}" in Feld "${key}".`,
      });
      continue;
    }
    const idx = Number.parseInt(rawIdx, 10);
    if (idx <= 0) {
      befunde.push({
        stufe: "fehler",
        index: idx,
        feld: key,
        code: "OCI_INDEX_UNGUELTIG",
        meldung: `Positionsindex [${idx}] in "${key}" ist nicht zulässig; SAP OCI ist 1-basiert ([1], [2], ...).`,
      });
      continue;
    }

    const map = itemFields.get(idx) ?? new Map<string, string>();
    map.set(fieldName, val);
    itemFields.set(idx, map);
  }

  if (itemFields.size === 0) {
    befunde.push({
      stufe: "fehler",
      index: null,
      feld: "NEW_ITEM",
      code: "OCI_KEINE_POSITIONEN",
      meldung: "Keine gültigen SAP-OCI-Positionen (NEW_ITEM-*[n]) gefunden.",
    });
  }

  const indices = [...itemFields.keys()].sort((a, b) => a - b);
  for (let i = 0; i < indices.length; i++) {
    const expected = i + 1;
    if (indices[i] !== expected) {
      befunde.push({
        stufe: "warnung",
        index: indices[i]!,
        feld: `NEW_ITEM-*[${indices[i]}]`,
        code: "OCI_INDEX_LUECKE",
        meldung: `Lücke in OCI-Indizierung: erwartet [${expected}], gefunden [${indices[i]}].`,
      });
      break;
    }
  }

  const positionen: OciValidatedItem[] = [];
  const summenCentMap = new Map<string, number>();

  for (const idx of indices) {
    const f = itemFields.get(idx)!;
    const desc = f.get("DESCRIPTION")?.trim() ?? null;
    const qtyRaw = f.get("QUANTITY")?.trim() ?? null;
    const unitRaw = f.get("UNIT")?.trim() ?? null;
    const priceRaw = f.get("PRICE")?.trim() ?? null;
    const priceUnitRaw = f.get("PRICEUNIT")?.trim() ?? null;
    const currencyRaw = f.get("CURRENCY")?.trim() ?? null;
    const matgroupRaw = f.get("MATGROUP")?.trim() ?? null;
    const matnrRaw = f.get("MATNR")?.trim() ?? null;
    const vendormatRaw = f.get("VENDORMAT")?.trim() ?? null;

    // Pflichtfeld DESCRIPTION (max 40)
    if (!desc) {
      befunde.push({
        stufe: "fehler",
        index: idx,
        feld: `NEW_ITEM-DESCRIPTION[${idx}]`,
        code: "OCI_DESCRIPTION_FEHLT",
        meldung: `Position ${idx}: Pflichtfeld NEW_ITEM-DESCRIPTION[${idx}] fehlt oder ist leer.`,
      });
    }

    // Längenprüfungen <= 40 / <= 255
    for (const [k, v] of f.entries()) {
      const valTrimmed = v.trim();
      if (OCI_MAX_40_FIELDS.has(k) && valTrimmed.length > 40) {
        befunde.push({
          stufe: "fehler",
          index: idx,
          feld: `NEW_ITEM-${k}[${idx}]`,
          code: "OCI_FELD_ZU_LANG",
          meldung: `Position ${idx}: NEW_ITEM-${k}[${idx}] hat ${valTrimmed.length} Zeichen (SAP-OCI-Grenze maximal 40 Zeichen).`,
        });
      } else if (OCI_MAX_255_FIELDS.has(k) && valTrimmed.length > 255) {
        befunde.push({
          stufe: "fehler",
          index: idx,
          feld: `NEW_ITEM-${k}[${idx}]`,
          code: "OCI_FELD_ZU_LANG",
          meldung: `Position ${idx}: NEW_ITEM-${k}[${idx}] hat ${valTrimmed.length} Zeichen (SAP-OCI-Grenze maximal 255 Zeichen).`,
        });
      } else if ((k === "MATGROUP" || k === "VENDOR" || k === "MANUFACTCODE") && valTrimmed.length > 10 && valTrimmed.length <= 40) {
        befunde.push({
          stufe: "warnung",
          index: idx,
          feld: `NEW_ITEM-${k}[${idx}]`,
          code: "OCI_ECC_LAENGENWARNUNG",
          meldung: `Position ${idx}: NEW_ITEM-${k}[${idx}] hat ${valTrimmed.length} Zeichen (in älteren SAP-ECC-Systemen gilt oft 10-Zeichen-Grenze).`,
        });
      }
    }

    const ltChunks = longtext132Chunks.get(idx) ?? [];
    for (let ci = 0; ci < ltChunks.length; ci++) {
      if (ltChunks[ci]!.length > 132) {
        befunde.push({
          stufe: "fehler",
          index: idx,
          feld: `NEW_ITEM-LONGTEXT_${idx}:132[]`,
          code: "OCI_FELD_ZU_LANG",
          meldung: `Position ${idx}: LONGTEXT-Zeile ${ci + 1} überschreitet 132 Zeichen (${ltChunks[ci]!.length}).`,
        });
      }
    }

    // QUANTITY (> 0, Dezimalpunkt)
    let qtyScaled: bigint | null = null;
    if (qtyRaw === null || qtyRaw === "") {
      befunde.push({
        stufe: "fehler",
        index: idx,
        feld: `NEW_ITEM-QUANTITY[${idx}]`,
        code: "OCI_QUANTITY_FEHLT",
        meldung: `Position ${idx}: Pflichtfeld NEW_ITEM-QUANTITY[${idx}] fehlt.`,
      });
    } else {
      qtyScaled = parseXmlScaled(qtyRaw);
      if (qtyScaled === null) {
        befunde.push({
          stufe: "fehler",
          index: idx,
          feld: `NEW_ITEM-QUANTITY[${idx}]`,
          code: "OCI_ZAHLENFORMAT_UNGUELTIG",
          meldung: `Position ${idx}: NEW_ITEM-QUANTITY[${idx}]="${qtyRaw}" ist ungültig (Punkt statt Komma als Dezimaltrennzeichen erforderlich).`,
        });
      } else if (qtyScaled <= 0n) {
        befunde.push({
          stufe: "fehler",
          index: idx,
          feld: `NEW_ITEM-QUANTITY[${idx}]`,
          code: qtyScaled < 0n ? "OCI_MENGE_NEGATIV" : "OCI_MENGE_UNGUELTIG",
          meldung: `Position ${idx}: NEW_ITEM-QUANTITY[${idx}]="${qtyRaw}" muss größer als 0 sein.`,
        });
      }
    }

    // UNIT (UN/ECE Rec 20, max 3 Zeichen)
    if (!unitRaw) {
      befunde.push({
        stufe: "fehler",
        index: idx,
        feld: `NEW_ITEM-UNIT[${idx}]`,
        code: "OCI_UNIT_FEHLT",
        meldung: `Position ${idx}: Pflichtfeld NEW_ITEM-UNIT[${idx}] fehlt.`,
      });
    } else {
      if (unitRaw.length > 3) {
        befunde.push({
          stufe: "fehler",
          index: idx,
          feld: `NEW_ITEM-UNIT[${idx}]`,
          code: "OCI_FELD_ZU_LANG",
          meldung: `Position ${idx}: NEW_ITEM-UNIT[${idx}]="${unitRaw}" überschreitet 3 Zeichen.`,
        });
      }
      const uChk = pruefeUneceEinheit(unitRaw);
      if (!uChk.valid) {
        befunde.push({
          stufe: "fehler",
          index: idx,
          feld: `NEW_ITEM-UNIT[${idx}]`,
          code: "OCI_EINHEIT_UNGUELTIG",
          meldung: `Position ${idx}: ${uChk.reason}`,
        });
      }
    }

    // PRICE (>= 0, Dezimalpunkt)
    let priceScaled: bigint | null = null;
    if (priceRaw === null || priceRaw === "") {
      befunde.push({
        stufe: "fehler",
        index: idx,
        feld: `NEW_ITEM-PRICE[${idx}]`,
        code: "OCI_PRICE_FEHLT",
        meldung: `Position ${idx}: Pflichtfeld NEW_ITEM-PRICE[${idx}] fehlt.`,
      });
    } else {
      priceScaled = parseXmlScaled(priceRaw);
      if (priceScaled === null) {
        befunde.push({
          stufe: "fehler",
          index: idx,
          feld: `NEW_ITEM-PRICE[${idx}]`,
          code: "OCI_ZAHLENFORMAT_UNGUELTIG",
          meldung: `Position ${idx}: NEW_ITEM-PRICE[${idx}]="${priceRaw}" ist ungültig (Punkt als Dezimaltrennzeichen erforderlich).`,
        });
      } else if (priceScaled < 0n) {
        befunde.push({
          stufe: "fehler",
          index: idx,
          feld: `NEW_ITEM-PRICE[${idx}]`,
          code: "OCI_PREIS_NEGATIV",
          meldung: `Position ${idx}: Negativer Preis NEW_ITEM-PRICE[${idx}]="${priceRaw}" ist in SAP OCI unzulässig.`,
        });
      }
    }

    // PRICEUNIT (Standard 1, > 0)
    let priceUnitScaled = SCALE;
    if (priceUnitRaw !== null && priceUnitRaw !== "") {
      const pu = parseXmlScaled(priceUnitRaw);
      if (pu === null || pu <= 0n) {
        befunde.push({
          stufe: "fehler",
          index: idx,
          feld: `NEW_ITEM-PRICEUNIT[${idx}]`,
          code: "OCI_PREISEINHEIT_UNGUELTIG",
          meldung: `Position ${idx}: NEW_ITEM-PRICEUNIT[${idx}]="${priceUnitRaw}" muss eine positive Zahl > 0 sein.`,
        });
      } else {
        priceUnitScaled = pu;
      }
    }

    // CURRENCY
    if (!currencyRaw) {
      befunde.push({
        stufe: "fehler",
        index: idx,
        feld: `NEW_ITEM-CURRENCY[${idx}]`,
        code: "OCI_CURRENCY_FEHLT",
        meldung: `Position ${idx}: Pflichtfeld NEW_ITEM-CURRENCY[${idx}] fehlt.`,
      });
    } else if (!pruefeWaehrung(currencyRaw)) {
      befunde.push({
        stufe: "fehler",
        index: idx,
        feld: `NEW_ITEM-CURRENCY[${idx}]`,
        code: "OCI_WAEHRUNG_UNGUELTIG",
        meldung: `Position ${idx}: Währung "${currencyRaw}" ist kein gültiger 3-stelliger ISO-4217-Code.`,
      });
    }

    // LEADTIME optional (nicht-negative ganze Zahl)
    const leadRaw = f.get("LEADTIME")?.trim();
    if (leadRaw !== undefined && leadRaw !== "" && !/^\d+$/.test(leadRaw)) {
      befunde.push({
        stufe: "fehler",
        index: idx,
        feld: `NEW_ITEM-LEADTIME[${idx}]`,
        code: "OCI_LEADTIME_UNGUELTIG",
        meldung: `Position ${idx}: NEW_ITEM-LEADTIME[${idx}]="${leadRaw}" muss eine ganze Zahl >= 0 in Tagen sein.`,
      });
    }

    // Hinweis wenn bei Freitext-Bestellung (ohne MATNR) auch MATGROUP fehlt
    if (!matnrRaw && !matgroupRaw) {
      befunde.push({
        stufe: "warnung",
        index: idx,
        feld: `NEW_ITEM-MATGROUP[${idx}]`,
        code: "OCI_MATGROUP_EMPFOHLEN",
        meldung: `Position ${idx}: Weder MATNR noch MATGROUP gesetzt; bei Freitextpositionen benötigt SAP eine Warengruppe.`,
      });
    }

    let lineTotalCent: number | null = null;
    let lineTotalIso: string | null = null;
    if (qtyScaled !== null && qtyScaled > 0n && priceScaled !== null && priceScaled >= 0n && priceUnitScaled > 0n) {
      const lineScaled = divScaled(mulScaled(qtyScaled, priceScaled), priceUnitScaled);
      lineTotalCent = scaledToCents(lineScaled);
      lineTotalIso = centsAlsIso(lineTotalCent);
      if (currencyRaw && pruefeWaehrung(currencyRaw)) {
        summenCentMap.set(currencyRaw, (summenCentMap.get(currencyRaw) ?? 0) + lineTotalCent);
      }
    }

    positionen.push({
      index: idx,
      description: desc,
      quantity: qtyRaw,
      unit: unitRaw,
      price: priceRaw,
      priceunit: priceUnitRaw || "1",
      currency: currencyRaw,
      matgroup: matgroupRaw,
      matnr: matnrRaw,
      vendormat: vendormatRaw,
      lineTotalIso,
      lineTotalCent,
    });
  }

  const summenJeWaehrung: Record<string, { cent: number; iso: string }> = {};
  for (const [curr, cent] of summenCentMap.entries()) {
    summenJeWaehrung[curr] = { cent, iso: centsAlsIso(cent) };
  }

  const fehlerAnzahl = befunde.filter((b) => b.stufe === "fehler").length;
  const warnungAnzahl = befunde.filter((b) => b.stufe === "warnung").length;

  return {
    ok: fehlerAnzahl === 0,
    eingabeFormat,
    positionenAnzahl: positionen.length,
    summenJeWaehrung,
    positionen,
    fehlerAnzahl,
    warnungAnzahl,
    befunde,
  };
}
