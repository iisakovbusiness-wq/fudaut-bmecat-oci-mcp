/**
 * Werkzeug 3: csv_to_bmecat_2005
 * Konvertiert Großhandels-Preislisten (CSV mit ";" oder "," oder JSON) in sauberes,
 * XML-escaped BMEcat-2005-T_NEW_CATALOG-XML mit HEADER, SUPPLIER, PRODUCT-Blöcken und Staffelpreisen.
 */
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
/** Erzeugt aus Großhandels-CSV oder JSON ein validiertes, XML-escaped BMEcat-2005-Dokument. */
export declare function convertCsvOrJsonToBmecat2005(opts: CsvToBmecatOptions): CsvToBmecatResult;
