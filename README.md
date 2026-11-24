# fudaut-bmecat-oci-mcp

**MIT-licensed Model Context Protocol (MCP) server and CLI for non-SAP technical wholesale and B2B procurement: BMEcat 1.2 & 2005 validation (GS1 GTIN/EAN-8/13, BigInt tier pricing, ETIM/eCl@ss, XXE protection), BMEcat to JTL-Wawi / weclapp / Shopware 6 / Sage 100 / SelectLine ERP JSON & CSV conversion, wholesale CSV/JSON to BMEcat 2005 `T_NEW_CATALOG` generation, and SAP OCI 4.0 / 5.0 PunchOut cart validation.**

[English](#english) | [Deutsch](#deutsch)

[![Glama MCP Server](https://glama.ai/mcp/servers/iisakovbusiness-wq/fudaut-bmecat-oci-mcp/badges/score.svg)](https://glama.ai/mcp/servers/iisakovbusiness-wq/fudaut-bmecat-oci-mcp)

---

## English

`fudaut-bmecat-oci-mcp` equips MCP-compatible AI assistants (Claude Desktop, Claude Code, Cursor, Windsurf, custom hosts) and CI pipelines with four deterministic local tools for technical wholesale catalog and PunchOut workflows (BMEcat 1.2, BMEcat 2005, SAP OCI 4.0/5.0, JTL-Wawi, weclapp, Shopware 6, Sage 100, SelectLine).

It runs 100 % locally over `stdio` or as a CLI binary, makes zero external network calls, uses exact `BigInt` fixed-point decimal arithmetic (`10^8` scale, zero IEEE-754 float drift), blocks XML External Entity (`<!ENTITY` / XXE) attacks, and enforces strict single-folder path isolation (`BMECAT_ORDNER`). Both users and maintainer Ilia Isakov (Fudaut) pay `0 EUR` in license or external API fees.

### Four MCP Tools & CLI Subcommands

| MCP Tool | CLI Subcommand | What It Checks / Produces | Modifies Disk (MCP) |
|---|---|---|---|
| `validate_bmecat` | `validate-bmecat` | Validates BMEcat 1.2 & 2005 XML catalogs: `HEADER`/`CATALOG`/`SUPPLIER`/`T_NEW_CATALOG` structure, unique `SUPPLIER_AID`/`SUPPLIER_PID`, GS1 Modulo-10 GTIN/EAN-8/12/13/14 check digits, mandatory `DESCRIPTION_SHORT`/`ORDER_UNIT`/`PRICE_DETAILS`, UN/ECE Rec 20 units, consistent `CURRENCY`/`TAX`/`LOWER_BOUND` tiers via `BigInt` arithmetic, `ETIM`/`eCl@ss`/`UNSPSC` classification syntax, and XXE `<!ENTITY` blocking | No (`readOnlyHint: true`) |
| `bmecat_to_erp_json` | `to-erp` | Converts BMEcat 1.2/2005 XML into import-ready ERP/shop JSON or `;`-delimited CSV mapped for `generic`, `jtl-wawi`, `weclapp`, `shopware6`, `sage100`, and `selectline` (SKU, GTIN, short/long text, UN/ECE unit, sorted tier prices, exact `BigInt` gross calculation, VAT rate, classification, catalog categories) | No (`readOnlyHint: true`) |
| `csv_to_bmecat_2005` | `from-csv` | Converts a wholesale price list (CSV with `;`, `,`, or tab, including German decimal commas, or JSON) into clean, XML-escaped BMEcat 2005 `T_NEW_CATALOG` XML (`HEADER`, `SUPPLIER`, `PRODUCT` blocks, normalized UN/ECE units, GS1 GTIN check, ETIM/eCl@ss, and `LOWER_BOUND` tier prices) | No (`readOnlyHint: true`) |
| `validate_oci_cart` | `validate-oci` | Audits SAP OCI 4.0 / 5.0 PunchOut cart payloads (JSON, `application/x-www-form-urlencoded`, or HTML `<input>` forms): 1-based `NEW_ITEM-*[n]` indexing, mandatory `DESCRIPTION`/`QUANTITY`/`UNIT`/`PRICE`/`CURRENCY`, UN/ECE unit check (rejects `STK` with `PCE`/`C62` hint), field length bounds (`<= 40` / `<= 255` chars), negative quantities/prices, and exact `BigInt` totals per currency | No (`readOnlyHint: true`) |

### Server-Enforced Safety Boundaries

1. **Single-Folder Isolation (`BMECAT_ORDNER`):** File paths passed to MCP tools are resolved strictly inside `BMECAT_ORDNER` (defaults to `process.cwd()`). Parent traversal (`..`), external absolute paths, and symlinks or Windows junctions escaping the root are rejected via `fs.realpathSync`. Files above `20 MB` are refused.
2. **Read-Only & Offline:** All four MCP tools set `readOnlyHint: true`, write nothing to disk, and make zero network calls.
3. **XXE Protection:** `<!ENTITY` declarations in XML `DOCTYPE` blocks and unknown entities are rejected deterministically.
4. **Redacted Audit Log on `stderr`:** Each MCP call writes one compact JSON line to `stderr` (`zeit`, `werkzeug`, `quelle`, `ergebnis`) without company names, item texts, SKUs, or monetary amounts.
5. **Exact `BigInt` Fixed-Point Math:** Quantities, unit prices, price units, tier bounds, and VAT conversions run at `10^8` scale with half-away-from-zero commercial rounding.

### Quickstart & Installation

**Prerequisite:** Node.js `>= 20`.

#### 1. Run Directly via `npx` (Claude Desktop, Claude Code, Cursor, Windsurf)

```json
{
  "mcpServers": {
    "bmecat-oci": {
      "command": "npx",
      "args": ["-y", "github:iisakovbusiness-wq/fudaut-bmecat-oci-mcp"],
      "env": {
        "BMECAT_ORDNER": "/absolute/path/to/catalogs-and-oci"
      }
    }
  }
}
```

Or from a local checkout:

```bash
git clone https://github.com/iisakovbusiness-wq/fudaut-bmecat-oci-mcp.git
cd fudaut-bmecat-oci-mcp
npm ci
npm test
```

```json
{
  "mcpServers": {
    "bmecat-oci": {
      "command": "node",
      "args": ["/absolute/path/to/fudaut-bmecat-oci-mcp/dist/cli.js"],
      "env": {
        "BMECAT_ORDNER": "/absolute/path/to/catalogs-and-oci"
      }
    }
  }
}
```

Config file locations:
- **Claude Desktop:** `claude_desktop_config.json`
- **Claude Code:** `.mcp.json` in your project root or `~/.claude.json`
- **Cursor:** `.cursor/mcp.json`
- **Windsurf:** `~/.codeium/windsurf/mcp_config.json`

#### 2. Command-Line Interface (CLI & CI Gate)

Exit codes: `0` when valid/successful, `1` when validation errors are detected, `2` on file or usage errors. All commands also support `-` to read from `stdin`.

```bash
# 1. Validate a BMEcat 2005 or 1.2 catalog
npx -y github:iisakovbusiness-wq/fudaut-bmecat-oci-mcp validate-bmecat fixtures/bmecat-2005-valide.xml

# 2. Convert BMEcat XML to Shopware 6 JSON or JTL-Wawi CSV
npx -y github:iisakovbusiness-wq/fudaut-bmecat-oci-mcp to-erp fixtures/bmecat-2005-valide.xml --target shopware6
npx -y github:iisakovbusiness-wq/fudaut-bmecat-oci-mcp to-erp fixtures/bmecat-12-valide.xml --target jtl-wawi --format csv

# 3. Generate BMEcat 2005 XML from a wholesale CSV and validate via stdin roundtrip
npx -y github:iisakovbusiness-wq/fudaut-bmecat-oci-mcp from-csv fixtures/grosshandel-preisliste-valide.csv | node dist/cli.js validate-bmecat -

# 4. Validate SAP OCI 4.0 / 5.0 PunchOut cart payloads (form-encoded or JSON)
npx -y github:iisakovbusiness-wq/fudaut-bmecat-oci-mcp validate-oci fixtures/oci-cart-valide-form.txt
npx -y github:iisakovbusiness-wq/fudaut-bmecat-oci-mcp validate-oci fixtures/oci-cart-defekt-form.txt --json
```

#### 3. Docker Container

```bash
docker build -t fudaut-bmecat-oci-mcp .
docker run -i --rm -v /path/to/files:/data:ro -e BMECAT_ORDNER=/data fudaut-bmecat-oci-mcp
```

### Positive-Control Test Suite (`fixtures/` & `test/`)

`npm test` compiles TypeScript (`strict: true`) and runs `node --test` across **11 synthetic `.example` fixtures**:
- **Valid baselines (`0` errors):** `bmecat-2005-valide.xml`, `bmecat-12-valide.xml`, `grosshandel-preisliste-valide.csv` (roundtrip `csv_to_bmecat_2005` -> `validate_bmecat`), `grosshandel-preisliste-valide.json`, `oci-cart-valide-form.txt`, `oci-cart-valide-json.json`.
- **Positive-control defect fixtures (verified `ok: false`):** `bmecat-defekt-doppelte-aid.xml` (duplicate `SUPPLIER_AID`, missing `DESCRIPTION_SHORT` and `ORDER_UNIT`), `bmecat-defekt-ean-und-staffel.xml` (bad GS1 EAN-13 check digit, invalid `TAX=19`, inconsistent currency, negative/duplicate `LOWER_BOUND`, negative price, invalid `STK` unit, malformed ETIM ID), `bmecat-defekt-xxe.xml` (`<!ENTITY` blocked), `oci-cart-defekt-form.txt` & `oci-cart-defekt-json.json` (`STK` unit instead of `PCE`, description `> 40` chars, attachment `> 255` chars, negative/zero quantity, negative price, decimal comma).

### Automated Wholesale ERP, Catalog & E-Invoicing Bridges (Fudaut)

This open-source MCP server and CLI remain permanently free (`0 EUR` license and external API fees; users pay `0 EUR`, Ilia Isakov / Fudaut pays `0 EUR`).

If your wholesale or industrial B2B business needs a production-ready automation bridge across BMEcat 2005, SAP OCI PunchOut, JTL-Wawi, weclapp, Shopware 6, Sage 100, SelectLine, or B2B e-invoicing, Fudaut delivers fixed-price turnkey integrations (final prices under `§ 19 UStG`, paid by the direct client to Fudaut):

- **48h Handoff Bridge (`48h-Übergabe-Brücke`):** **`1,450 EUR` fixed price** (direct client pays `725 EUR` at start and `725 EUR` after acceptance on real sample data, 100 % credited toward an implementation package).
- **Free Client-Side E-Rechnung Browser Checker (zero server upload):**

https://www.fudaut.com/en/e-rechnung-check

Services overview (German):
https://www.fudaut.com/de/leistungen

Services overview (English):
https://www.fudaut.com/en/services

---

## Deutsch

`fudaut-bmecat-oci-mcp` ist ein lokal über `stdio` laufender Open-Source-MCP-Server und Kommandozeilen-Konverter (MIT-Lizenz, TypeScript / Node.js) für den technischen Großhandel und B2B-Einkauf abseits von SAP: BMEcat 1.2 & 2005, ERP-/Shop-Konvertierung (`JTL-Wawi`, `weclapp`, `Shopware 6`, `Sage 100`, `SelectLine`), Großhandels-Preislisten zu BMEcat-2005-`T_NEW_CATALOG` und SAP OCI 4.0 / 5.0 PunchOut.

Der Server arbeitet zu 100 % lokal ohne externe Netzwerk- oder API-Aufrufe, rechnet exakt mit `BigInt`-Festkomma-Arithmetik (`10^8`-Skalierung ohne IEEE-754-Rundungsfehler), blockiert `<!ENTITY`-Angriffe (XXE) und erzwingt eine harte Einzelordner-Grenze (`BMECAT_ORDNER`). Anwender zahlen `0 €` Lizenz- oder API-Kosten, Ilia Isakov (Fudaut) zahlt `0 €` laufende Drittanbieter-API-Kosten.

### Die vier MCP-Werkzeuge & CLI-Befehle

| MCP-Werkzeug | CLI-Befehl | Funktion & Prüfregeln | Schreibt auf Platte (MCP) |
|---|---|---|---|
| `validate_bmecat` | `validate-bmecat` | Prüft BMEcat 1.2 & BMEcat 2005 XML-Kataloge auf Struktur (`HEADER`/`CATALOG`/`SUPPLIER`/`T_NEW_CATALOG`), eindeutige `SUPPLIER_AID`/`SUPPLIER_PID`, GS1 Modulo-10 GTIN/EAN-8/12/13/14 Prüfziffern, Pflichtfelder (`DESCRIPTION_SHORT`/`ORDER_UNIT`/`PRICE_DETAILS`), UN/ECE Rec 20 Einheiten, konsistente `CURRENCY`/`TAX`/`LOWER_BOUND`-Staffeln in exakter `BigInt`-Arithmetik, `ETIM`/`eCl@ss`-Klassifikation sowie XXE-`<!ENTITY`-Sperre | nein (`readOnlyHint: true`) |
| `bmecat_to_erp_json` | `to-erp` | Konvertiert BMEcat 1.2/2005 XML in direkt importierbares ERP-/Shop-JSON oder `;`-CSV für `generic`, `jtl-wawi`, `weclapp`, `shopware6`, `sage100` und `selectline` (Artikelnummer, GTIN, Kurz-/Langtext, Einheit, sortierte Staffelpreise, exakte `BigInt`-Bruttorechnung, MwSt.-Satz, Klassifikation) | nein (`readOnlyHint: true`) |
| `csv_to_bmecat_2005` | `from-csv` | Erzeugt aus einer Großhandels-Preisliste (CSV mit `;`, `,` oder Tab inklusive deutscher Kommazahlen, oder JSON) ein sauberes, XML-escaped BMEcat-2005-`T_NEW_CATALOG`-XML inklusive `HEADER`, `SUPPLIER`, `PRODUCT`-Blöcken, normalisierten UN/ECE-Einheiten, GTIN-Prüfung, ETIM/eCl@ss und Staffelpreisen | nein (`readOnlyHint: true`) |
| `validate_oci_cart` | `validate-oci` | Prüft SAP OCI 4.0 / 5.0 PunchOut-Warenkorb-Payloads (JSON, Form-Encoded oder HTML-Formulare) auf 1-basierte `NEW_ITEM`-Indizes, Pflichtfelder (`DESCRIPTION`, `QUANTITY`, `UNIT`, `PRICE`, `CURRENCY`), UN/ECE-Einheitencodes (`PCE`/`C62`/`MTR`/`KGM`/`LTR`/`SET`, lehnt `STK` mit Hinweis ab), Feldlängen (`<= 40` / `<= 255` Zeichen), negative Mengen/Preise und exakte `BigInt`-Summen | nein (`readOnlyHint: true`) |

### Installation & Einbindung in MCP-Clients

Voraussetzung: Node.js ab Version `20`.

#### 1. Direktstart über `npx` (Claude Desktop, Claude Code, Cursor, Windsurf)

```json
{
  "mcpServers": {
    "bmecat-oci": {
      "command": "npx",
      "args": ["-y", "github:iisakovbusiness-wq/fudaut-bmecat-oci-mcp"],
      "env": {
        "BMECAT_ORDNER": "/absoluter/pfad/zu/katalogen-und-oci"
      }
    }
  }
}
```

Oder aus einem lokalen Klon:

```bash
git clone https://github.com/iisakovbusiness-wq/fudaut-bmecat-oci-mcp.git
cd fudaut-bmecat-oci-mcp
npm ci
npm test
```

```json
{
  "mcpServers": {
    "bmecat-oci": {
      "command": "node",
      "args": ["/absoluter/pfad/zu/fudaut-bmecat-oci-mcp/dist/cli.js"],
      "env": {
        "BMECAT_ORDNER": "/absoluter/pfad/zu/katalogen-und-oci"
      }
    }
  }
}
```

#### 2. Nutzung als CLI und in CI/CD-Pipelines

Exit-Codes: `0` bei fehlerfreier Datei, `1` bei fachlichem Befund (`ok = false`), `2` bei Dateifehler. Mit `-` lesen alle Befehle auch von `stdin`.

```bash
# BMEcat 2005 Katalog validieren
node dist/cli.js validate-bmecat fixtures/bmecat-2005-valide.xml

# BMEcat nach Shopware 6 JSON oder JTL-Wawi CSV konvertieren
node dist/cli.js to-erp fixtures/bmecat-2005-valide.xml --target shopware6
node dist/cli.js to-erp fixtures/bmecat-12-valide.xml --target jtl-wawi --format csv

# Großhandels-CSV in BMEcat 2005 wandeln und per stdin gegenprüfen
node dist/cli.js from-csv fixtures/grosshandel-preisliste-valide.csv | node dist/cli.js validate-bmecat -

# SAP OCI 4.0 / 5.0 PunchOut-Warenkorb prüfen
node dist/cli.js validate-oci fixtures/oci-cart-valide-form.txt
node dist/cli.js validate-oci fixtures/oci-cart-defekt-form.txt --json
```

### Projektstruktur

```text
src/math.ts             Exakte BigInt-Festkomma-Arithmetik (Skalierung 10^8, deutsches Komma/ISO-Punkt)
src/xml.ts              Deterministischer XML-Parser mit Zeilennummern, Escaping und XXE-Sperre
src/codes.ts            GS1 Modulo-10 GTIN/EAN, UN/ECE Rec 20 Einheiten, ISO 4217, ETIM/eCl@ss
src/bmecatModel.ts      Kanonisches Modell für BMEcat 1.2 (ARTICLE) und BMEcat 2005 (PRODUCT)
src/validateBmecat.ts   Werkzeug 1: BMEcat 1.2 & 2005 Katalogprüfung
src/bmecatToErp.ts      Werkzeug 2: ERP-/Shop-Konvertierung (JTL-Wawi, weclapp, Shopware 6, Sage 100, SelectLine)
src/csvToBmecat.ts      Werkzeug 3: Großhandels-CSV/JSON nach BMEcat 2005 T_NEW_CATALOG
src/validateOci.ts      Werkzeug 4: SAP OCI 4.0 / 5.0 PunchOut-Warenkorbprüfung
src/server.ts           MCP-Server (stdio), Einzelordner-Grenze (BMECAT_ORDNER), stderr-Protokoll
src/cli.ts              Kombinierter MCP-Starter (0 Argumente) und CLI-Runner
fixtures/               11 synthetische Positiv- und Defekt-Musterdateien (nur .example-Daten)
test/                   Automatisierte Unit-, Positivkontroll-, MCP-stdio-, CLI- und Hygiene-Tests
server.json             Metadaten nach Official MCP Registry Schema (2025-12-11)
glama.json              Glama-Maintainer-Metadaten
Dockerfile              Mehrstufiges Node-22-Alpine-Image (non-root USER node)
```

### Produktive Katalog-, OCI- & E-Rechnungs-Brücken (Fudaut)

Dieses Open-Source-Paket ist unter der MIT-Lizenz dauerhaft kostenlos (`0 €` Lizenz- und API-Kosten; Anwender zahlen `0 €`, Ilia Isakov / Fudaut zahlt `0 €` externe API-Gebühren).

Wenn Ihr Großhandel oder Industriebetrieb eine produktive Schnittstelle zwischen bestehendem ERP (`JTL-Wawi`, `weclapp`, `Shopware 6`, `Sage 100`, `SelectLine`), BMEcat 2005, SAP OCI PunchOut und BMF-konformen E-Rechnungen benötigt, setzt Fudaut die Strecke zum klaren Festpreis um (Endpreise nach `§ 19 UStG`, jeweils gezahlt vom Direktkunden an Fudaut):

- **48h-Übergabe-Brücke:** **`1.450 €` Festpreis** (Direktkunde zahlt `725 €` bei Start und `725 €` erst nach Abnahme an echten Musterdaten, zu 100 % anrechenbar auf ein Umsetzungspaket).
- **Kostenloser 100-%-Browser-Prüfer für E-Rechnungen (null Server-Upload):**

https://www.fudaut.com/de/e-rechnung-check

Leistungsübersicht & Festpreise:
https://www.fudaut.com/de/leistungen

---

## Marken- und Lizenzhinweis / Trademarks & License

- **Markenhinweis / Trademarks:** BMEcat ist eine Standardbezeichnung des Bundesverbandes Materialwirtschaft, Einkauf und Logistik e.V. (BME). SAP und OCI (Open Catalog Interface) sind Bezeichnungen bzw. Marken der SAP SE. JTL und JTL-Wawi sind Marken der JTL-Software-GmbH. weclapp ist eine Marke der weclapp SE. Shopware ist eine Marke der shopware AG. Sage ist eine Marke der Sage Group plc. SelectLine ist eine Marke der SelectLine Software GmbH. ETIM ist eine Bezeichnung der ETIM International / ETIM Deutschland e.V. eCl@ss ist eine Bezeichnung des ECLASS e.V. Dieses Open-Source-Projekt steht in keiner gesellschaftsrechtlichen oder vertraglichen Verbindung zu den genannten Rechteinhabern und ist von ihnen weder geprüft noch zertifiziert. Alle Firmen-, Produkt- und Katalogangaben unter `fixtures/` sind frei erfunden (`.example`).
- **Lizenz / License:** Veröffentlicht unter der **MIT-Lizenz** (siehe [`LICENSE`](LICENSE)).
