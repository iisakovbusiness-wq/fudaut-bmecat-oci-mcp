/**
 * Ende-zu-Ende-Tests für den MCP-Server über stdio (@modelcontextprotocol/client), das CLI-Werkzeug
 * (Exit-Codes 0/1/2 + --json + Stdin-Roundtrip), die Ordnergrenze (BMECAT_ORDNER inkl. Junction) und Repo-Hygiene.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const ROOT_DIR = fileURLToPath(new URL("../", import.meta.url));
const CLI_ENTRY = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));

let sandboxDir;
let outsideDir;
let mcpClient;
let stderrLog = "";

before(async () => {
  sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "bmecat-mcp-sandbox-"));
  outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "bmecat-mcp-outside-"));

  for (const name of fs.readdirSync(FIXTURES)) {
    fs.copyFileSync(path.join(FIXTURES, name), path.join(sandboxDir, name));
  }
  fs.copyFileSync(
    path.join(FIXTURES, "bmecat-2005-valide.xml"),
    path.join(outsideDir, "geheim-draussen.xml"),
  );
  // Junction aus dem freigegebenen Ordner heraus anlegen (Windows + POSIX)
  fs.symlinkSync(outsideDir, path.join(sandboxDir, "ausbruch-link"), "junction");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI_ENTRY],
    env: { ...process.env, BMECAT_ORDNER: sandboxDir },
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => {
    stderrLog += chunk.toString("utf8");
  });

  mcpClient = new Client({ name: "bmecat-e2e-client", version: "1.0.0" });
  await mcpClient.connect(transport);
});

after(async () => {
  await mcpClient?.close();
  fs.rmSync(path.join(sandboxDir, "ausbruch-link"), { force: true });
  fs.rmSync(sandboxDir, { recursive: true, force: true });
  fs.rmSync(outsideDir, { recursive: true, force: true });
});

test("MCP stdio: Server meldet sich korrekt und registriert alle 4 Werkzeuge mit Schema und readOnlyHint", async () => {
  assert.deepEqual(mcpClient.getServerVersion(), {
    name: "fudaut-bmecat-oci-mcp",
    version: "1.0.0",
  });

  const { tools } = await mcpClient.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    [
      "validate_bmecat",
      "bmecat_to_erp_json",
      "csv_to_bmecat_2005",
      "validate_oci_cart",
    ],
  );

  for (const t of tools) {
    assert.ok(t.description && t.description.length > 80, `${t.name}: Beschreibung zu kurz`);
    assert.equal(t.inputSchema.type, "object");
    assert.ok(t.outputSchema, `${t.name}: outputSchema fehlt`);
    assert.equal(t.annotations?.readOnlyHint, true, `${t.name}: readOnlyHint muss true sein`);
  }
});

test("MCP stdio: alle 4 Werkzeuge inklusive CSV->BMEcat->Validate-Roundtrip liefern exakte Ergebnisse", async () => {
  const valOk = await mcpClient.callTool({
    name: "validate_bmecat",
    arguments: { pfad: "bmecat-2005-valide.xml" },
  });
  assert.equal(valOk.isError ?? false, false);
  assert.equal(valOk.structuredContent.ok, true);
  assert.equal(valOk.structuredContent.statistik.artikelAnzahl, 3);

  const valBad = await mcpClient.callTool({
    name: "validate_bmecat",
    arguments: { pfad: "bmecat-defekt-ean-und-staffel.xml" },
  });
  assert.equal(valBad.isError ?? false, false);
  assert.equal(valBad.structuredContent.ok, false);
  assert.ok(valBad.structuredContent.fehlerAnzahl >= 5);

  const toErp = await mcpClient.callTool({
    name: "bmecat_to_erp_json",
    arguments: { pfad: "bmecat-12-valide.xml", zielSystem: "jtl-wawi", ausgabeFormat: "csv" },
  });
  assert.equal(toErp.isError ?? false, false);
  assert.equal(toErp.structuredContent.ok, true);
  assert.match(toErp.structuredContent.csvText, /SCH-DIN933-M10;4099990001032/);

  const fromCsv = await mcpClient.callTool({
    name: "csv_to_bmecat_2005",
    arguments: { pfad: "grosshandel-preisliste-valide.csv", generierungsDatum: "2026-11-24" },
  });
  assert.equal(fromCsv.isError ?? false, false);
  assert.equal(fromCsv.structuredContent.ok, true);

  const roundtrip = await mcpClient.callTool({
    name: "validate_bmecat",
    arguments: { xml: fromCsv.structuredContent.xml },
  });
  assert.equal(roundtrip.structuredContent.ok, true);
  assert.equal(roundtrip.structuredContent.fehlerAnzahl, 0);

  const ociOk = await mcpClient.callTool({
    name: "validate_oci_cart",
    arguments: { pfad: "oci-cart-valide-form.txt" },
  });
  assert.equal(ociOk.structuredContent.ok, true);
  assert.equal(ociOk.structuredContent.summenJeWaehrung.EUR.cent, 49760);

  const ociBad = await mcpClient.callTool({
    name: "validate_oci_cart",
    arguments: { pfad: "oci-cart-defekt-form.txt" },
  });
  assert.equal(ociBad.structuredContent.ok, false);
});

test("MCP Sicherheitsgrenze: blockiert Pfadausbruch (.., absoluter Fremdpfad und Junction nach draußen) auf allen 4 Werkzeugen", async () => {
  const verbotenePfade = [
    `../${path.basename(outsideDir)}/geheim-draussen.xml`,
    path.join(outsideDir, "geheim-draussen.xml"),
    "ausbruch-link/geheim-draussen.xml",
    ".",
  ];
  const toolNamen = [
    "validate_bmecat",
    "bmecat_to_erp_json",
    "csv_to_bmecat_2005",
    "validate_oci_cart",
  ];

  for (const pfad of verbotenePfade) {
    for (const name of toolNamen) {
      const res = await mcpClient.callTool({ name, arguments: { pfad } });
      assert.equal(res.isError, true, `${name} hätte Pfad "${pfad}" abweisen müssen`);
      assert.match(res.content[0].text, /nicht im freigegebenen Ordner/);
    }
  }
});

test("MCP Protokoll auf stderr: strukturierte JSON-Zeilen ohne Firmennamen, Artikeltexte oder Beträge", async () => {
  await new Promise((r) => setTimeout(r, 100));
  const lines = stderrLog.trim().split("\n");
  assert.match(lines[0], /^fudaut-bmecat-oci-mcp: bereit auf stdio/);
  const jsonLines = lines.slice(1).map((l) => JSON.parse(l));
  assert.ok(jsonLines.length >= 10);
  for (const entry of jsonLines) {
    assert.deepEqual(Object.keys(entry), ["zeit", "werkzeug", "quelle", "ergebnis"]);
  }
  assert.doesNotMatch(stderrLog, /Mustertechnik|Kugelhahn|497\.60|42\.50|IND-KG-2501/);
});

test("CLI-Modus: Exit-Code 0 bei validen Dateien & Roundtrip, Exit-Code 1 bei Defekten, Exit-Code 2 bei fehlender Datei", () => {
  const run = (args, input) =>
    spawnSync(process.execPath, [CLI_ENTRY, ...args], {
      cwd: ROOT_DIR,
      encoding: "utf8",
      input,
      windowsHide: true,
    });

  const ver = run(["--version"]);
  assert.equal(ver.status, 0);
  assert.equal(ver.stdout.trim(), "1.0.0");

  assert.equal(run(["validate-bmecat", "fixtures/bmecat-2005-valide.xml", "--json"]).status, 0);
  assert.equal(run(["validate-bmecat", "fixtures/bmecat-12-valide.xml"]).status, 0);
  assert.equal(run(["validate-bmecat", "fixtures/bmecat-defekt-doppelte-aid.xml"]).status, 1);
  assert.equal(run(["validate-bmecat", "fixtures/bmecat-defekt-ean-und-staffel.xml"]).status, 1);
  assert.equal(run(["validate-bmecat", "fixtures/bmecat-defekt-xxe.xml"]).status, 1);

  const erpOut = run(["to-erp", "fixtures/bmecat-2005-valide.xml", "--target", "shopware6"]);
  assert.equal(erpOut.status, 0);
  assert.equal(JSON.parse(erpOut.stdout).zielExport.length, 3);

  const csvOut = run(["from-csv", "fixtures/grosshandel-preisliste-valide.csv"]);
  assert.equal(csvOut.status, 0);
  assert.match(csvOut.stdout, /<BMECAT version="2005"/);

  // Stdin-Roundtrip über CLI
  const roundtripCli = run(["validate-bmecat", "-", "--json"], csvOut.stdout);
  assert.equal(roundtripCli.status, 0);
  assert.equal(JSON.parse(roundtripCli.stdout).ok, true);

  assert.equal(run(["validate-oci", "fixtures/oci-cart-valide-form.txt"]).status, 0);
  assert.equal(run(["validate-oci", "fixtures/oci-cart-valide-json.json"]).status, 0);
  assert.equal(run(["validate-oci", "fixtures/oci-cart-defekt-form.txt"]).status, 1);
  assert.equal(run(["validate-oci", "fixtures/oci-cart-defekt-json.json"]).status, 1);

  assert.equal(run(["validate-bmecat", "fixtures/gibt-es-nicht.xml"]).status, 2);
});

test("Metadaten-Konsistenz (package.json, server.json, glama.json, Dockerfile, LICENSE)", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"));
  const srv = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "server.json"), "utf8"));
  const glama = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "glama.json"), "utf8"));

  assert.equal(pkg.name, "fudaut-bmecat-oci-mcp");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.mcpName, srv.name);
  assert.equal(srv.version, pkg.version);
  assert.ok(srv.description.length <= 100, `server.json description zu lang (${srv.description.length} > 100)`);
  assert.deepEqual(glama.maintainers, ["iisakovbusiness-wq"]);
  assert.ok(fs.existsSync(path.join(ROOT_DIR, "Dockerfile")));
  assert.ok(fs.existsSync(path.join(ROOT_DIR, "LICENSE")));
});

test("Repo-Hygiene: 0 Gedankenstriche, 0 Emojis, 0 CRLF, 0 lokale Pfade/Secrets und 0 Sperrbegriffe", () => {
  const walk = (dir) => {
    const entries = [];
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.name === "node_modules" || item.name === ".git") continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) entries.push(...walk(full));
      else entries.push(full);
    }
    return entries;
  };

  const fromHex = (h) => Buffer.from(h, "hex").toString("utf8");
  const bannedPatterns = [
    new RegExp(fromHex("5c62283f3a696f6e6f737c73747261746f7c676d787c7765625c2e64657c6d61696c5c2e636f6d7c7365646f7c756e697465642d646f6d61696e737c766572736174656c295c62"), "i"),
    new RegExp(fromHex("756e697465645c732b696e7465726e6574"), "i"),
    new RegExp(fromHex("312631")),
    new RegExp(fromHex("23283f3a3132327c363536295c62")),
    new RegExp(`\\b(?:${fromHex("313230")}|${fromHex("313130")})\\s*(?:€|EUR|Euro)\\b`, "i"),
    new RegExp(`#(?:${fromHex("643937373537")}|${fromHex("643935303261")}|${fromHex("653035333262")})\\b`, "i"),
    new RegExp(fromHex("717569726d62616368"), "i"),
    new RegExp(fromHex("61757362696c64756e67"), "i"),
    new RegExp(fromHex("6172626569746765626572"), "i"),
    new RegExp(fromHex("283f3a433a5c5c55736572737c463a5c5c435553544f4d7c6672657a7a657c6768705f5b412d5a612d7a302d395d2b7c6769746875625f7061745f5b412d5a612d7a302d395f5d2b7c424547494e205253412050524956415445204b455929"), "i"),
  ];
  assert.match(fromHex("696f6e6f73"), bannedPatterns[0]);
  assert.match(fromHex("31323020455552"), bannedPatterns[4]);

  const allFiles = walk(ROOT_DIR);
  assert.ok(allFiles.length >= 25, "Zu wenige Projektdateien gefunden");

  for (const fp of allFiles) {
    const rel = path.relative(ROOT_DIR, fp).replaceAll("\\", "/");
    const raw = fs.readFileSync(fp);
    const text = raw.toString("utf8");

    for (const rx of bannedPatterns) {
      assert.doesNotMatch(text, rx, `Verbotenes Muster ${rx} in ${rel}`);
    }

    assert.equal(raw.includes(0x0d), false, `CRLF gefunden in ${rel}`);
    assert.doesNotMatch(text, /[\u2013\u2014]/, `Gedankenstrich gefunden in ${rel}`);
    assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, `Emoji/Piktogramm gefunden in ${rel}`);
  }
});
