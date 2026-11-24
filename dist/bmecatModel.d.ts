/**
 * Kanonisches BMEcat 1.2 & BMEcat 2005 Katalogmodell.
 * Extrahiert HEADER, CATALOG, SUPPLIER, T_NEW_CATALOG, Katalog-Gruppenzuordnungen,
 * Artikel/Produkte, GTINs, Mengeneinheiten, Staffelpreise und ETIM-/eCl@ss-Merkmale.
 */
import { XmlNode } from "./xml.js";
export interface BmecatGtinEntry {
    wert: string;
    typ: string;
    zeile: number;
}
export interface BmecatFeatureEntry {
    name: string;
    werte: string[];
    einheit: string | null;
    zeile: number;
}
export interface BmecatFeatureGroup {
    systemName: string | null;
    groupId: string | null;
    zeile: number;
    merkmale: BmecatFeatureEntry[];
}
export interface BmecatPriceEntry {
    zeile: number;
    priceType: string;
    amountRaw: string | null;
    currencyRaw: string | null;
    taxRaw: string | null;
    priceFactorRaw: string | null;
    lowerBoundRaw: string | null;
    territories: string[];
}
export interface BmecatMimeEntry {
    type: string | null;
    source: string;
    description: string | null;
}
export interface BmecatArticle {
    zeile: number;
    tagName: "ARTICLE" | "PRODUCT";
    mode: string | null;
    supplierAid: string | null;
    supplierAidZeile: number;
    descriptionShort: string | null;
    descriptionShortZeile: number;
    descriptionLong: string | null;
    gtins: BmecatGtinEntry[];
    manufacturerPid: string | null;
    manufacturerName: string | null;
    deliveryTimeRaw: string | null;
    orderUnit: string | null;
    orderUnitZeile: number;
    contentUnit: string | null;
    noCuPerOuRaw: string | null;
    priceQuantityRaw: string | null;
    quantityMinRaw: string | null;
    quantityIntervalRaw: string | null;
    hasPriceDetails: boolean;
    priceDetailsZeile: number;
    prices: BmecatPriceEntry[];
    featureGroups: BmecatFeatureGroup[];
    kategorieIds: string[];
    mimeInfos: BmecatMimeEntry[];
}
export interface BmecatCatalogModel {
    wurzelName: string;
    wurzelZeile: number;
    version: string | null;
    xmlns: string;
    hasHeader: boolean;
    headerZeile: number;
    hasCatalog: boolean;
    catalogZeile: number;
    catalogId: string | null;
    catalogVersion: string | null;
    catalogName: string | null;
    language: string | null;
    currency: string | null;
    currencyZeile: number;
    generationDate: string | null;
    hasSupplier: boolean;
    supplierZeile: number;
    supplierId: string | null;
    supplierName: string | null;
    buyerName: string | null;
    transactionType: string | null;
    transactionZeile: number;
    katalogGruppenNamen: Record<string, string>;
    artikel: BmecatArticle[];
}
/** Wandelt einen geparsten BMEcat-XML-Baum in das einheitliche Katalogmodell um. */
export declare function extractBmecatModel(root: XmlNode): BmecatCatalogModel;
