/**
 * Werkzeug 2: bmecat_to_erp_json
 * Konvertiert BMEcat 1.2 / 2005 XML in direkt importierbares ERP-/Shop-JSON oder CSV
 * (generic, jtl-wawi, weclapp, shopware6, sage100, selectline) mit exakter BigInt-Festkomma-Rechnung.
 */

import { BmecatArticle, extractBmecatModel } from "./bmecatModel.js";
import {
  CENT_FACTOR,
  SCALE,
  centsAlsIso,
  mulScaled,
  parseXmlScaled,
  prozentAufCent,
  scaledAlsText,
  scaledToCents,
} from "./math.js";
import { XmlParseError, parseXmlDocument } from "./xml.js";

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
    merkmale: Array<{ name: string; wert: string; einheit: string | null }>;
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

function berechneSteuerProzent(taxRaw: string | null): { text: string; prozentScaled: bigint } {
  const taxScaled = parseXmlScaled(taxRaw);
  if (taxScaled === null || taxScaled < 0n || taxScaled > SCALE) {
    return { text: "19", prozentScaled: 19n * SCALE };
  }
  const pctScaled = taxScaled * 100n;
  return {
    text: scaledAlsText(pctScaled),
    prozentScaled: pctScaled,
  };
}

function berechneBrutto(nettoScaled: bigint, prozentScaled: bigint): string {
  const nettoCent = scaledToCents(nettoScaled);
  const steuerCent = prozentAufCent(nettoCent, prozentScaled);
  return centsAlsIso(nettoCent + steuerCent);
}

function normalisiereArtikel(art: BmecatArticle, fallbackWaehrung: string, gruppenNamen: Record<string, string>): ErpCanonicalArticle {
  const preiseinheitScaled = parseXmlScaled(art.priceQuantityRaw);
  const preiseinheit = preiseinheitScaled && preiseinheitScaled > 0n ? scaledAlsText(preiseinheitScaled) : "1";

  const firstTaxRaw = art.prices.find((p) => p.taxRaw !== null)?.taxRaw ?? null;
  const taxInfo = berechneSteuerProzent(firstTaxRaw);

  const staffelpreise: ErpTierPrice[] = [];
  for (const p of art.prices) {
    const amountScaled = parseXmlScaled(p.amountRaw);
    if (amountScaled === null) continue;
    const factorScaled = parseXmlScaled(p.priceFactorRaw);
    const effAmountScaled = factorScaled && factorScaled > 0n ? mulScaled(amountScaled, factorScaled) : amountScaled;
    const boundScaled = parseXmlScaled(p.lowerBoundRaw);
    const abMenge = boundScaled && boundScaled > 0n ? scaledAlsText(boundScaled) : "1";
    const pTax = p.taxRaw !== null ? berechneSteuerProzent(p.taxRaw) : taxInfo;
    const waehrung = p.currencyRaw ?? fallbackWaehrung;

    staffelpreise.push({
      abMenge,
      preisNetto: scaledAlsText(effAmountScaled, 2),
      preisBrutto: berechneBrutto(effAmountScaled, pTax.prozentScaled),
      preisCent: scaledToCents(effAmountScaled),
      preiseinheit,
      waehrung,
      preistyp: p.priceType,
    });
  }

  staffelpreise.sort((a, b) => {
    const sa = parseXmlScaled(a.abMenge) ?? SCALE;
    const sb = parseXmlScaled(b.abMenge) ?? SCALE;
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });

  const basis = staffelpreise[0] ?? null;
  const hauptFeature = art.featureGroups[0];
  const kategorien = art.kategorieIds.map((gid) => (gruppenNamen[gid] ? `${gid}: ${gruppenNamen[gid]}` : gid));

  return {
    artikelnummer: art.supplierAid ?? "",
    gtin: art.gtins[0]?.wert ?? null,
    kurztext: art.descriptionShort ?? "",
    langtext: art.descriptionLong,
    einheit: art.orderUnit ?? "C62",
    inhaltEinheit: art.contentUnit,
    umrechnungsfaktor: art.noCuPerOuRaw,
    preiseinheit,
    basispreisNetto: basis?.preisNetto ?? null,
    basispreisBrutto: basis?.preisBrutto ?? null,
    basispreisCent: basis?.preisCent ?? null,
    waehrung: basis?.waehrung ?? fallbackWaehrung,
    mwstSatzProzent: taxInfo.text,
    staffelpreise,
    klassifikation: {
      system: hauptFeature?.systemName ?? null,
      klasseId: hauptFeature?.groupId ?? null,
      merkmale: (hauptFeature?.merkmale ?? []).map((m) => ({
        name: m.name,
        wert: m.werte.join(", "),
        einheit: m.einheit,
      })),
    },
    kategorien,
    hersteller: art.manufacturerName,
    herstellerArtikelnummer: art.manufacturerPid,
    lieferzeitTage: art.deliveryTimeRaw,
  };
}

function mappeZielSystem(item: ErpCanonicalArticle, zielSystem: ErpTargetSystem): Record<string, unknown> {
  const staffelSummary = item.staffelpreise
    .map((s) => `${s.abMenge}:${s.preisNetto}`)
    .join("|");

  switch (zielSystem) {
    case "jtl-wawi":
      return {
        Artikelnummer: item.artikelnummer,
        GTIN: item.gtin ?? "",
        Artikelname: item.kurztext,
        Beschreibung: item.langtext ?? "",
        Einheit: item.einheit,
        VK_Netto: item.basispreisNetto ?? "",
        VK_Brutto: item.basispreisBrutto ?? "",
        Steuersatz: item.mwstSatzProzent,
        Waehrung: item.waehrung,
        Preiseinheit: item.preiseinheit,
        Hersteller: item.hersteller ?? "",
        HAN: item.herstellerArtikelnummer ?? "",
        Klassifikation: item.klassifikation.klasseId ?? "",
        Staffelpreise: staffelSummary,
      };
    case "weclapp":
      return {
        articleNumber: item.artikelnummer,
        ean: item.gtin,
        name: item.kurztext,
        description: item.langtext,
        unitName: item.einheit,
        taxRatePercent: item.mwstSatzProzent,
        manufacturerPartNumber: item.herstellerArtikelnummer,
        manufacturerName: item.hersteller,
        articlePrices: item.staffelpreise.map((s) => ({
          scaleFromQuantity: Number(s.abMenge),
          price: s.preisNetto,
          currency: s.waehrung,
          priceScaleType: "SCALE_FROM",
        })),
        classification: item.klassifikation,
      };
    case "shopware6":
      return {
        productNumber: item.artikelnummer,
        ean: item.gtin,
        name: item.kurztext,
        description: item.langtext,
        packUnit: item.einheit,
        manufacturerNumber: item.herstellerArtikelnummer,
        taxRate: item.mwstSatzProzent,
        price: [
          {
            currencyIso: item.waehrung,
            net: item.basispreisNetto ?? "0.00",
            gross: item.basispreisBrutto ?? "0.00",
            linked: true,
          },
        ],
        prices: item.staffelpreise.map((s, idx, arr) => ({
          quantityStart: Number(s.abMenge),
          quantityEnd: arr[idx + 1] ? Number(arr[idx + 1]!.abMenge) - 1 : null,
          net: s.preisNetto,
          gross: s.preisBrutto,
        })),
      };
    case "sage100":
      return {
        Artikelnummer: item.artikelnummer,
        Bezeichnung1: item.kurztext,
        Bezeichnung2: item.langtext ?? "",
        EANNummer: item.gtin ?? "",
        Mengeneinheit: item.einheit,
        Preiseinheit: item.preiseinheit,
        Verkaufspreis1: item.basispreisNetto ?? "",
        SteuerProzent: item.mwstSatzProzent,
        Waehrung: item.waehrung,
        Herstellernummer: item.herstellerArtikelnummer ?? "",
        Staffelpreise: staffelSummary,
      };
    case "selectline":
      return {
        Artikelnummer: item.artikelnummer,
        Bezeichnung: item.kurztext,
        Zusatztext: item.langtext ?? "",
        EAN: item.gtin ?? "",
        Mengeneinheit: item.einheit,
        Preis1: item.basispreisNetto ?? "",
        SteuerProzent: item.mwstSatzProzent,
        Waehrung: item.waehrung,
        Klassifikation: item.klassifikation.klasseId ?? "",
        Staffelpreise: staffelSummary,
      };
    case "generic":
    default:
      return {
        artikelnummer: item.artikelnummer,
        gtin: item.gtin ?? "",
        kurztext: item.kurztext,
        langtext: item.langtext ?? "",
        einheit: item.einheit,
        preiseinheit: item.preiseinheit,
        basispreis_netto: item.basispreisNetto ?? "",
        basispreis_brutto: item.basispreisBrutto ?? "",
        waehrung: item.waehrung,
        mwst_prozent: item.mwstSatzProzent,
        klassifikation_system: item.klassifikation.system ?? "",
        klassifikation_id: item.klassifikation.klasseId ?? "",
        hersteller: item.hersteller ?? "",
        han: item.herstellerArtikelnummer ?? "",
        staffelpreise: staffelSummary,
      };
  }
}

function escapeCsvCell(val: unknown): string {
  const text = val === null || val === undefined
    ? ""
    : typeof val === "object"
      ? JSON.stringify(val)
      : String(val);
  if (/[;"\n\r]/.test(text)) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }
  return text;
}

function erzeugeCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const lines = [headers.join(";")];
  for (const r of rows) {
    lines.push(headers.map((h) => escapeCsvCell(r[h])).join(";"));
  }
  return `${lines.join("\n")}\n`;
}

/** Konvertiert BMEcat 1.2 oder 2005 XML in strukturiertes ERP-/Shop-JSON oder CSV. */
export function convertBmecatToErp(
  xml: string,
  zielSystem: ErpTargetSystem = "generic",
  ausgabeFormat: ErpOutputFormat = "json",
): BmecatToErpResult {
  try {
    const root = parseXmlDocument(xml);
    if (root.localName !== "BMECAT") {
      throw new XmlParseError("BMECAT_WURZEL_UNGUELTIG", `Erwartetes Wurzelelement <BMECAT>, gefunden <${root.localName}>.`, root.line);
    }
    const model = extractBmecatModel(root);
    const fallbackWaehrung = model.currency ?? "EUR";
    const artikel = model.artikel.map((a) => normalisiereArtikel(a, fallbackWaehrung, model.katalogGruppenNamen));
    const staffelpreiseAnzahl = artikel.reduce((acc, a) => acc + a.staffelpreise.length, 0);
    const zielExport = artikel.map((a) => mappeZielSystem(a, zielSystem));
    const csvText = ausgabeFormat === "csv" ? erzeugeCsv(zielExport) : null;

    return {
      ok: true,
      zielSystem,
      ausgabeFormat,
      bmecatVersion: model.version,
      katalog: {
        id: model.catalogId,
        name: model.catalogName,
        sprache: model.language,
        waehrung: fallbackWaehrung,
        lieferant: model.supplierName ?? model.supplierId,
      },
      artikelAnzahl: artikel.length,
      staffelpreiseAnzahl,
      artikel,
      zielExport,
      csvText,
      fehlerMeldung: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      zielSystem,
      ausgabeFormat,
      bmecatVersion: null,
      katalog: {
        id: null,
        name: null,
        sprache: null,
        waehrung: "EUR",
        lieferant: null,
      },
      artikelAnzahl: 0,
      staffelpreiseAnzahl: 0,
      artikel: [],
      zielExport: [],
      csvText: null,
      fehlerMeldung: msg,
    };
  }
}

void CENT_FACTOR;
