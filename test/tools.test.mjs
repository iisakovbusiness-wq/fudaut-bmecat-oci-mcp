/**
 * Fachliche Unit- und Positivkontroll-Tests für alle vier Werkzeuge von fudaut-bmecat-oci-mcp.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  convertBmecatToErp,
  convertCsvOrJsonToBmecat2005,
  mulScaled,
  parseFlexScaled,
  parseXmlScaled,
  pruefeGtin,
  scaledToCents,
  validateBmecatXml,
  validateOciCartPayload,
} from "../dist/index.js";

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));
const readUtf8 = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");

test("BigInt-Festkomma-Arithmetik: exakte Rundung und deutsches CSV-Dezimalformat", () => {
  assert.equal(scaledToCents(parseXmlScaled("1.005")), 101);
  assert.equal(scaledToCents(parseXmlScaled("-1.005")), -101);
  assert.equal(scaledToCents(parseFlexScaled("1.234,50")), 123450);
  assert.equal(scaledToCents(parseFlexScaled("42,505")), 4251);
  assert.equal(scaledToCents(mulScaled(parseXmlScaled("12"), parseXmlScaled("38.90"))), 46680);
});

test("GS1 GTIN/EAN Modulo-10-Prüfziffer: valide EAN-13/EAN-8 bestehen, defekte schlagen fehl", () => {
  assert.equal(pruefeGtin("4099990001018").valid, true);
  assert.equal(pruefeGtin("4099990001025").valid, true);
  assert.equal(pruefeGtin("4099990001032").valid, true);
  assert.equal(pruefeGtin("40999913").valid, true);

  const badCheck = pruefeGtin("4099990001012");
  assert.equal(badCheck.valid, false);
  assert.equal(badCheck.errorCode, "BMECAT_EAN_PRUEFZIFFER_FEHLER");
  assert.equal(badCheck.expectedCheckDigit, 8);
  assert.equal(badCheck.actualCheckDigit, 2);

  const badLen = pruefeGtin("12345");
  assert.equal(badLen.valid, false);
  assert.equal(badLen.errorCode, "BMECAT_EAN_FORMAT_UNGUELTIG");
});

test("validate_bmecat: valide BMEcat 2005 und 1.2 Kataloge bestehen mit 0 Fehlern und 0 Warnungen", () => {
  const res2005 = validateBmecatXml(readUtf8("bmecat-2005-valide.xml"));
  assert.equal(res2005.ok, true);
  assert.equal(res2005.fehlerAnzahl, 0);
  assert.equal(res2005.warnungAnzahl, 0);
  assert.equal(res2005.bmecatVersion, "2005");
  assert.equal(res2005.statistik.artikelAnzahl, 3);
  assert.equal(res2005.statistik.preiseAnzahl, 8);
  assert.equal(res2005.statistik.gtinGeprueft, 3);
  assert.equal(res2005.statistik.klassifiziertEtim, 2);
  assert.equal(res2005.statistik.klassifiziertEclass, 1);

  const res12 = validateBmecatXml(readUtf8("bmecat-12-valide.xml"));
  assert.equal(res12.ok, true);
  assert.equal(res12.fehlerAnzahl, 0);
  assert.equal(res12.warnungAnzahl, 0);
  assert.equal(res12.bmecatVersion, "1.2");
  assert.equal(res12.statistik.artikelAnzahl, 1);
  assert.equal(res12.statistik.klassifiziertEclass, 1);
});

test("Positivkontrolle validate_bmecat: erkennt doppelte SUPPLIER_AID, fehlende Pflichtfelder, kaputte EAN-13, falsche TAX/Währung/LOWER_BOUND und XXE", () => {
  const dup = validateBmecatXml(readUtf8("bmecat-defekt-doppelte-aid.xml"));
  assert.equal(dup.ok, false);
  const dupCodes = dup.befunde.map((b) => b.code);
  assert.ok(dupCodes.includes("BMECAT_SUPPLIER_AID_DOPPELT"));
  assert.ok(dupCodes.includes("BMECAT_DESCRIPTION_SHORT_FEHLT"));
  assert.ok(dupCodes.includes("BMECAT_ORDER_UNIT_FEHLT"));

  const eanBad = validateBmecatXml(readUtf8("bmecat-defekt-ean-und-staffel.xml"));
  assert.equal(eanBad.ok, false);
  const eanCodes = eanBad.befunde.map((b) => b.code);
  assert.ok(eanCodes.includes("BMECAT_EAN_PRUEFZIFFER_FEHLER"));
  assert.ok(eanCodes.includes("BMECAT_KLASSIFIKATION_FORMAT_UNGUELTIG"));
  assert.ok(eanCodes.includes("BMECAT_ORDER_UNIT_UNGUELTIG"));
  assert.ok(eanCodes.includes("BMECAT_PREIS_NEGATIV"));
  assert.ok(eanCodes.includes("BMECAT_WAEHRUNG_INKONSISTENT"));
  assert.ok(eanCodes.includes("BMECAT_TAX_UNGUELTIG"));
  assert.ok(eanCodes.includes("BMECAT_LOWER_BOUND_UNGUELTIG"));
  assert.ok(eanCodes.includes("BMECAT_LOWER_BOUND_DOPPELT"));

  const xxe = validateBmecatXml(readUtf8("bmecat-defekt-xxe.xml"));
  assert.equal(xxe.ok, false);
  assert.equal(xxe.befunde[0]?.code, "XML_SICHERHEIT_ENTITY_VERBOTEN");
});

test("Positivkontrolle Staffelpreise: steigender Staffelpreis bei höherer Abnahmemenge löst Warnung aus", () => {
  const xml = readUtf8("bmecat-12-valide.xml").replace("<PRICE_AMOUNT>13.90</PRICE_AMOUNT>", "<PRICE_AMOUNT>18.90</PRICE_AMOUNT>");
  const res = validateBmecatXml(xml);
  assert.equal(res.ok, true);
  assert.ok(res.warnungAnzahl >= 1);
  assert.ok(res.befunde.some((b) => b.code === "BMECAT_STAFFELPREIS_STEIGEND"));
});

test("bmecat_to_erp_json: konvertiert nach Shopware 6, JTL-Wawi (CSV), weclapp, Sage 100 und SelectLine mit exakter Bruttorechnung", () => {
  const xml2005 = readUtf8("bmecat-2005-valide.xml");

  const sw6 = convertBmecatToErp(xml2005, "shopware6", "json");
  assert.equal(sw6.ok, true);
  assert.equal(sw6.artikelAnzahl, 3);
  assert.equal(sw6.staffelpreiseAnzahl, 8);
  assert.equal(sw6.artikel[0]?.basispreisNetto, "42.50");
  assert.equal(sw6.artikel[0]?.basispreisBrutto, "50.58"); // 42.50 * 1.19 = 50.575 -> 50.58
  assert.equal(sw6.artikel[0]?.mwstSatzProzent, "19");
  assert.deepEqual(sw6.artikel[0]?.kategorien, ["GRP-VALVES: Kugelhähne & Armaturen"]);

  const jtlCsv = convertBmecatToErp(xml2005, "jtl-wawi", "csv");
  assert.equal(jtlCsv.ok, true);
  assert.ok(jtlCsv.csvText && jtlCsv.csvText.includes("Artikelnummer;GTIN;Artikelname;"));
  assert.ok(jtlCsv.csvText.includes("IND-KG-2501;4099990001018;"));
  assert.equal(jtlCsv.csvText.includes("\r"), false);

  for (const sys of ["generic", "weclapp", "sage100", "selectline"]) {
    const res = convertBmecatToErp(xml2005, sys, "json");
    assert.equal(res.ok, true, `Ziel ${sys} fehlgeschlagen`);
    assert.equal(res.zielExport.length, 3);
  }

  const badXxe = convertBmecatToErp(readUtf8("bmecat-defekt-xxe.xml"), "generic", "json");
  assert.equal(badXxe.ok, false);
});

test("csv_to_bmecat_2005 Roundtrip: Großhandels-CSV und JSON erzeugen valides BMEcat 2005 XML (0 Fehler, 0 Warnungen)", () => {
  const csvRes = convertCsvOrJsonToBmecat2005({
    inhalt: readUtf8("grosshandel-preisliste-valide.csv"),
    generierungsDatum: "2026-11-24",
  });
  assert.equal(csvRes.ok, true);
  assert.equal(csvRes.eingabeTyp, "CSV");
  assert.equal(csvRes.artikelAnzahl, 3);
  assert.equal(csvRes.staffelpreiseAnzahl, 9);
  assert.equal(csvRes.normalisierteEinheiten, 2); // STK -> C62, M -> MTR
  assert.ok(csvRes.xml && csvRes.xml.includes("&amp;") && csvRes.xml.includes("&lt;DN25&gt;"));

  const roundtripVal = validateBmecatXml(csvRes.xml);
  assert.equal(roundtripVal.ok, true, `Roundtrip-Fehler: ${JSON.stringify(roundtripVal.befunde)}`);
  assert.equal(roundtripVal.fehlerAnzahl, 0);
  assert.equal(roundtripVal.warnungAnzahl, 0);
  assert.equal(roundtripVal.statistik.artikelAnzahl, 3);

  const jsonRes = convertCsvOrJsonToBmecat2005({
    inhalt: readUtf8("grosshandel-preisliste-valide.json"),
    generierungsDatum: "2026-11-24",
  });
  assert.equal(jsonRes.ok, true);
  assert.equal(jsonRes.eingabeTyp, "JSON");
  const jsonRoundtrip = validateBmecatXml(jsonRes.xml);
  assert.equal(jsonRoundtrip.ok, true);
  assert.equal(jsonRoundtrip.fehlerAnzahl, 0);
  assert.equal(jsonRoundtrip.warnungAnzahl, 0);
});

test("csv_to_bmecat_2005: erkennt Komma-CSV mit mehrzeiligen Staffeln und weist fehlerhafte CSVs ab", () => {
  const commaCsv = [
    "sku,kurztext,einheit,staffel_ab,preis,mwst",
    "ART-1,Flanschmutter M12,PCE,1,1.20,19",
    "ART-1,Flanschmutter M12,PCE,100,0.95,19",
  ].join("\n");
  const okRes = convertCsvOrJsonToBmecat2005({ inhalt: commaCsv });
  assert.equal(okRes.ok, true);
  assert.equal(okRes.artikelAnzahl, 1);
  assert.equal(okRes.staffelpreiseAnzahl, 2);
  assert.equal(validateBmecatXml(okRes.xml).ok, true);

  const badCsv = "sku;gtin;kurztext;preis\nART-BAD;4099990001012;Defekte EAN;-5.00\n";
  const badRes = convertCsvOrJsonToBmecat2005({ inhalt: badCsv });
  assert.equal(badRes.ok, false);
  assert.ok(badRes.befunde.some((b) => b.code === "CSV_PREIS_UNGUELTIG"));
});

test("validate_oci_cart: valide Form- und JSON-Warenkörbe bestehen mit exakten BigInt-Summen", () => {
  const formRes = validateOciCartPayload(readUtf8("oci-cart-valide-form.txt"));
  assert.equal(formRes.ok, true);
  assert.equal(formRes.fehlerAnzahl, 0);
  assert.equal(formRes.positionenAnzahl, 2);
  assert.equal(formRes.summenJeWaehrung.EUR?.cent, 49760);
  assert.equal(formRes.summenJeWaehrung.EUR?.iso, "497.60");

  const jsonRes = validateOciCartPayload(readUtf8("oci-cart-valide-json.json"));
  assert.equal(jsonRes.ok, true);
  assert.equal(jsonRes.fehlerAnzahl, 0);
  assert.equal(jsonRes.summenJeWaehrung.EUR?.cent, 109800);

  const htmlForm = `<form><input type="hidden" name="NEW_ITEM-DESCRIPTION[1]" value="Ventil DN15"/><input type="hidden" name="NEW_ITEM-QUANTITY[1]" value="3"/><input type="hidden" name="NEW_ITEM-UNIT[1]" value="PCE"/><input type="hidden" name="NEW_ITEM-PRICE[1]" value="19.50"/><input type="hidden" name="NEW_ITEM-CURRENCY[1]" value="EUR"/><input type="hidden" name="NEW_ITEM-MATGROUP[1]" value="2706"/></form>`;
  const htmlRes = validateOciCartPayload(htmlForm);
  assert.equal(htmlRes.ok, true);
  assert.equal(htmlRes.eingabeFormat, "HTML_FORM");
  assert.equal(htmlRes.summenJeWaehrung.EUR?.cent, 5850);
});

test("Positivkontrolle validate_oci_cart: weist STK statt PCE, Überlängen (> 40 / > 255 Z.), negative Preise/Mengen, Komma-Preise und Index 0 ab", () => {
  const badForm = validateOciCartPayload(readUtf8("oci-cart-defekt-form.txt"));
  assert.equal(badForm.ok, false);
  const formCodes = badForm.befunde.map((b) => b.code);
  assert.ok(formCodes.includes("OCI_EINHEIT_UNGUELTIG"));
  assert.ok(formCodes.includes("OCI_FELD_ZU_LANG"));
  assert.ok(formCodes.includes("OCI_MENGE_UNGUELTIG"));
  assert.ok(formCodes.includes("OCI_PREIS_NEGATIV"));
  // Sowohl DESCRIPTION > 40 als auch ATTACHMENT > 255 muessen gefunden werden
  assert.equal(badForm.befunde.filter((b) => b.code === "OCI_FELD_ZU_LANG").length, 2);

  const badJson = validateOciCartPayload(readUtf8("oci-cart-defekt-json.json"));
  assert.equal(badJson.ok, false);
  const jsonCodes = badJson.befunde.map((b) => b.code);
  assert.ok(jsonCodes.includes("OCI_FELD_ZU_LANG"));
  assert.ok(jsonCodes.includes("OCI_MENGE_NEGATIV"));
  assert.ok(jsonCodes.includes("OCI_EINHEIT_UNGUELTIG"));
  assert.ok(jsonCodes.includes("OCI_ZAHLENFORMAT_UNGUELTIG"));

  const zeroIdx = validateOciCartPayload("NEW_ITEM-DESCRIPTION[0]=Test&NEW_ITEM-QUANTITY[0]=1&NEW_ITEM-UNIT[0]=PCE&NEW_ITEM-PRICE[0]=1.00&NEW_ITEM-CURRENCY[0]=EUR");
  assert.equal(zeroIdx.ok, false);
  assert.ok(zeroIdx.befunde.some((b) => b.code === "OCI_INDEX_UNGUELTIG"));
});
