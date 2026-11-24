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
import { McpServer } from "@modelcontextprotocol/server";
import { BmecatToErpResult } from "./bmecatToErp.js";
import { CsvToBmecatResult } from "./csvToBmecat.js";
import { BmecatValidationResult } from "./validateBmecat.js";
import { OciValidationResult } from "./validateOci.js";
export declare const SERVER_NAME = "fudaut-bmecat-oci-mcp";
export declare const SERVER_VERSION = "1.0.0";
/** Löst einen relativen Pfad sicher innerhalb von basisReal auf; weist Ausbrüche und Symlinks/Junctions nach draußen ab. */
export declare function sichereDateiImOrdner(basisReal: string, pfadEingabe: string): {
    vollPfad: string;
    relativ: string;
    bytes: Buffer;
};
export declare function formatiereBmecatBericht(r: BmecatValidationResult): string;
export declare function formatiereToErpBericht(r: BmecatToErpResult): string;
export declare function formatiereFromCsvBericht(r: CsvToBmecatResult): string;
export declare function formatiereOciBericht(r: OciValidationResult): string;
export declare function createBmecatOciMcpServer(customRootDir?: string): McpServer;
export declare function startStdioServer(customRootDir?: string): void;
