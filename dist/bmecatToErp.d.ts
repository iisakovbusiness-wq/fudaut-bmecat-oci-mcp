/**
 * Werkzeug 2: bmecat_to_erp_json
 * Konvertiert BMEcat 1.2 / 2005 XML in direkt importierbares ERP-/Shop-JSON oder CSV
 * (generic, jtl-wawi, weclapp, shopware6, sage100, selectline) mit exakter BigInt-Festkomma-Rechnung.
 */
export type ErpTargetSystem = "generic" | "jtl-wawi" | "weclapp" | "shopware6" | "sage100" | "selectline";
export type ErpOutputFormat = "json" | "csv";
export interface ErpTierPrice {
    abMenge: string;
    preisNetto: string;
    preisBrutto: string;
    preisCent: number;
    preiseinheit: string;
    waehrung: string;
    preistyp: string;
}
export interface ErpCanonicalArticle {
    artikelnummer: string;
    gtin: string | null;
    kurztext: string;
    langtext: string | null;
    einheit: string;
    inhaltEinheit: string | null;
    umrechnungsfaktor: string | null;
    preiseinheit: string;
    basispreisNetto: string | null;
    basispreisBrutto: string | null;
    basispreisCent: number | null;
    waehrung: string;
    mwstSatzProzent: string;
    staffelpreise: ErpTierPrice[];
    klassifikation: {
        system: string | null;
        klasseId: string | null;
        merkmale: Array<{
            name: string;
            wert: string;
            einheit: string | null;
        }>;
    };
    kategorien: string[];
    hersteller: string | null;
    herstellerArtikelnummer: string | null;
    lieferzeitTage: string | null;
}
export interface BmecatToErpResult {
    ok: boolean;
    zielSystem: ErpTargetSystem;
    ausgabeFormat: ErpOutputFormat;
    bmecatVersion: string | null;
    katalog: {
        id: string | null;
        name: string | null;
        sprache: string | null;
        waehrung: string;
        lieferant: string | null;
    };
    artikelAnzahl: number;
    staffelpreiseAnzahl: number;
    artikel: ErpCanonicalArticle[];
    zielExport: Array<Record<string, unknown>>;
    csvText: string | null;
    fehlerMeldung: string | null;
}
/** Konvertiert BMEcat 1.2 oder 2005 XML in strukturiertes ERP-/Shop-JSON oder CSV. */
export declare function convertBmecatToErp(xml: string, zielSystem?: ErpTargetSystem, ausgabeFormat?: ErpOutputFormat): BmecatToErpResult;
