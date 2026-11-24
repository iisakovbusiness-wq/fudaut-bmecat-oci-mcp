/**
 * Werkzeug 4: validate_oci_cart
 * Validiert SAP OCI 4.0 / 5.0 PunchOut-Warenkorb-Payloads (JSON, application/x-www-form-urlencoded oder HTML-Formular):
 * - 1-basierte Indizierung NEW_ITEM-FIELD[n]
 * - Pflichtfelder DESCRIPTION, QUANTITY, UNIT, PRICE, PRICEUNIT, CURRENCY
 * - UN/ECE-Einheitenprüfung (weist STK/KG/M mit Ersatzvorschlag PCE/C62/KGM/MTR ab)
 * - Feldlängen-Grenzen (<= 40 Zeichen für DESCRIPTION/MATNR/VENDORMAT/MATGROUP, <= 255 für LONGTEXT/ATTACHMENT)
 * - Exakte BigInt-Warenkorbsummen je Währung
 */
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
    summenJeWaehrung: Record<string, {
        cent: number;
        iso: string;
    }>;
    positionen: OciValidatedItem[];
    fehlerAnzahl: number;
    warnungAnzahl: number;
    befunde: OciFinding[];
}
/** Validiert ein SAP OCI 4.0 / 5.0 PunchOut-Warenkorb-Payload. */
export declare function validateOciCartPayload(rawInput: string): OciValidationResult;
