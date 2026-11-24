#!/usr/bin/env node
/**
 * server.ts: Lokaler stdio-MCP-Server für BMEcat 1.2/2005, ERP-Konvertierung, CSV-zu-BMEcat-2005 und SAP OCI 4.0/5.0.
 *
 * Sicherheitsgrenzen im Serverprozess:
 *   1. Strikte Ordnergrenze (BMECAT_ORDNER, Standard: Arbeitsverzeichnis). Alle Dateipfade werden samt realpathSync
 *      gegen diesen Wurzelordner geprüft; "..", Pfade außerhalb sowie Symlinks/Junctions nach draußen
 *      werden abgewiesen. Dateien über 20 MB werden nicht gelesen.
 *   2. Rein lesender Betrieb (readOnlyHint: true auf allen vier Werkzeugen, 0 Schreibzugriffe, 0 Netzwerkaufrufe).
 *   3. Datensparsames Protokoll auf stderr (Zeitpunkt, Werkzeug, Quelle, Kurzstatus; niemals Firmennamen, Texte oder Beträge).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { convertBmecatToErp } from "./bmecatToErp.js";
import { convertCsvOrJsonToBmecat2005 } from "./csvToBmecat.js";
import { validateBmecatXml } from "./validateBmecat.js";
import { validateOciCartPayload } from "./validateOci.js";
export const SERVER_NAME = "fudaut-bmecat-oci-mcp";
export const SERVER_VERSION = "1.0.0";
const MAX_FILE_SIZE = 20 * 1024 * 1024;
function schreibeProtokoll(werkzeug, quelle, ergebnis) {
    console.error(JSON.stringify({
        zeit: new Date().toISOString(),
        werkzeug,
        quelle,
        ergebnis,
    }));
}
/** Löst einen relativen Pfad sicher innerhalb von basisReal auf; weist Ausbrüche und Symlinks/Junctions nach draußen ab. */
export function sichereDateiImOrdner(basisReal, pfadEingabe) {
    const voll = path.resolve(basisReal, String(pfadEingabe));
    const pruefeDrinnen = (zielPfad) => {
        const rel = path.relative(basisReal, zielPfad);
        if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
            throw new Error(`Der Pfad "${pfadEingabe}" liegt nicht im freigegebenen Ordner.`);
        }
    };
    pruefeDrinnen(voll);
    if (!fs.existsSync(voll)) {
        throw new Error(`Die Datei "${pfadEingabe}" existiert im freigegebenen Ordner nicht.`);
    }
    const echt = fs.realpathSync(voll);
    pruefeDrinnen(echt);
    const stat = fs.statSync(echt);
    if (!stat.isFile()) {
        throw new Error(`"${pfadEingabe}" ist keine reguläre Datei.`);
    }
    if (stat.size > MAX_FILE_SIZE) {
        throw new Error(`"${pfadEingabe}" ist größer als 20 MB und wird nicht geladen.`);
    }
    return {
        vollPfad: echt,
        relativ: path.relative(basisReal, echt).replaceAll("\\", "/"),
        bytes: fs.readFileSync(echt),
    };
}
export function formatiereBmecatBericht(r) {
    const kopf = [
        `Status: ${r.ok ? "BESTANDEN (0 Fehler)" : `NICHT BESTANDEN (${r.fehlerAnzahl} Fehler, ${r.warnungAnzahl} Warnungen)`}`,
        `BMEcat: Version ${r.bmecatVersion ?? "?"}, Transaktion ${r.transaktion ?? "?"}, Währung: ${r.katalog.waehrung ?? "?"}`,
        `Statistik: ${r.statistik.artikelAnzahl} Artikel, ${r.statistik.preiseAnzahl} Preise, ${r.statistik.gtinGeprueft} GTINs geprüft, ETIM=${r.statistik.klassifiziertEtim}, eCl@ss=${r.statistik.klassifiziertEclass}`,
    ];
    if (r.befunde.length > 0) {
        kopf.push(...r.befunde.map((b) => `[${b.stufe.toUpperCase()}] ${b.code} (${b.feld}, Zeile ${b.zeile}): ${b.meldung}`));
    }
    return kopf.join("\n");
}
export function formatiereToErpBericht(r) {
    if (!r.ok) {
        return `Status: FEHLER\nMeldung: ${r.fehlerMeldung ?? "Konvertierung fehlgeschlagen."}`;
    }
    const header = `Status: OK (${r.artikelAnzahl} Artikel, ${r.staffelpreiseAnzahl} Staffelpreise, Ziel: ${r.zielSystem}, Format: ${r.ausgabeFormat})`;
    if (r.ausgabeFormat === "csv" && r.csvText !== null) {
        return `${header}\n\n${r.csvText}`;
    }
    return `${header}\n\n${JSON.stringify(r.zielExport, null, 2)}`;
}
export function formatiereFromCsvBericht(r) {
    if (!r.ok || r.xml === null) {
        const lines = [`Status: NICHT BESTANDEN (${r.fehlerAnzahl} Fehler)`];
        for (const b of r.befunde) {
            lines.push(`[FEHLER] ${b.code} (${b.feld}, Zeile ${b.zeile}): ${b.meldung}`);
        }
        return lines.join("\n");
    }
    return `Status: OK (${r.artikelAnzahl} Artikel, ${r.staffelpreiseAnzahl} Staffelpreise, ${r.normalisierteEinheiten} Einheiten normalisiert)\n\n${r.xml}`;
}
export function formatiereOciBericht(r) {
    const summen = Object.entries(r.summenJeWaehrung)
        .map(([w, s]) => `${s.iso} ${w}`)
        .join(", ");
    const kopf = [
        `Status: ${r.ok ? "BESTANDEN (0 Fehler)" : `NICHT BESTANDEN (${r.fehlerAnzahl} Fehler, ${r.warnungAnzahl} Warnungen)`}`,
        `SAP OCI (${r.eingabeFormat}): ${r.positionenAnzahl} Positionen, Gesamtsumme: ${summen || "0.00"}`,
    ];
    if (r.befunde.length > 0) {
        kopf.push(...r.befunde.map((b) => `[${b.stufe.toUpperCase()}] ${b.code} (${b.feld}${b.index !== null ? `, Pos ${b.index}` : ""}): ${b.meldung}`));
    }
    return kopf.join("\n");
}
const STUFE_ENUM = z.enum(["fehler", "warnung", "hinweis"]);
const TARGET_ENUM = z.enum(["generic", "jtl-wawi", "weclapp", "shopware6", "sage100", "selectline"]);
const FORMAT_ENUM = z.enum(["json", "csv"]);
export function createBmecatOciMcpServer(customRootDir) {
    const basisReal = fs.realpathSync(path.resolve(customRootDir ?? process.env.BMECAT_ORDNER ?? process.cwd()));
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
    // Werkzeug 1: validate_bmecat
    server.registerTool("validate_bmecat", {
        title: "BMEcat 1.2 / 2005 XML-Katalog prüfen",
        description: "Validiert BMEcat 1.2 und BMEcat 2005 XML-Kataloge deterministisch: Struktur HEADER/CATALOG/SUPPLIER/T_NEW_CATALOG, eindeutige SUPPLIER_AID/SUPPLIER_PID, GS1 Modulo-10 GTIN/EAN-8/12/13/14 Prüfziffern, Pflichtfelder DESCRIPTION_SHORT/ORDER_UNIT/PRICE_DETAILS, UN/ECE-Mengeneinheiten, konsistente CURRENCY/TAX/LOWER_BOUND-Staffeln in BigInt-Festkomma-Arithmetik, ETIM/eCl@ss-Klassifikation und XXE-<!ENTITY-Sperre.",
        inputSchema: z.object({
            pfad: z.string().min(1).optional().describe("Relativer Pfad zur BMEcat-XML-Datei innerhalb von BMECAT_ORDNER"),
            xml: z.string().min(1).optional().describe("Direkter BMEcat-XML-Text, falls keine Datei über pfad gelesen wird"),
        }),
        outputSchema: z.object({
            ok: z.boolean(),
            bmecatVersion: z.string().nullable(),
            transaktion: z.string().nullable(),
            katalog: z.object({
                id: z.string().nullable(),
                name: z.string().nullable(),
                version: z.string().nullable(),
                sprache: z.string().nullable(),
                waehrung: z.string().nullable(),
                lieferant: z.string().nullable(),
                generierungsDatum: z.string().nullable(),
            }),
            statistik: z.object({
                artikelAnzahl: z.number(),
                preiseAnzahl: z.number(),
                gtinGeprueft: z.number(),
                klassifiziertEtim: z.number(),
                klassifiziertEclass: z.number(),
                waehrungen: z.array(z.string()),
            }),
            fehlerAnzahl: z.number(),
            warnungAnzahl: z.number(),
            befunde: z.array(z.object({
                stufe: STUFE_ENUM,
                code: z.string(),
                artikelId: z.string().nullable(),
                feld: z.string(),
                zeile: z.number(),
                meldung: z.string(),
            })),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ pfad, xml }) => {
        const quelleLabel = pfad ? pfad : "inline-xml";
        try {
            if (!pfad && !xml) {
                throw new Error("Bitte entweder 'pfad' (Datei im freigegebenen Ordner) oder 'xml' angeben.");
            }
            let xmlText = xml ?? "";
            let logQuelle = "inline-xml";
            if (pfad) {
                const datei = sichereDateiImOrdner(basisReal, pfad);
                logQuelle = datei.relativ;
                xmlText = datei.bytes.toString("utf8");
            }
            const result = validateBmecatXml(xmlText);
            schreibeProtokoll("validate_bmecat", logQuelle, result.ok ? `ok (${result.statistik.artikelAnzahl} Artikel)` : `${result.fehlerAnzahl} Fehler, ${result.warnungAnzahl} Warnungen`);
            return {
                content: [{ type: "text", text: formatiereBmecatBericht(result) }],
                structuredContent: result,
            };
        }
        catch (err) {
            schreibeProtokoll("validate_bmecat", quelleLabel, "Aufruffehler");
            return {
                content: [{ type: "text", text: `Fehler: ${err.message}` }],
                isError: true,
            };
        }
    });
    // Werkzeug 2: bmecat_to_erp_json
    server.registerTool("bmecat_to_erp_json", {
        title: "BMEcat 1.2 / 2005 nach ERP-JSON oder CSV konvertieren",
        description: "Konvertiert BMEcat 1.2 oder 2005 XML-Kataloge in direkt importierbares ERP-/Shop-JSON oder CSV (generic, JTL-Wawi, weclapp, Shopware 6, Sage 100, SelectLine) inklusive Artikelnummer, GTIN, Kurz-/Langtext, UN/ECE-Einheit, exakter BigInt-Staffelpreise, MwSt.-Satz und ETIM/eCl@ss-Klassifikation.",
        inputSchema: z.object({
            pfad: z.string().min(1).optional().describe("Relativer Pfad zur BMEcat-XML-Datei innerhalb von BMECAT_ORDNER"),
            xml: z.string().min(1).optional().describe("Direkter BMEcat-XML-Text"),
            zielSystem: TARGET_ENUM.optional().describe("Zielsystem für das ERP-Mapping (Standard: generic)"),
            ausgabeFormat: FORMAT_ENUM.optional().describe("Ausgabeformat: json (Standard) oder csv"),
        }),
        outputSchema: z.object({
            ok: z.boolean(),
            zielSystem: TARGET_ENUM,
            ausgabeFormat: FORMAT_ENUM,
            bmecatVersion: z.string().nullable(),
            katalog: z.object({
                id: z.string().nullable(),
                name: z.string().nullable(),
                sprache: z.string().nullable(),
                waehrung: z.string(),
                lieferant: z.string().nullable(),
            }),
            artikelAnzahl: z.number(),
            staffelpreiseAnzahl: z.number(),
            artikel: z.array(z.record(z.string(), z.unknown())),
            zielExport: z.array(z.record(z.string(), z.unknown())),
            csvText: z.string().nullable(),
            fehlerMeldung: z.string().nullable(),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ pfad, xml, zielSystem, ausgabeFormat }) => {
        const quelleLabel = pfad ? pfad : "inline-xml";
        try {
            if (!pfad && !xml) {
                throw new Error("Bitte entweder 'pfad' oder 'xml' angeben.");
            }
            let xmlText = xml ?? "";
            let logQuelle = "inline-xml";
            if (pfad) {
                const datei = sichereDateiImOrdner(basisReal, pfad);
                logQuelle = datei.relativ;
                xmlText = datei.bytes.toString("utf8");
            }
            const ziel = zielSystem ?? "generic";
            const format = ausgabeFormat ?? "json";
            const result = convertBmecatToErp(xmlText, ziel, format);
            schreibeProtokoll("bmecat_to_erp_json", logQuelle, result.ok ? `ok (${result.artikelAnzahl} Artikel -> ${ziel}/${format})` : "Fehler");
            return {
                content: [{ type: "text", text: formatiereToErpBericht(result) }],
                structuredContent: result,
            };
        }
        catch (err) {
            schreibeProtokoll("bmecat_to_erp_json", quelleLabel, "Aufruffehler");
            return {
                content: [{ type: "text", text: `Fehler: ${err.message}` }],
                isError: true,
            };
        }
    });
    // Werkzeug 3: csv_to_bmecat_2005
    server.registerTool("csv_to_bmecat_2005", {
        title: "Großhandels-CSV/JSON in BMEcat 2005 XML konvertieren",
        description: "Erzeugt aus einer Großhandels-Preisliste (CSV mit Semikolon oder Komma, oder JSON) ein sauberes, XML-escaped BMEcat-2005-T_NEW_CATALOG-XML inklusive HEADER, SUPPLIER, PRODUCT-Blöcken, UN/ECE-Einheitennormalisierung, GS1-GTIN-Prüfung und BigInt-Staffelpreisen.",
        inputSchema: z.object({
            pfad: z.string().min(1).optional().describe("Relativer Pfad zur CSV- oder JSON-Preisliste innerhalb von BMECAT_ORDNER"),
            inhalt: z.string().min(1).optional().describe("Direkter CSV- oder JSON-Inhalt"),
            katalogId: z.string().optional().describe("Optionale Katalog-ID (Standard: KAT-2005-01)"),
            katalogName: z.string().optional().describe("Optionaler Katalogname"),
            katalogVersion: z.string().optional().describe("Optionale Katalogversion (Standard: 1.0)"),
            sprache: z.string().optional().describe("Sprachcode nach ISO 639-2 (Standard: deu)"),
            waehrung: z.string().optional().describe("Währung nach ISO 4217 (Standard: EUR)"),
            lieferantName: z.string().optional().describe("Name des Lieferanten im HEADER/SUPPLIER"),
            lieferantId: z.string().optional().describe("Lieferanten-ID im HEADER/SUPPLIER"),
            generierungsDatum: z.string().optional().describe("Optionales ISO-Datum YYYY-MM-DD für DATETIME"),
            stueckEinheit: z.enum(["C62", "PCE"]).optional().describe("Ziel-UN/ECE-Code für Stück/STK (Standard: C62)"),
        }),
        outputSchema: z.object({
            ok: z.boolean(),
            eingabeTyp: z.enum(["CSV", "JSON"]),
            artikelAnzahl: z.number(),
            staffelpreiseAnzahl: z.number(),
            normalisierteEinheiten: z.number(),
            waehrung: z.string(),
            xml: z.string().nullable(),
            fehlerAnzahl: z.number(),
            befunde: z.array(z.object({
                zeile: z.number(),
                feld: z.string(),
                code: z.string(),
                meldung: z.string(),
            })),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ pfad, inhalt, katalogId, katalogName, katalogVersion, sprache, waehrung, lieferantName, lieferantId, generierungsDatum, stueckEinheit, }) => {
        const quelleLabel = pfad ? pfad : "inline-csv-json";
        try {
            if (!pfad && !inhalt) {
                throw new Error("Bitte entweder 'pfad' oder 'inhalt' angeben.");
            }
            let text = inhalt ?? "";
            let logQuelle = "inline-csv-json";
            if (pfad) {
                const datei = sichereDateiImOrdner(basisReal, pfad);
                logQuelle = datei.relativ;
                text = datei.bytes.toString("utf8");
            }
            const result = convertCsvOrJsonToBmecat2005({
                inhalt: text,
                katalogId,
                katalogName,
                katalogVersion,
                sprache,
                waehrung,
                lieferantName,
                lieferantId,
                generierungsDatum,
                stueckEinheit,
            });
            schreibeProtokoll("csv_to_bmecat_2005", logQuelle, result.ok ? `ok (${result.artikelAnzahl} Artikel)` : `${result.fehlerAnzahl} Fehler`);
            return {
                content: [{ type: "text", text: formatiereFromCsvBericht(result) }],
                structuredContent: result,
            };
        }
        catch (err) {
            schreibeProtokoll("csv_to_bmecat_2005", quelleLabel, "Aufruffehler");
            return {
                content: [{ type: "text", text: `Fehler: ${err.message}` }],
                isError: true,
            };
        }
    });
    // Werkzeug 4: validate_oci_cart
    server.registerTool("validate_oci_cart", {
        title: "SAP OCI 4.0 / 5.0 PunchOut-Warenkorb prüfen",
        description: "Validiert SAP OCI 4.0 / 5.0 PunchOut-Warenkorb-Payloads (JSON, application/x-www-form-urlencoded oder HTML-Formular): 1-basierte NEW_ITEM-Indizierung, Pflichtfelder DESCRIPTION/QUANTITY/UNIT/PRICE/PRICEUNIT/CURRENCY, UN/ECE-Einheitenprüfung (PCE/C62/MTR/KGM/LTR/SET statt STK), Feldlängen-Grenzen (<= 40 / <= 255 Zeichen), negative Mengen/Preise und BigInt-Gesamtsummen.",
        inputSchema: z.object({
            pfad: z.string().min(1).optional().describe("Relativer Pfad zur OCI-Payload-Datei innerhalb von BMECAT_ORDNER"),
            payload: z.string().min(1).optional().describe("Direktes SAP-OCI-Payload (JSON, Form-Encoded oder HTML-Form)"),
        }),
        outputSchema: z.object({
            ok: z.boolean(),
            eingabeFormat: z.enum(["JSON", "FORM_URLENCODED", "HTML_FORM"]),
            positionenAnzahl: z.number(),
            summenJeWaehrung: z.record(z.string(), z.object({ cent: z.number(), iso: z.string() })),
            positionen: z.array(z.object({
                index: z.number(),
                description: z.string().nullable(),
                quantity: z.string().nullable(),
                unit: z.string().nullable(),
                price: z.string().nullable(),
                priceunit: z.string(),
                currency: z.string().nullable(),
                matgroup: z.string().nullable(),
                matnr: z.string().nullable(),
                vendormat: z.string().nullable(),
                lineTotalIso: z.string().nullable(),
                lineTotalCent: z.number().nullable(),
            })),
            fehlerAnzahl: z.number(),
            warnungAnzahl: z.number(),
            befunde: z.array(z.object({
                stufe: z.enum(["fehler", "warnung"]),
                index: z.number().nullable(),
                feld: z.string(),
                code: z.string(),
                meldung: z.string(),
            })),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ pfad, payload }) => {
        const quelleLabel = pfad ? pfad : "inline-oci";
        try {
            if (!pfad && !payload) {
                throw new Error("Bitte entweder 'pfad' oder 'payload' angeben.");
            }
            let text = payload ?? "";
            let logQuelle = "inline-oci";
            if (pfad) {
                const datei = sichereDateiImOrdner(basisReal, pfad);
                logQuelle = datei.relativ;
                text = datei.bytes.toString("utf8");
            }
            const result = validateOciCartPayload(text);
            schreibeProtokoll("validate_oci_cart", logQuelle, result.ok ? `ok (${result.positionenAnzahl} Positionen)` : `${result.fehlerAnzahl} Fehler, ${result.warnungAnzahl} Warnungen`);
            return {
                content: [{ type: "text", text: formatiereOciBericht(result) }],
                structuredContent: result,
            };
        }
        catch (err) {
            schreibeProtokoll("validate_oci_cart", quelleLabel, "Aufruffehler");
            return {
                content: [{ type: "text", text: `Fehler: ${err.message}` }],
                isError: true,
            };
        }
    });
    return server;
}
export function startStdioServer(customRootDir) {
    const basisReal = fs.realpathSync(path.resolve(customRootDir ?? process.env.BMECAT_ORDNER ?? process.cwd()));
    const handle = serveStdio(() => createBmecatOciMcpServer(basisReal));
    console.error(`${SERVER_NAME}: bereit auf stdio, Ordner ${basisReal}, Modus lesend`);
    process.on("SIGINT", () => {
        void handle.close();
    });
}
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(thisFile)) {
    startStdioServer();
}
