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
/** Prüft eine GTIN/EAN gegen das GS1 Modulo-10-Verfahren (8, 12, 13 oder 14 Ziffern). */
export declare function pruefeGtin(raw: string): GtinCheckResult;
/** Zugelassene UN/ECE Recommendation 20 / ISO Mengeneinheiten im Großhandel (BMEcat & SAP OCI). */
export declare const UNECE_UNIT_CODES: ReadonlySet<string>;
/** Häufige deutsche ERP-Abkürzungen, die in SAP OCI & BMEcat abgewiesen werden. */
export declare const GERMAN_UNIT_REPLACEMENTS: Readonly<Record<string, {
    code: string;
    hinweis: string;
}>>;
export interface UnitValidation {
    valid: boolean;
    normalized: string;
    suggestion: string | null;
    reason: string;
}
/** Prüft eine Einheit gegen UN/ECE Rec 20; weist deutsche ERP-Kürzel wie STK oder KG mit Ersatzvorschlag ab. */
export declare function pruefeUneceEinheit(raw: string): UnitValidation;
/** Normalisiert eine Eingabe-Einheit aus CSV/JSON nach UN/ECE (z. B. STK -> C62 oder PCE). */
export declare function normalisiereCsvEinheit(raw: string, stueckZiel?: "C62" | "PCE"): {
    code: string;
    geaendert: boolean;
};
export declare const ISO_4217_CURRENCIES: ReadonlySet<string>;
export declare function pruefeWaehrung(raw: string): boolean;
export interface ClassificationCheck {
    system: "ETIM" | "ECLASS" | "UNSPSC" | "SONSTIGES";
    valid: boolean;
    code: string | null;
    message: string;
}
/** Prüft ETIM-, eCl@ss- und UNSPSC-Klassifikationsangaben in BMEcat-Katalogen. */
export declare function pruefeKlassifikation(systemRaw: string | null, groupIdRaw: string | null): ClassificationCheck;
