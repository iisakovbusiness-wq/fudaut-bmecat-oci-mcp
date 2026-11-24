/**
 * Deterministischer, XXE-sicherer XML-Baum-Parser und Escaper ohne externe Abhängigkeiten.
 * Bewahrt Zeilennummern, Namensräume (xmlns) und Reihenfolge für BMEcat 1.2 und BMEcat 2005.
 */
export interface XmlAttribute {
    name: string;
    prefix: string;
    localName: string;
    ns: string;
    value: string;
}
export interface XmlNode {
    name: string;
    prefix: string;
    localName: string;
    ns: string;
    attrs: Record<string, string>;
    attrList: XmlAttribute[];
    children: XmlNode[];
    text: string;
    line: number;
}
export declare class XmlParseError extends Error {
    readonly line: number;
    readonly code: string;
    constructor(code: string, message: string, line: number);
}
/** Maskiert Text sicher für XML-Elemente und Attribute und entfernt unzulässige Steuerzeichen. */
export declare function escapeXml(input: string): string;
export declare function decodeXmlEntities(input: string, line?: number): string;
/** Parst ein XML-Dokument in den Wurzelknoten; lehnt <!ENTITY (XXE / Billion Laughs) strikt ab. */
export declare function parseXmlDocument(rawInput: string): XmlNode;
/** Erstes direktes Kind mit passendem localName. */
export declare function childByLocal(node: XmlNode | null | undefined, localName: string): XmlNode | undefined;
/** Alle direkten Kinder mit passendem localName. */
export declare function childrenByLocal(node: XmlNode | null | undefined, localName: string): XmlNode[];
/** Pfad aus mehreren localNames nacheinander auflösen. */
export declare function pathByLocal(node: XmlNode | null | undefined, ...localNames: string[]): XmlNode | undefined;
/** Textinhalt entlang eines localName-Pfads (oder null). */
export declare function textAtPath(node: XmlNode | null | undefined, ...localNames: string[]): string | null;
/** Alle Nachfahren mit passendem localName in Dokumentreihenfolge. */
export declare function descendantsByLocal(node: XmlNode | null | undefined, localName: string): XmlNode[];
/** Attributwert anhand localName (optional gefiltert nach Namespace-URI). */
export declare function attrByLocal(node: XmlNode | null | undefined, localName: string, nsUri?: string): string | null;
