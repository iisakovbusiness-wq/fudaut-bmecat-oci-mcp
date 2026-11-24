#!/usr/bin/env node
/**
 * cli.ts: Kommandozeilen-Werkzeug UND stdio-MCP-Starter für fudaut-bmecat-oci-mcp.
 * - Ohne Argumente (oder mit "serve" / "mcp"): startet den MCP-Server auf stdio (kompatibel mit npx).
 * - Mit Unterbefehl (validate-bmecat, to-erp, from-csv, validate-oci): arbeitet lokal und setzt Exit-Code 0/1/2.
 */
export declare function runCli(argv: string[]): number;
