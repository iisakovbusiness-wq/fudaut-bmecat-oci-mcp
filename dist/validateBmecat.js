/**
 * Werkzeug 1: validate_bmecat
 * Validiert BMEcat 1.2 & BMEcat 2005 XML-Kataloge (Struktur HEADER/CATALOG/SUPPLIER/T_NEW_CATALOG,
 * eindeutige SUPPLIER_AID/SUPPLIER_PID, GS1 Modulo-10 GTIN/EAN-8/12/13/14, Pflichtfelder,
 * BigInt-Staffelpreise mit LOWER_BOUND/CURRENCY/TAX, UN/ECE-Einheiten, ETIM/eCl@ss, XXE-Sperre).
 */
import { extractBmecatModel } from "./bmecatModel.js";
import { pruefeGtin, pruefeKlassifikation, pruefeUneceEinheit, pruefeWaehrung } from "./codes.js";
import { SCALE, parseXmlScaled, scaledAlsText } from "./math.js";
import { XmlParseError, parseXmlDocument } from "./xml.js";
const SUPPORTED_VERSIONS = new Set(["1.2", "2005", "2005.1", "2005.2"]);
function bewerteModell(model) {
    const befunde = [];
    const pushFinding = (f) => {
        befunde.push(f);
    };
    // 1. Wurzel & Version
    if (model.wurzelName !== "BMECAT") {
        pushFinding({
            stufe: "fehler",
            code: "BMECAT_WURZEL_UNGUELTIG",
            artikelId: null,
            feld: "BMECAT",
            zeile: model.wurzelZeile,
            meldung: `Erwartetes Wurzelelement <BMECAT>, gefunden <${model.wurzelName}>.`,
        });
    }
    if (!model.version || !SUPPORTED_VERSIONS.has(model.version)) {
        pushFinding({
            stufe: "fehler",
            code: "BMECAT_VERSION_UNGUELTIG",
            artikelId: null,
            feld: "BMECAT/@version",
            zeile: model.wurzelZeile,
            meldung: `BMEcat-Version "${model.version ?? ""}" fehlt oder wird nicht unterstützt (erwartet 1.2 oder 2005).`,
        });
    }
    // 2. HEADER / CATALOG / SUPPLIER
    if (!model.hasHeader) {
        pushFinding({
            stufe: "fehler",
            code: "BMECAT_HEADER_FEHLT",
            artikelId: null,
            feld: "HEADER",
            zeile: model.wurzelZeile,
            meldung: "Pflichtblock <HEADER> fehlt.",
        });
    }
    else {
        if (!model.hasCatalog) {
            pushFinding({
                stufe: "fehler",
                code: "BMECAT_CATALOG_FEHLT",
                artikelId: null,
                feld: "HEADER/CATALOG",
                zeile: model.headerZeile,
                meldung: "Pflichtblock <CATALOG> im <HEADER> fehlt.",
            });
        }
        else {
            if (!model.language) {
                pushFinding({
                    stufe: "fehler",
                    code: "BMECAT_CATALOG_LANGUAGE_FEHLT",
                    artikelId: null,
                    feld: "HEADER/CATALOG/LANGUAGE",
                    zeile: model.catalogZeile,
                    meldung: "Pflichtfeld <LANGUAGE> im <CATALOG> fehlt.",
                });
            }
            if (!model.catalogId) {
                pushFinding({
                    stufe: "fehler",
                    code: "BMECAT_CATALOG_ID_FEHLT",
                    artikelId: null,
                    feld: "HEADER/CATALOG/CATALOG_ID",
                    zeile: model.catalogZeile,
                    meldung: "Pflichtfeld <CATALOG_ID> im <CATALOG> fehlt.",
                });
            }
            if (!model.catalogVersion) {
                pushFinding({
                    stufe: "fehler",
                    code: "BMECAT_CATALOG_VERSION_FEHLT",
                    artikelId: null,
                    feld: "HEADER/CATALOG/CATALOG_VERSION",
                    zeile: model.catalogZeile,
                    meldung: "Pflichtfeld <CATALOG_VERSION> im <CATALOG> fehlt.",
                });
            }
            if (model.currency && !pruefeWaehrung(model.currency)) {
                pushFinding({
                    stufe: "fehler",
                    code: "BMECAT_WAEHRUNG_UNGUELTIG",
                    artikelId: null,
                    feld: "HEADER/CATALOG/CURRENCY",
                    zeile: model.currencyZeile,
                    meldung: `Katalogwährung "${model.currency}" ist kein gültiger ISO-4217-Code.`,
                });
            }
        }
        if (!model.hasSupplier) {
            pushFinding({
                stufe: "fehler",
                code: "BMECAT_SUPPLIER_FEHLT",
                artikelId: null,
                feld: "HEADER/SUPPLIER",
                zeile: model.headerZeile,
                meldung: "Pflichtblock <SUPPLIER> im <HEADER> fehlt.",
            });
        }
        else if (!model.supplierName && !model.supplierId) {
            pushFinding({
                stufe: "fehler",
                code: "BMECAT_SUPPLIER_NAME_FEHLT",
                artikelId: null,
                feld: "HEADER/SUPPLIER/SUPPLIER_NAME",
                zeile: model.supplierZeile,
                meldung: "<SUPPLIER> benötigt mindestens <SUPPLIER_NAME> oder <SUPPLIER_ID>.",
            });
        }
    }
    // 3. Transaktion T_NEW_CATALOG / T_UPDATE_*
    if (!model.transactionType) {
        pushFinding({
            stufe: "fehler",
            code: "BMECAT_TRANSAKTION_FEHLT",
            artikelId: null,
            feld: "T_NEW_CATALOG",
            zeile: model.wurzelZeile,
            meldung: "Kein Transaktionsblock (<T_NEW_CATALOG>, <T_UPDATE_PRODUCTS> oder <T_UPDATE_PRICES>) gefunden.",
        });
    }
    else if (model.artikel.length === 0) {
        pushFinding({
            stufe: "fehler",
            code: "BMECAT_KEINE_ARTIKEL",
            artikelId: null,
            feld: model.transactionType,
            zeile: model.transactionZeile,
            meldung: `Transaktionsblock <${model.transactionType}> enthält keine <PRODUCT>- oder <ARTICLE>-Einträge.`,
        });
    }
    // 4. Artikel- und Staffelpreis-Prüfungen
    const geseheneAids = new Map();
    let preiseAnzahl = 0;
    let gtinGeprueft = 0;
    let klassifiziertEtim = 0;
    let klassifiziertEclass = 0;
    const gefundeneWaehrungen = new Set();
    if (model.currency)
        gefundeneWaehrungen.add(model.currency);
    for (const art of model.artikel) {
        const aidLabel = art.supplierAid ?? `Zeile-${art.zeile}`;
        // Eindeutige SUPPLIER_AID / SUPPLIER_PID
        if (!art.supplierAid) {
            pushFinding({
                stufe: "fehler",
                code: "BMECAT_SUPPLIER_AID_FEHLT",
                artikelId: null,
                feld: "SUPPLIER_AID",
                zeile: art.supplierAidZeile,
                meldung: `<${art.tagName}> in Zeile ${art.zeile} hat keine <SUPPLIER_AID> / <SUPPLIER_PID>.`,
            });
        }
        else {
            const vorherZeile = geseheneAids.get(art.supplierAid);
            if (vorherZeile !== undefined) {
                pushFinding({
                    stufe: "fehler",
                    code: "BMECAT_SUPPLIER_AID_DOPPELT",
                    artikelId: art.supplierAid,
                    feld: "SUPPLIER_AID",
                    zeile: art.supplierAidZeile,
                    meldung: `Doppelte Artikelnummer "${art.supplierAid}" (erstes Auftreten in Zeile ${vorherZeile}).`,
                });
            }
            else {
                geseheneAids.set(art.supplierAid, art.zeile);
            }
        }
        // Pflichtfeld DESCRIPTION_SHORT
        if (!art.descriptionShort) {
            pushFinding({
                stufe: "fehler",
                code: "BMECAT_DESCRIPTION_SHORT_FEHLT",
                artikelId: aidLabel,
                feld: "DESCRIPTION_SHORT",
                zeile: art.descriptionShortZeile,
                meldung: `Artikel "${aidLabel}": Pflichtfeld <DESCRIPTION_SHORT> fehlt oder ist leer.`,
            });
        }
        else if (art.descriptionShort.length > 150) {
            pushFinding({
                stufe: "warnung",
                code: "BMECAT_DESCRIPTION_SHORT_LANG",
                artikelId: aidLabel,
                feld: "DESCRIPTION_SHORT",
                zeile: art.descriptionShortZeile,
                meldung: `Artikel "${aidLabel}": <DESCRIPTION_SHORT> ist ${art.descriptionShort.length} Zeichen lang (BMEcat-2005-Empfehlung <= 150 Zeichen).`,
            });
        }
        // Pflichtfeld ORDER_UNIT (UN/ECE Rec 20)
        if (!art.orderUnit) {
            pushFinding({
                stufe: "fehler",
                code: "BMECAT_ORDER_UNIT_FEHLT",
                artikelId: aidLabel,
                feld: "ORDER_UNIT",
                zeile: art.orderUnitZeile,
                meldung: `Artikel "${aidLabel}": Pflichtfeld <ORDER_UNIT> fehlt.`,
            });
        }
        else {
            const unitCheck = pruefeUneceEinheit(art.orderUnit);
            if (!unitCheck.valid) {
                pushFinding({
                    stufe: "fehler",
                    code: "BMECAT_ORDER_UNIT_UNGUELTIG",
                    artikelId: aidLabel,
                    feld: "ORDER_UNIT",
                    zeile: art.orderUnitZeile,
                    meldung: `Artikel "${aidLabel}": ${unitCheck.reason}`,
                });
            }
        }
        if (art.contentUnit) {
            const cuCheck = pruefeUneceEinheit(art.contentUnit);
            if (!cuCheck.valid) {
                pushFinding({
                    stufe: "warnung",
                    code: "BMECAT_CONTENT_UNIT_UNGUELTIG",
                    artikelId: aidLabel,
                    feld: "CONTENT_UNIT",
                    zeile: art.orderUnitZeile,
                    meldung: `Artikel "${aidLabel}": <CONTENT_UNIT> "${art.contentUnit}" ist kein Standard-UN/ECE-Code.`,
                });
            }
        }
        // Numerische Bestellmengen-Felder (> 0)
        const mengenFelder = [
            { feld: "NO_CU_PER_OU", raw: art.noCuPerOuRaw },
            { feld: "PRICE_QUANTITY", raw: art.priceQuantityRaw },
            { feld: "QUANTITY_MIN", raw: art.quantityMinRaw },
            { feld: "QUANTITY_INTERVAL", raw: art.quantityIntervalRaw },
        ];
        for (const mf of mengenFelder) {
            if (mf.raw !== null) {
                const val = parseXmlScaled(mf.raw);
                if (val === null || val <= 0n) {
                    pushFinding({
                        stufe: "fehler",
                        code: "BMECAT_MENGE_UNGUELTIG",
                        artikelId: aidLabel,
                        feld: mf.feld,
                        zeile: art.orderUnitZeile,
                        meldung: `Artikel "${aidLabel}": <${mf.feld}> "${mf.raw}" muss eine positive Zahl > 0 mit Punkt als Dezimaltrennzeichen sein.`,
                    });
                }
            }
        }
        // GTIN / EAN Pruefung
        for (const gtin of art.gtins) {
            gtinGeprueft++;
            const chk = pruefeGtin(gtin.wert);
            if (!chk.valid) {
                pushFinding({
                    stufe: "fehler",
                    code: chk.errorCode ?? "BMECAT_EAN_PRUEFZIFFER_FEHLER",
                    artikelId: aidLabel,
                    feld: gtin.typ === "ean" ? "EAN" : `INTERNATIONAL_PID[@type="${gtin.typ}"]`,
                    zeile: gtin.zeile,
                    meldung: `Artikel "${aidLabel}": ${chk.message}`,
                });
            }
        }
        // Klassifikationen (ETIM / eCl@ss / UNSPSC)
        for (const fg of art.featureGroups) {
            if (fg.systemName || fg.groupId) {
                const cls = pruefeKlassifikation(fg.systemName, fg.groupId);
                if (cls.system === "ETIM" && cls.valid)
                    klassifiziertEtim++;
                if (cls.system === "ECLASS" && cls.valid)
                    klassifiziertEclass++;
                if (!cls.valid && cls.code) {
                    pushFinding({
                        stufe: "fehler",
                        code: cls.code,
                        artikelId: aidLabel,
                        feld: "REFERENCE_FEATURE_GROUP_ID",
                        zeile: fg.zeile,
                        meldung: `Artikel "${aidLabel}": ${cls.message}`,
                    });
                }
            }
        }
        // Preisdetails & Staffelpreise
        if (!art.hasPriceDetails || art.prices.length === 0) {
            pushFinding({
                stufe: "fehler",
                code: "BMECAT_PRICE_DETAILS_FEHLT",
                artikelId: aidLabel,
                feld: art.tagName === "PRODUCT" ? "PRODUCT_PRICE_DETAILS" : "ARTICLE_PRICE_DETAILS",
                zeile: art.priceDetailsZeile,
                meldung: `Artikel "${aidLabel}": Pflichtblock für Preise (PRICE_DETAILS / PRICE) fehlt.`,
            });
            continue;
        }
        let referenzTax = null;
        const staffelGruppen = new Map();
        for (const p of art.prices) {
            preiseAnzahl++;
            // PRICE_AMOUNT
            const amountScaled = parseXmlScaled(p.amountRaw);
            if (amountScaled === null) {
                pushFinding({
                    stufe: "fehler",
                    code: "BMECAT_PREIS_FORMAT_UNGUELTIG",
                    artikelId: aidLabel,
                    feld: "PRICE_AMOUNT",
                    zeile: p.zeile,
                    meldung: `Artikel "${aidLabel}": <PRICE_AMOUNT> "${p.amountRaw ?? ""}" ist keine gültige XML-Dezimalzahl.`,
                });
            }
            else if (amountScaled < 0n) {
                pushFinding({
                    stufe: "fehler",
                    code: "BMECAT_PREIS_NEGATIV",
                    artikelId: aidLabel,
                    feld: "PRICE_AMOUNT",
                    zeile: p.zeile,
                    meldung: `Artikel "${aidLabel}": Negativer Preis <PRICE_AMOUNT>${p.amountRaw}</PRICE_AMOUNT> ist unzulässig.`,
                });
            }
            // PRICE_CURRENCY
            const effCurrency = p.currencyRaw ?? model.currency;
            if (!effCurrency) {
                pushFinding({
                    stufe: "fehler",
                    code: "BMECAT_WAEHRUNG_FEHLT",
                    artikelId: aidLabel,
                    feld: "PRICE_CURRENCY",
                    zeile: p.zeile,
                    meldung: `Artikel "${aidLabel}": Weder <PRICE_CURRENCY> noch Katalog-<CURRENCY> angegeben.`,
                });
            }
            else {
                if (!pruefeWaehrung(effCurrency)) {
                    pushFinding({
                        stufe: "fehler",
                        code: "BMECAT_WAEHRUNG_UNGUELTIG",
                        artikelId: aidLabel,
                        feld: "PRICE_CURRENCY",
                        zeile: p.zeile,
                        meldung: `Artikel "${aidLabel}": Währung "${effCurrency}" ist kein gültiger ISO-4217-Code.`,
                    });
                }
                else {
                    gefundeneWaehrungen.add(effCurrency);
                    if (model.currency && p.currencyRaw && p.currencyRaw !== model.currency) {
                        pushFinding({
                            stufe: "fehler",
                            code: "BMECAT_WAEHRUNG_INKONSISTENT",
                            artikelId: aidLabel,
                            feld: "PRICE_CURRENCY",
                            zeile: p.zeile,
                            meldung: `Artikel "${aidLabel}": Preiswährung "${p.currencyRaw}" weicht von Katalogwährung "${model.currency}" ab.`,
                        });
                    }
                }
            }
            // TAX (BMEcat erwartet Dezimalanteil 0..1, z. B. 0.19)
            if (p.taxRaw !== null) {
                const taxScaled = parseXmlScaled(p.taxRaw);
                if (taxScaled === null || taxScaled < 0n || taxScaled > SCALE) {
                    pushFinding({
                        stufe: "fehler",
                        code: "BMECAT_TAX_UNGUELTIG",
                        artikelId: aidLabel,
                        feld: "TAX",
                        zeile: p.zeile,
                        meldung: `Artikel "${aidLabel}": <TAX>${p.taxRaw}</TAX> ist unzulässig; BMEcat verlangt Dezimalwerte zwischen 0 und 1 (z. B. 0.19 statt 19).`,
                    });
                }
                else if (referenzTax === null) {
                    referenzTax = taxScaled;
                }
                else if (referenzTax !== taxScaled) {
                    pushFinding({
                        stufe: "fehler",
                        code: "BMECAT_TAX_INKONSISTENT",
                        artikelId: aidLabel,
                        feld: "TAX",
                        zeile: p.zeile,
                        meldung: `Artikel "${aidLabel}": Unterschiedliche Steuersätze innerhalb derselben Artikel-Staffel (${scaledAlsText(referenzTax)} vs. ${p.taxRaw}).`,
                    });
                }
            }
            // PRICE_FACTOR (> 0)
            if (p.priceFactorRaw !== null) {
                const pf = parseXmlScaled(p.priceFactorRaw);
                if (pf === null || pf <= 0n) {
                    pushFinding({
                        stufe: "fehler",
                        code: "BMECAT_PRICE_FACTOR_UNGUELTIG",
                        artikelId: aidLabel,
                        feld: "PRICE_FACTOR",
                        zeile: p.zeile,
                        meldung: `Artikel "${aidLabel}": <PRICE_FACTOR>${p.priceFactorRaw}</PRICE_FACTOR> muss > 0 sein.`,
                    });
                }
            }
            // LOWER_BOUND (> 0)
            let boundScaled = SCALE; // Standard: ab Menge 1
            let boundGueltig = true;
            if (p.lowerBoundRaw !== null) {
                const parsedBound = parseXmlScaled(p.lowerBoundRaw);
                if (parsedBound === null || parsedBound <= 0n) {
                    boundGueltig = false;
                    pushFinding({
                        stufe: "fehler",
                        code: "BMECAT_LOWER_BOUND_UNGUELTIG",
                        artikelId: aidLabel,
                        feld: "LOWER_BOUND",
                        zeile: p.zeile,
                        meldung: `Artikel "${aidLabel}": Staffelgrenze <LOWER_BOUND>${p.lowerBoundRaw}</LOWER_BOUND> muss eine positive Zahl > 0 sein.`,
                    });
                }
                else {
                    boundScaled = parsedBound;
                }
            }
            if (boundGueltig && amountScaled !== null && amountScaled >= 0n) {
                const groupKey = `${p.priceType}|${effCurrency ?? ""}|${[...p.territories].sort().join(",")}`;
                const list = staffelGruppen.get(groupKey) ?? [];
                const dup = list.find((item) => item.bound === boundScaled);
                if (dup) {
                    pushFinding({
                        stufe: "fehler",
                        code: "BMECAT_LOWER_BOUND_DOPPELT",
                        artikelId: aidLabel,
                        feld: "LOWER_BOUND",
                        zeile: p.zeile,
                        meldung: `Artikel "${aidLabel}": Doppelte Staffelgrenze LOWER_BOUND=${scaledAlsText(boundScaled)} in Preisgruppe "${p.priceType}" (bereits in Zeile ${dup.zeile}).`,
                    });
                }
                else {
                    list.push({ bound: boundScaled, amount: amountScaled, zeile: p.zeile });
                    staffelGruppen.set(groupKey, list);
                }
            }
        }
        // Staffelpreis-Monotonie prüfen (höhere Abnahmemenge sollte nicht teurer werden)
        for (const [groupKey, tiers] of staffelGruppen) {
            if (tiers.length <= 1)
                continue;
            const sorted = [...tiers].sort((a, b) => (a.bound < b.bound ? -1 : a.bound > b.bound ? 1 : 0));
            for (let i = 1; i < sorted.length; i++) {
                const prev = sorted[i - 1];
                const curr = sorted[i];
                if (curr.amount > prev.amount) {
                    const priceType = groupKey.split("|")[0] ?? "net_list";
                    pushFinding({
                        stufe: "warnung",
                        code: "BMECAT_STAFFELPREIS_STEIGEND",
                        artikelId: aidLabel,
                        feld: "PRICE_AMOUNT",
                        zeile: curr.zeile,
                        meldung: `Artikel "${aidLabel}" (${priceType}): Staffelpreis ab Menge ${scaledAlsText(curr.bound)} (${scaledAlsText(curr.amount, 2)}) ist höher als ab Menge ${scaledAlsText(prev.bound)} (${scaledAlsText(prev.amount, 2)}).`,
                    });
                }
            }
        }
    }
    const fehlerAnzahl = befunde.filter((b) => b.stufe === "fehler").length;
    const warnungAnzahl = befunde.filter((b) => b.stufe === "warnung").length;
    return {
        ok: fehlerAnzahl === 0,
        bmecatVersion: model.version,
        transaktion: model.transactionType,
        katalog: {
            id: model.catalogId,
            name: model.catalogName,
            version: model.catalogVersion,
            sprache: model.language,
            waehrung: model.currency,
            lieferant: model.supplierName ?? model.supplierId,
            generierungsDatum: model.generationDate,
        },
        statistik: {
            artikelAnzahl: model.artikel.length,
            preiseAnzahl,
            gtinGeprueft,
            klassifiziertEtim,
            klassifiziertEclass,
            waehrungen: [...gefundeneWaehrungen],
        },
        fehlerAnzahl,
        warnungAnzahl,
        befunde,
    };
}
/** Validiert ein BMEcat 1.2 oder 2005 XML-Dokument deterministisch. */
export function validateBmecatXml(xml) {
    try {
        const root = parseXmlDocument(xml);
        const model = extractBmecatModel(root);
        return bewerteModell(model);
    }
    catch (err) {
        const zeile = err instanceof XmlParseError ? err.line : 1;
        const code = err instanceof XmlParseError ? err.code : "BMECAT_XML_FEHLER";
        const meldung = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            bmecatVersion: null,
            transaktion: null,
            katalog: {
                id: null,
                name: null,
                version: null,
                sprache: null,
                waehrung: null,
                lieferant: null,
                generierungsDatum: null,
            },
            statistik: {
                artikelAnzahl: 0,
                preiseAnzahl: 0,
                gtinGeprueft: 0,
                klassifiziertEtim: 0,
                klassifiziertEclass: 0,
                waehrungen: [],
            },
            fehlerAnzahl: 1,
            warnungAnzahl: 0,
            befunde: [
                {
                    stufe: "fehler",
                    code,
                    artikelId: null,
                    feld: "XML",
                    zeile,
                    meldung,
                },
            ],
        };
    }
}
