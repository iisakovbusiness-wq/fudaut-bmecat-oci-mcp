/**
 * Stammdaten- und Standardcode-Prüfungen für BMEcat 1.2/2005 und SAP OCI 4.0/5.0:
 * - GS1 GTIN / EAN-8 / EAN-12 / EAN-13 / EAN-14 Modulo-10-Prüfziffer
 * - UN/ECE Recommendation 20 Mengeneinheiten (PCE, C62, MTR, KGM, LTR, SET, ...)
 * - ISO 4217 Währungscodes
 * - ETIM, eCl@ss und UNSPSC Klassifikationssyntax
 */

export interface GtinCheckResult {
  valid: boolean;
  format: "GTIN-8" | "GTIN-12" | "GTIN-13" | "GTIN-14" | null;
  normalized: string;
  expectedCheckDigit: number | null;
  actualCheckDigit: number | null;
  errorCode: "BMECAT_EAN_FORMAT_UNGUELTIG" | "BMECAT_EAN_PRUEFZIFFER_FEHLER" | null;
  message: string;
}

const VALID_GTIN_LENGTHS: Record<number, GtinCheckResult["format"]> = {
  8: "GTIN-8",
  12: "GTIN-12",
  13: "GTIN-13",
  14: "GTIN-14",
};

/** Prüft eine GTIN/EAN gegen das GS1 Modulo-10-Verfahren (8, 12, 13 oder 14 Ziffern). */
export function pruefeGtin(raw: string): GtinCheckResult {
  const normalized = raw.trim().replace(/\s+/g, "");
  if (!/^\d+$/.test(normalized)) {
    return {
      valid: false,
      format: null,
      normalized,
      expectedCheckDigit: null,
      actualCheckDigit: null,
      errorCode: "BMECAT_EAN_FORMAT_UNGUELTIG",
      message: `GTIN/EAN "${normalized}" enthält nicht-numerische Zeichen.`,
    };
  }
  const format = VALID_GTIN_LENGTHS[normalized.length] ?? null;
  if (!format) {
    return {
      valid: false,
      format: null,
      normalized,
      expectedCheckDigit: null,
      actualCheckDigit: null,
      errorCode: "BMECAT_EAN_FORMAT_UNGUELTIG",
      message: `GTIN/EAN "${normalized}" hat ${normalized.length} Ziffern; zulässig nach GS1 sind 8, 12, 13 oder 14 Ziffern.`,
    };
  }

  let sum = 0;
  const payloadLen = normalized.length - 1;
  for (let i = 0; i < payloadLen; i++) {
    const digit = Number(normalized[payloadLen - 1 - i]);
    const weight = i % 2 === 0 ? 3 : 1;
    sum += digit * weight;
  }
  const expected = (10 - (sum % 10)) % 10;
  const actual = Number(normalized[normalized.length - 1]);

  if (expected !== actual) {
    return {
      valid: false,
      format,
      normalized,
      expectedCheckDigit: expected,
      actualCheckDigit: actual,
      errorCode: "BMECAT_EAN_PRUEFZIFFER_FEHLER",
      message: `${format} "${normalized}" hat falsche GS1-Prüfziffer ${actual} (erwartet ${expected}).`,
    };
  }

  return {
    valid: true,
    format,
    normalized,
    expectedCheckDigit: expected,
    actualCheckDigit: actual,
    errorCode: null,
    message: `${format} gültig.`,
  };
}

/** Zugelassene UN/ECE Recommendation 20 / ISO Mengeneinheiten im Großhandel (BMEcat & SAP OCI). */
export const UNECE_UNIT_CODES: ReadonlySet<string> = new Set([
  "C62", // one / Stück
  "PCE", // piece / Stück (SAP OCI Standard)
  "EA",  // each
  "NAR", // number of articles
  "NMP", // number of packs
  "SET", // set / Satz
  "PR",  // pair / Paar
  "DZN", // dozen
  "GRO", // gross
  "MTR", // meter
  "CMT", // centimeter
  "MMT", // millimeter
  "KMT", // kilometer
  "INH", // inch
  "FOT", // foot
  "YRD", // yard
  "MTK", // square meter
  "CMK", // square centimeter
  "MMK", // square millimeter
  "MTQ", // cubic meter
  "CMQ", // cubic centimeter
  "LTR", // liter
  "MLT", // milliliter
  "HLT", // hectoliter
  "KGM", // kilogram
  "GRM", // gram
  "MGM", // milligram
  "TNE", // metric ton
  "LBR", // pound
  "ONZ", // ounce
  "PK",  // pack / Paket
  "PA",  // packet
  "BX",  // box
  "CT",  // carton
  "BG",  // bag
  "BO",  // bottle
  "CA",  // can
  "RL",  // roll
  "RO",  // roll (alternative)
  "DR",  // drum
  "PF",  // pallet
  "D97", // pallet/unit load
  "TU",  // tube
  "SA",  // sack
  "ST",  // sheet (Achtung: im deutschen Großhandel oft fälschlich für Stück genutzt, daher unten prüfen)
  "HUR", // hour
  "MIN", // minute
  "SEC", // second
  "DAY", // day
  "WEE", // week
  "MON", // month
  "ANN", // year
  "KWH", // kilowatt hour
  "MWH", // megawatt hour
  "LS",  // lump sum / Pauschale
  "KT",  // kit
  "XPK", // package (UN/ECE Rev 17)
  "XBX", // box (UN/ECE Rev 17)
  "XBG", // bag (UN/ECE Rev 17)
  "XCT", // carton (UN/ECE Rev 17)
  "XPA", // packet (UN/ECE Rev 17)
  "XRL", // reel (UN/ECE Rev 17)
  "XRO", // roll (UN/ECE Rev 17)
  "XCA", // can (UN/ECE Rev 17)
  "XBO", // bottle (UN/ECE Rev 17)
  "XPL", // pail
  "ZZ",  // mutually defined
]);

/** Häufige deutsche ERP-Abkürzungen, die in SAP OCI & BMEcat abgewiesen werden. */
export const GERMAN_UNIT_REPLACEMENTS: Readonly<Record<string, { code: string; hinweis: string }>> = {
  STK: { code: "PCE", hinweis: "PCE oder C62 (Stück nach UN/ECE)" },
  "STK.": { code: "PCE", hinweis: "PCE oder C62 (Stück nach UN/ECE)" },
  STCK: { code: "PCE", hinweis: "PCE oder C62 (Stück nach UN/ECE)" },
  ST: { code: "PCE", hinweis: "PCE oder C62 (Stück; UN/ECE ST bedeutet Bogen/Sheet!)" },
  "ST.": { code: "PCE", hinweis: "PCE oder C62 (Stück nach UN/ECE)" },
  STUECK: { code: "PCE", hinweis: "PCE oder C62 (Stück nach UN/ECE)" },
  "STÜCK": { code: "PCE", hinweis: "PCE oder C62 (Stück nach UN/ECE)" },
  PC: { code: "PCE", hinweis: "PCE oder C62 (Piece nach UN/ECE)" },
  PCS: { code: "PCE", hinweis: "PCE oder C62 (Piece nach UN/ECE)" },
  M: { code: "MTR", hinweis: "MTR (Meter)" },
  METER: { code: "MTR", hinweis: "MTR (Meter)" },
  CM: { code: "CMT", hinweis: "CMT (Zentimeter)" },
  MM: { code: "MMT", hinweis: "MMT (Millimeter)" },
  KM: { code: "KMT", hinweis: "KMT (Kilometer)" },
  KG: { code: "KGM", hinweis: "KGM (Kilogramm)" },
  KILO: { code: "KGM", hinweis: "KGM (Kilogramm)" },
  KILOGRAMM: { code: "KGM", hinweis: "KGM (Kilogramm)" },
  G: { code: "GRM", hinweis: "GRM (Gramm)" },
  GR: { code: "GRM", hinweis: "GRM (Gramm)" },
  GRAMM: { code: "GRM", hinweis: "GRM (Gramm)" },
  T: { code: "TNE", hinweis: "TNE (Tonne)" },
  TO: { code: "TNE", hinweis: "TNE (Tonne)" },
  TONNE: { code: "TNE", hinweis: "TNE (Tonne)" },
  L: { code: "LTR", hinweis: "LTR (Liter)" },
  LITER: { code: "LTR", hinweis: "LTR (Liter)" },
  ML: { code: "MLT", hinweis: "MLT (Milliliter)" },
  M2: { code: "MTK", hinweis: "MTK (Quadratmeter)" },
  QM: { code: "MTK", hinweis: "MTK (Quadratmeter)" },
  M3: { code: "MTQ", hinweis: "MTQ (Kubikmeter)" },
  CBM: { code: "MTQ", hinweis: "MTQ (Kubikmeter)" },
  STD: { code: "HUR", hinweis: "HUR (Stunde)" },
  H: { code: "HUR", hinweis: "HUR (Stunde)" },
  STUNDE: { code: "HUR", hinweis: "HUR (Stunde)" },
  TAG: { code: "DAY", hinweis: "DAY (Tag)" },
  TAGE: { code: "DAY", hinweis: "DAY (Tag)" },
  PAAR: { code: "PR", hinweis: "PR (Paar)" },
  SATZ: { code: "SET", hinweis: "SET (Satz)" },
  PAK: { code: "PK", hinweis: "PK oder PA (Paket)" },
  PKT: { code: "PK", hinweis: "PK oder PA (Paket)" },
  PACK: { code: "PK", hinweis: "PK oder PA (Packung)" },
  PACKUNG: { code: "PK", hinweis: "PK oder PA (Packung)" },
  KRT: { code: "CT", hinweis: "CT (Karton)" },
  KTN: { code: "CT", hinweis: "CT (Karton)" },
  KARTON: { code: "CT", hinweis: "CT (Karton)" },
  ROL: { code: "RL", hinweis: "RL (Rolle)" },
  ROLLE: { code: "RL", hinweis: "RL (Rolle)" },
  BOX: { code: "BX", hinweis: "BX (Box)" },
  PAUSCH: { code: "LS", hinweis: "LS oder C62 (Pauschale)" },
  PSCH: { code: "LS", hinweis: "LS oder C62 (Pauschale)" },
  PAUSCHAL: { code: "LS", hinweis: "LS oder C62 (Pauschale)" },
  PAUSCHALE: { code: "LS", hinweis: "LS oder C62 (Pauschale)" },
};

export interface UnitValidation {
  valid: boolean;
  normalized: string;
  suggestion: string | null;
  reason: string;
}

/** Prüft eine Einheit gegen UN/ECE Rec 20; weist deutsche ERP-Kürzel wie STK oder KG mit Ersatzvorschlag ab. */
export function pruefeUneceEinheit(raw: string): UnitValidation {
  const upper = raw.trim().toUpperCase();
  if (!upper) {
    return {
      valid: false,
      normalized: "",
      suggestion: "PCE",
      reason: "Mengeneinheit ist leer.",
    };
  }
  const deutschesKuerzel = GERMAN_UNIT_REPLACEMENTS[upper];
  if (deutschesKuerzel) {
    return {
      valid: false,
      normalized: upper,
      suggestion: deutschesKuerzel.code,
      reason: `Nicht standardkonforme Einheit "${raw.trim()}" erkannt; in BMEcat und SAP OCI ist ${deutschesKuerzel.hinweis} erforderlich.`,
    };
  }
  if (!UNECE_UNIT_CODES.has(upper)) {
    return {
      valid: false,
      normalized: upper,
      suggestion: null,
      reason: `Unbekannter Einheitscode "${raw.trim()}" (kein zugelassener UN/ECE Rec 20 Code wie PCE, C62, MTR, KGM, LTR, SET).`,
    };
  }
  if (raw.trim() !== upper) {
    return {
      valid: false,
      normalized: upper,
      suggestion: upper,
      reason: `Einheit "${raw.trim()}" muss in Großbuchstaben ("${upper}") angegeben werden.`,
    };
  }
  return {
    valid: true,
    normalized: upper,
    suggestion: null,
    reason: "Gültiger UN/ECE-Einheitencode.",
  };
}

/** Normalisiert eine Eingabe-Einheit aus CSV/JSON nach UN/ECE (z. B. STK -> C62 oder PCE). */
export function normalisiereCsvEinheit(raw: string, stueckZiel: "C62" | "PCE" = "C62"): { code: string; geaendert: boolean } {
  const upper = raw.trim().toUpperCase();
  if (!upper) return { code: stueckZiel, geaendert: true };
  if (upper === "STK" || upper === "STK." || upper === "STCK" || upper === "ST" || upper === "ST." || upper === "STUECK" || upper === "STÜCK" || upper === "PC" || upper === "PCS") {
    return { code: stueckZiel, geaendert: true };
  }
  const rep = GERMAN_UNIT_REPLACEMENTS[upper];
  if (rep) return { code: rep.code, geaendert: true };
  if (UNECE_UNIT_CODES.has(upper)) return { code: upper, geaendert: raw.trim() !== upper };
  return { code: upper, geaendert: false };
}

export const ISO_4217_CURRENCIES: ReadonlySet<string> = new Set([
  "EUR", "CHF", "USD", "GBP", "PLN", "CZK", "DKK", "SEK", "NOK", "HUF",
  "RON", "BGN", "HRK", "RSD", "TRY", "JPY", "CNY", "CAD", "AUD", "NZD",
  "INR", "KRW", "SGD", "HKD", "MXN", "BRL", "ZAR", "AED", "SAR", "ILS",
]);

export function pruefeWaehrung(raw: string): boolean {
  const code = raw.trim();
  return /^[A-Z]{3}$/.test(code) && ISO_4217_CURRENCIES.has(code);
}

export interface ClassificationCheck {
  system: "ETIM" | "ECLASS" | "UNSPSC" | "SONSTIGES";
  valid: boolean;
  code: string | null;
  message: string;
}

/** Prüft ETIM-, eCl@ss- und UNSPSC-Klassifikationsangaben in BMEcat-Katalogen. */
export function pruefeKlassifikation(systemRaw: string | null, groupIdRaw: string | null): ClassificationCheck {
  const sysText = (systemRaw ?? "").trim();
  const groupText = (groupIdRaw ?? "").trim();

  if (/^etim/i.test(sysText)) {
    if (!groupText) {
      return {
        system: "ETIM",
        valid: false,
        code: "BMECAT_KLASSIFIKATION_GRUPPE_FEHLT",
        message: `Klassifikationssystem "${sysText}" angegeben, aber REFERENCE_FEATURE_GROUP_ID fehlt.`,
      };
    }
    if (!/^EC\d{6}$/i.test(groupText)) {
      return {
        system: "ETIM",
        valid: false,
        code: "BMECAT_KLASSIFIKATION_FORMAT_UNGUELTIG",
        message: `ETIM-Klassen-ID "${groupText}" entspricht nicht dem Format EC000000 (EC + 6 Ziffern).`,
      };
    }
    return { system: "ETIM", valid: true, code: null, message: "ETIM-Klassifikation gültig." };
  }

  if (/^e-?cl(?:a|@)ss/i.test(sysText)) {
    if (!groupText) {
      return {
        system: "ECLASS",
        valid: false,
        code: "BMECAT_KLASSIFIKATION_GRUPPE_FEHLT",
        message: `Klassifikationssystem "${sysText}" angegeben, aber REFERENCE_FEATURE_GROUP_ID fehlt.`,
      };
    }
    if (!/^(?:\d{8}|\d{2}-\d{2}-\d{2}-\d{2})$/.test(groupText)) {
      return {
        system: "ECLASS",
        valid: false,
        code: "BMECAT_KLASSIFIKATION_FORMAT_UNGUELTIG",
        message: `eCl@ss-Klassen-ID "${groupText}" muss 8 Ziffern (z. B. 23110101 oder 23-11-01-01) enthalten.`,
      };
    }
    return { system: "ECLASS", valid: true, code: null, message: "eCl@ss-Klassifikation gültig." };
  }

  if (/^unspsc/i.test(sysText)) {
    if (!groupText) {
      return {
        system: "UNSPSC",
        valid: false,
        code: "BMECAT_KLASSIFIKATION_GRUPPE_FEHLT",
        message: `Klassifikationssystem "${sysText}" angegeben, aber REFERENCE_FEATURE_GROUP_ID fehlt.`,
      };
    }
    if (!/^\d{8}$/.test(groupText)) {
      return {
        system: "UNSPSC",
        valid: false,
        code: "BMECAT_KLASSIFIKATION_FORMAT_UNGUELTIG",
        message: `UNSPSC-Code "${groupText}" muss 8 Ziffern enthalten.`,
      };
    }
    return { system: "UNSPSC", valid: true, code: null, message: "UNSPSC-Klassifikation gültig." };
  }

  return {
    system: "SONSTIGES",
    valid: Boolean(groupText || sysText),
    code: !groupText && sysText ? "BMECAT_KLASSIFIKATION_GRUPPE_FEHLT" : null,
    message: sysText ? `Benutzerdefiniertes Klassifikationssystem "${sysText}".` : "Ohne Klassifikation.",
  };
}
