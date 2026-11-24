#!/usr/bin/env node
/**
 * cli.ts: Kommandozeilen-Werkzeug UND stdio-MCP-Starter für fudaut-bmecat-oci-mcp.
 * - Ohne Argumente (oder mit "serve" / "mcp"): startet den MCP-Server auf stdio (kompatibel mit npx).
 * - Mit Unterbefehl (validate-bmecat, to-erp, from-csv, validate-oci): arbeitet lokal und setzt Exit-Code 0/1/2.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convertBmecatToErp } from "./bmecatToErp.js";
import { convertCsvOrJsonToBmecat2005 } from "./csvToBmecat.js";
import { validateBmecatXml } from "./validateBmecat.js";
import { validateOciCartPayload } from "./validateOci.js";
import { SERVER_NAME, SERVER_VERSION, formatiereBmecatBericht, formatiereFromCsvBericht, formatiereOciBericht, startStdioServer, } from "./server.js";
const HILFE = `${SERVER_NAME} v${SERVER_VERSION}
Lokaler MCP-Server (stdio) und CLI für BMEcat 1.2/2005, ERP-Konvertierung (JTL-Wawi, weclapp, Shopware 6, Sage 100, SelectLine) und SAP OCI 4.0/5.0 PunchOut.

Verwendung:
  fudaut-bmecat-oci-mcp                              Startet den MCP-Server über stdio
  fudaut-bmecat-oci-mcp serve                        Startet den MCP-Server über stdio
  fudaut-bmecat-oci-mcp validate-bmecat <datei|-> [--json]
  fudaut-bmecat-oci-mcp to-erp <datei|-> [--target <generic|jtl-wawi|weclapp|shopware6|sage100|selectline>] [--format <json|csv>] [--out <datei>] [--json]
  fudaut-bmecat-oci-mcp from-csv <datei|-> [--katalog-id <id>] [--lieferant <name>] [--waehrung <iso>] [--datum <YYYY-MM-DD>] [--stueck <C62|PCE>] [--out <datei>] [--json]
  fudaut-bmecat-oci-mcp validate-oci <datei|-> [--json]
  fudaut-bmecat-oci-mcp --version | --help

Exit-Codes im CLI-Modus:
  0  Prüfung / Konvertierung erfolgreich ohne Fehler
  1  Fachlicher oder struktureller Befund (ok = false)
  2  Aufruf- oder Dateifehler
`;
const OPTIONS_WITH_VALUE = new Set([
    "--target",
    "--format",
    "--out",
    "--katalog-id",
    "--katalog-name",
    "--lieferant",
    "--lieferant-id",
    "--waehrung",
    "--datum",
    "--sprache",
    "--stueck",
]);
function leseOption(args, flag) {
    const idx = args.indexOf(flag);
    if (idx >= 0 && idx + 1 < args.length)
        return args[idx + 1];
    return undefined;
}
function leseEingabeText(dateiArg) {
    if (dateiArg === "-") {
        return fs.readFileSync(0, "utf8");
    }
    const vollPfad = path.resolve(process.cwd(), dateiArg);
    if (!fs.existsSync(vollPfad) || !fs.statSync(vollPfad).isFile()) {
        throw new Error(`Datei "${dateiArg}" nicht gefunden.`);
    }
    return fs.readFileSync(vollPfad, "utf8");
}
export function runCli(argv) {
    if (argv.length === 0 || argv[0] === "serve" || argv[0] === "mcp") {
        startStdioServer();
        return 0;
    }
    const cmd = argv[0];
    if (cmd === "--help" || cmd === "-h" || cmd === "help") {
        process.stdout.write(HILFE);
        return 0;
    }
    if (cmd === "--version" || cmd === "-v") {
        process.stdout.write(`${SERVER_VERSION}\n`);
        return 0;
    }
    const alsJson = argv.includes("--json");
    const posArgs = argv.slice(1).filter((a, idx, arr) => {
        if (a !== "-" && a.startsWith("-"))
            return false;
        const prev = idx > 0 ? arr[idx - 1] : "";
        if (prev && OPTIONS_WITH_VALUE.has(prev))
            return false;
        return true;
    });
    const dateiArg = posArgs[0];
    if (!dateiArg) {
        process.stderr.write(`Fehler: Dateipfad (oder "-" für stdin) fehlt für "${cmd}". Hilfe mit --help.\n`);
        return 2;
    }
    let inputText;
    try {
        inputText = leseEingabeText(dateiArg);
    }
    catch (err) {
        process.stderr.write(`Fehler: ${err.message}\n`);
        return 2;
    }
    try {
        if (cmd === "validate-bmecat" || cmd === "validate_bmecat") {
            const res = validateBmecatXml(inputText);
            process.stdout.write(alsJson ? `${JSON.stringify(res, null, 2)}\n` : `${formatiereBmecatBericht(res)}\n`);
            return res.ok ? 0 : 1;
        }
        if (cmd === "to-erp" || cmd === "bmecat_to_erp_json") {
            const target = (leseOption(argv, "--target") ?? "generic");
            const validTargets = new Set(["generic", "jtl-wawi", "weclapp", "shopware6", "sage100", "selectline"]);
            if (!validTargets.has(target)) {
                process.stderr.write(`Fehler: Unbekanntes Zielsystem "${target}".\n`);
                return 2;
            }
            const format = (leseOption(argv, "--format") ?? "json");
            if (format !== "json" && format !== "csv") {
                process.stderr.write(`Fehler: Unbekanntes Ausgabeformat "${format}" (erlaubt: json, csv).\n`);
                return 2;
            }
            const res = convertBmecatToErp(inputText, target, format);
            if (!res.ok) {
                process.stdout.write(alsJson ? `${JSON.stringify(res, null, 2)}\n` : `Fehler: ${res.fehlerMeldung}\n`);
                return 1;
            }
            const payloadOut = alsJson
                ? `${JSON.stringify(res, null, 2)}\n`
                : format === "csv"
                    ? (res.csvText ?? "")
                    : `${JSON.stringify({ katalog: res.katalog, zielSystem: res.zielSystem, artikelAnzahl: res.artikelAnzahl, zielExport: res.zielExport, artikel: res.artikel }, null, 2)}\n`;
            const outPath = leseOption(argv, "--out");
            if (outPath) {
                fs.writeFileSync(path.resolve(process.cwd(), outPath), payloadOut, "utf8");
            }
            else {
                process.stdout.write(payloadOut);
            }
            return 0;
        }
        if (cmd === "from-csv" || cmd === "csv_to_bmecat_2005") {
            const stueckOpt = leseOption(argv, "--stueck");
            const res = convertCsvOrJsonToBmecat2005({
                inhalt: inputText,
                katalogId: leseOption(argv, "--katalog-id"),
                katalogName: leseOption(argv, "--katalog-name"),
                lieferantName: leseOption(argv, "--lieferant"),
                lieferantId: leseOption(argv, "--lieferant-id"),
                waehrung: leseOption(argv, "--waehrung"),
                generierungsDatum: leseOption(argv, "--datum"),
                sprache: leseOption(argv, "--sprache"),
                stueckEinheit: stueckOpt === "PCE" ? "PCE" : "C62",
            });
            if (!res.ok || res.xml === null) {
                process.stdout.write(alsJson ? `${JSON.stringify(res, null, 2)}\n` : `${formatiereFromCsvBericht(res)}\n`);
                return 1;
            }
            const outPath = leseOption(argv, "--out");
            if (outPath) {
                fs.writeFileSync(path.resolve(process.cwd(), outPath), res.xml, "utf8");
            }
            if (alsJson) {
                process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
            }
            else if (!outPath) {
                process.stdout.write(res.xml);
            }
            else {
                process.stdout.write(`Status: OK (${res.artikelAnzahl} Artikel nach ${outPath} geschrieben)\n`);
            }
            return 0;
        }
        if (cmd === "validate-oci" || cmd === "validate_oci_cart") {
            const res = validateOciCartPayload(inputText);
            process.stdout.write(alsJson ? `${JSON.stringify(res, null, 2)}\n` : `${formatiereOciBericht(res)}\n`);
            return res.ok ? 0 : 1;
        }
        process.stderr.write(`Fehler: Unbekannter Befehl "${cmd}". Hilfe mit --help.\n`);
        return 2;
    }
    catch (err) {
        process.stderr.write(`Fehler: ${err.message}\n`);
        return 2;
    }
}
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(thisFile)) {
    const code = runCli(process.argv.slice(2));
    if (process.argv.slice(2).length > 0 && process.argv[2] !== "serve" && process.argv[2] !== "mcp") {
        process.exitCode = code;
    }
}
