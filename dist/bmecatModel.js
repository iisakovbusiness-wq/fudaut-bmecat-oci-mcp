/**
 * Kanonisches BMEcat 1.2 & BMEcat 2005 Katalogmodell.
 * Extrahiert HEADER, CATALOG, SUPPLIER, T_NEW_CATALOG, Katalog-Gruppenzuordnungen,
 * Artikel/Produkte, GTINs, Mengeneinheiten, Staffelpreise und ETIM-/eCl@ss-Merkmale.
 */
import { childByLocal, childrenByLocal, pathByLocal, textAtPath } from "./xml.js";
function extrahiereDatum(catalogNode) {
    if (!catalogNode)
        return null;
    for (const dt of childrenByLocal(catalogNode, "DATETIME")) {
        const t = (dt.attrs["type"] ?? "").toLowerCase();
        if (!t || t === "generation_date") {
            const d = textAtPath(dt, "DATE")?.trim();
            if (d)
                return d;
        }
    }
    const direct = textAtPath(catalogNode, "GENERATION_DATE")?.trim();
    return direct || null;
}
/** Wandelt einen geparsten BMEcat-XML-Baum in das einheitliche Katalogmodell um. */
export function extractBmecatModel(root) {
    const version = root.attrs["version"]?.trim() ?? null;
    const header = childByLocal(root, "HEADER");
    const catalog = childByLocal(header, "CATALOG");
    const supplier = childByLocal(header, "SUPPLIER");
    const buyer = childByLocal(header, "BUYER");
    const currencyNode = childByLocal(catalog, "CURRENCY");
    const transNames = ["T_NEW_CATALOG", "T_UPDATE_PRODUCTS", "T_UPDATE_PRICES"];
    let transNode;
    let transactionType = null;
    for (const tn of transNames) {
        const found = childByLocal(root, tn);
        if (found) {
            transNode = found;
            transactionType = tn;
            break;
        }
    }
    // Optionales Katalog-Gruppensystem und Artikel->Kategorie-Mapping sammeln
    const katalogGruppenNamen = {};
    const groupSystem = childByLocal(transNode, "CATALOG_GROUP_SYSTEM");
    if (groupSystem) {
        for (const cs of childrenByLocal(groupSystem, "CATALOG_STRUCTURE")) {
            const gid = textAtPath(cs, "GROUP_ID")?.trim();
            const gname = textAtPath(cs, "GROUP_NAME")?.trim();
            if (gid && gname)
                katalogGruppenNamen[gid] = gname;
        }
    }
    const artToGroupMap = new Map();
    const mapNodes = [
        ...childrenByLocal(transNode, "ARTICLE_TO_CATALOGGROUP_MAP"),
        ...childrenByLocal(transNode, "PRODUCT_TO_CATALOGGROUP_MAP"),
    ];
    for (const m of mapNodes) {
        const aid = (textAtPath(m, "ART_ID") ?? textAtPath(m, "PROD_ID"))?.trim();
        const gid = textAtPath(m, "CATALOG_GROUP_ID")?.trim();
        if (aid && gid) {
            const arr = artToGroupMap.get(aid) ?? [];
            if (!arr.includes(gid))
                arr.push(gid);
            artToGroupMap.set(aid, arr);
        }
    }
    const artikel = [];
    if (transNode) {
        for (const child of transNode.children) {
            if (child.localName !== "PRODUCT" && child.localName !== "ARTICLE")
                continue;
            const tagName = child.localName;
            const aidNode = childByLocal(child, "SUPPLIER_PID") ?? childByLocal(child, "SUPPLIER_AID");
            const supplierAid = aidNode?.text.trim() || null;
            const details = childByLocal(child, "PRODUCT_DETAILS") ?? childByLocal(child, "ARTICLE_DETAILS");
            const descShortNode = childByLocal(details, "DESCRIPTION_SHORT");
            const descriptionShort = descShortNode?.text.trim() || null;
            const descriptionLong = textAtPath(details, "DESCRIPTION_LONG")?.trim() || null;
            const gtins = [];
            for (const eanNode of childrenByLocal(details, "EAN")) {
                if (eanNode.text.trim()) {
                    gtins.push({ wert: eanNode.text.trim(), typ: "ean", zeile: eanNode.line });
                }
            }
            for (const ipid of childrenByLocal(details, "INTERNATIONAL_PID")) {
                const t = (ipid.attrs["type"] ?? "gtin").trim().toLowerCase();
                if ((t === "ean" || t.startsWith("gtin") || t === "") && ipid.text.trim()) {
                    gtins.push({ wert: ipid.text.trim(), typ: t || "gtin", zeile: ipid.line });
                }
            }
            const orderDetails = childByLocal(child, "PRODUCT_ORDER_DETAILS") ?? childByLocal(child, "ARTICLE_ORDER_DETAILS");
            const orderUnitNode = childByLocal(orderDetails, "ORDER_UNIT");
            const priceDetails = childByLocal(child, "PRODUCT_PRICE_DETAILS") ?? childByLocal(child, "ARTICLE_PRICE_DETAILS");
            const priceNodes = [
                ...childrenByLocal(priceDetails, "PRODUCT_PRICE"),
                ...childrenByLocal(priceDetails, "ARTICLE_PRICE"),
            ];
            const prices = priceNodes.map((pn) => ({
                zeile: pn.line,
                priceType: (pn.attrs["price_type"] ?? "net_list").trim() || "net_list",
                amountRaw: textAtPath(pn, "PRICE_AMOUNT")?.trim() ?? null,
                currencyRaw: textAtPath(pn, "PRICE_CURRENCY")?.trim() ?? null,
                taxRaw: textAtPath(pn, "TAX")?.trim() ?? null,
                priceFactorRaw: textAtPath(pn, "PRICE_FACTOR")?.trim() ?? null,
                lowerBoundRaw: textAtPath(pn, "LOWER_BOUND")?.trim() ?? null,
                territories: childrenByLocal(pn, "TERRITORY").map((t) => t.text.trim()).filter(Boolean),
            }));
            const featureNodes = [
                ...childrenByLocal(child, "PRODUCT_FEATURES"),
                ...childrenByLocal(child, "ARTICLE_FEATURES"),
            ];
            const featureGroups = featureNodes.map((fn) => ({
                systemName: textAtPath(fn, "REFERENCE_FEATURE_SYSTEM_NAME")?.trim() || null,
                groupId: textAtPath(fn, "REFERENCE_FEATURE_GROUP_ID")?.trim() || null,
                zeile: fn.line,
                merkmale: childrenByLocal(fn, "FEATURE").map((f) => ({
                    name: textAtPath(f, "FNAME")?.trim() ?? "",
                    werte: childrenByLocal(f, "FVALUE").map((v) => v.text.trim()).filter(Boolean),
                    einheit: textAtPath(f, "FUNIT")?.trim() || null,
                    zeile: f.line,
                })),
            }));
            const mimeBlock = childByLocal(child, "MIME_INFO");
            const mimeInfos = childrenByLocal(mimeBlock, "MIME")
                .map((m) => ({
                type: textAtPath(m, "MIME_TYPE")?.trim() || null,
                source: textAtPath(m, "MIME_SOURCE")?.trim() ?? "",
                description: textAtPath(m, "MIME_DESCR")?.trim() || null,
            }))
                .filter((m) => Boolean(m.source));
            artikel.push({
                zeile: child.line,
                tagName,
                mode: child.attrs["mode"]?.trim() ?? null,
                supplierAid,
                supplierAidZeile: aidNode?.line ?? child.line,
                descriptionShort,
                descriptionShortZeile: descShortNode?.line ?? details?.line ?? child.line,
                descriptionLong,
                gtins,
                manufacturerPid: (textAtPath(details, "MANUFACTURER_PID") ?? textAtPath(details, "MANUFACTURER_AID"))?.trim() || null,
                manufacturerName: textAtPath(details, "MANUFACTURER_NAME")?.trim() || null,
                deliveryTimeRaw: textAtPath(details, "DELIVERY_TIME")?.trim() || null,
                orderUnit: orderUnitNode?.text.trim() ?? null,
                orderUnitZeile: orderUnitNode?.line ?? orderDetails?.line ?? child.line,
                contentUnit: textAtPath(orderDetails, "CONTENT_UNIT")?.trim() || null,
                noCuPerOuRaw: textAtPath(orderDetails, "NO_CU_PER_OU")?.trim() || null,
                priceQuantityRaw: textAtPath(orderDetails, "PRICE_QUANTITY")?.trim() || null,
                quantityMinRaw: textAtPath(orderDetails, "QUANTITY_MIN")?.trim() || null,
                quantityIntervalRaw: textAtPath(orderDetails, "QUANTITY_INTERVAL")?.trim() || null,
                hasPriceDetails: Boolean(priceDetails),
                priceDetailsZeile: priceDetails?.line ?? child.line,
                prices,
                featureGroups,
                kategorieIds: supplierAid ? (artToGroupMap.get(supplierAid) ?? []) : [],
                mimeInfos,
            });
        }
    }
    return {
        wurzelName: root.localName,
        wurzelZeile: root.line,
        version,
        xmlns: root.ns,
        hasHeader: Boolean(header),
        headerZeile: header?.line ?? root.line,
        hasCatalog: Boolean(catalog),
        catalogZeile: catalog?.line ?? header?.line ?? root.line,
        catalogId: textAtPath(catalog, "CATALOG_ID")?.trim() || null,
        catalogVersion: textAtPath(catalog, "CATALOG_VERSION")?.trim() || null,
        catalogName: textAtPath(catalog, "CATALOG_NAME")?.trim() || null,
        language: textAtPath(catalog, "LANGUAGE")?.trim() || null,
        currency: currencyNode?.text.trim() || null,
        currencyZeile: currencyNode?.line ?? catalog?.line ?? root.line,
        generationDate: extrahiereDatum(catalog),
        hasSupplier: Boolean(supplier),
        supplierZeile: supplier?.line ?? header?.line ?? root.line,
        supplierId: textAtPath(supplier, "SUPPLIER_ID")?.trim() || null,
        supplierName: textAtPath(supplier, "SUPPLIER_NAME")?.trim() || null,
        buyerName: (textAtPath(buyer, "BUYER_NAME") ?? pathByLocal(buyer, "BUYER_ID")?.text)?.trim() || null,
        transactionType,
        transactionZeile: transNode?.line ?? root.line,
        katalogGruppenNamen,
        artikel,
    };
}
