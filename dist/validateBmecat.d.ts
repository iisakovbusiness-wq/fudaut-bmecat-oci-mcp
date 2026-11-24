/**
 * Werkzeug 1: validate_bmecat
 * Validiert BMEcat 1.2 & BMEcat 2005 XML-Kataloge (Struktur HEADER/CATALOG/SUPPLIER/T_NEW_CATALOG,
 * eindeutige SUPPLIER_AID/SUPPLIER_PID, GS1 Modulo-10 GTIN/EAN-8/12/13/14, Pflichtfelder,
 * BigInt-Staffelpreise mit LOWER_BOUND/CURRENCY/TAX, UN/ECE-Einheiten, ETIM/eCl@ss, XXE-Sperre).
 */
export type ValidationSeverity = "fehler" | "warnung" | "hinweis";
export interface BmecatFinding {
    stufe: ValidationSeverity;
    code: string;
    artikelId: string | null;
    feld: string;
    zeile: number;
    meldung: string;
}
export interface BmecatValidationResult {
    ok: boolean;
    bmecatVersion: string | null;
    transaktion: string | null;
    katalog: {
        id: string | null;
        name: string | null;
        version: string | null;
        sprache: string | null;
        waehrung: string | null;
        lieferant: string | null;
        generierungsDatum: string | null;
    };
    statistik: {
        artikelAnzahl: number;
        preiseAnzahl: number;
        gtinGeprueft: number;
        klassifiziertEtim: number;
        klassifiziertEclass: number;
        waehrungen: string[];
    };
    fehlerAnzahl: number;
    warnungAnzahl: number;
    befunde: BmecatFinding[];
}
/** Validiert ein BMEcat 1.2 oder 2005 XML-Dokument deterministisch. */
export declare function validateBmecatXml(xml: string): BmecatValidationResult;
