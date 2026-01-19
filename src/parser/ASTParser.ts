/**
 * ASTParser - Abstract Syntax Tree parsing for reliable element tracking
 * Uses htmlparser2 for HTML and @babel/parser for JSX/TSX files
 */
import { Parser, DomHandler } from 'htmlparser2';
import type { Element, ChildNode } from 'domhandler';
import * as babelParser from '@babel/parser';
import traverse from '@babel/traverse';

export interface ElementNode {
    id: string;           // Unique identifier (data-ag-id)
    tagName: string;      // e.g., 'div', 'span', 'h1'
    start: number;        // Start position in source
    end: number;          // End position in source
    startLine: number;    // Line number (1-indexed)
    endLine: number;      // End line number
    attributes: Record<string, string>;
    children: ElementNode[];
    parent?: ElementNode;
}

export interface ParseResult {
    nodes: ElementNode[];
    nodeMap: Map<string, ElementNode>;
    content: string;
}

let idCounter = 0;
function generateId(): string {
    return `ag-${Date.now()}-${idCounter++}`;
}

/**
 * Parse HTML content into an AST with element positions
 */
export function parseHTML(content: string): ParseResult {
    console.log('[ASTParser] Parsing HTML content');

    const nodes: ElementNode[] = [];
    const nodeMap = new Map<string, ElementNode>();
    const stack: ElementNode[] = [];

    const handler = new DomHandler(
        (error, dom) => {
            if (error) {
                console.error('[ASTParser] Parse error:', error);
            }
        },
        {
            withStartIndices: true,
            withEndIndices: true,
        }
    );

    const parser = new Parser(handler);
    parser.write(content);
    parser.end();

    // Convert DOM to our ElementNode structure
    function processNode(node: ChildNode, parent?: ElementNode): ElementNode | null {
        if (node.type !== 'tag') return null;

        const element = node as Element;
        const id = generateId();

        const elementNode: ElementNode = {
            id,
            tagName: element.name.toLowerCase(),
            start: element.startIndex || 0,
            end: element.endIndex ? element.endIndex + 1 : 0,
            startLine: getLineNumber(content, element.startIndex || 0),
            endLine: getLineNumber(content, element.endIndex || 0),
            attributes: element.attribs || {},
            children: [],
            parent,
        };

        nodeMap.set(id, elementNode);

        // Process children
        if (element.children) {
            for (const child of element.children) {
                const childNode = processNode(child, elementNode);
                if (childNode) {
                    elementNode.children.push(childNode);
                }
            }
        }

        return elementNode;
    }

    // Process all top-level nodes
    for (const node of handler.dom) {
        const elementNode = processNode(node);
        if (elementNode) {
            nodes.push(elementNode);
        }
    }

    console.log('[ASTParser] Parsed', nodeMap.size, 'elements');
    return { nodes, nodeMap, content };
}

/**
 * Parse JSX/TSX content into AST
 */
export function parseJSX(content: string, isTypeScript: boolean = false): ParseResult {
    console.log('[ASTParser] Parsing JSX content, isTypeScript:', isTypeScript);

    const nodes: ElementNode[] = [];
    const nodeMap = new Map<string, ElementNode>();

    try {
        const ast = babelParser.parse(content, {
            sourceType: 'module',
            plugins: isTypeScript
                ? ['jsx', 'typescript']
                : ['jsx'],
        });

        traverse(ast, {
            JSXElement(path) {
                const node = path.node;
                const openingElement = node.openingElement;

                // Get tag name
                let tagName = 'unknown';
                if (openingElement.name.type === 'JSXIdentifier') {
                    tagName = openingElement.name.name;
                } else if (openingElement.name.type === 'JSXMemberExpression') {
                    tagName = 'MemberExpression';
                }

                const id = generateId();

                const elementNode: ElementNode = {
                    id,
                    tagName,
                    start: node.start || 0,
                    end: node.end || 0,
                    startLine: node.loc?.start.line || 1,
                    endLine: node.loc?.end.line || 1,
                    attributes: extractJSXAttributes(openingElement.attributes),
                    children: [],
                };

                nodeMap.set(id, elementNode);
                nodes.push(elementNode);
            },
        });

        console.log('[ASTParser] Parsed', nodeMap.size, 'JSX elements');
    } catch (error) {
        console.error('[ASTParser] JSX parse error:', error);
    }

    return { nodes, nodeMap, content };
}

/**
 * Extract attributes from JSX opening element
 */
function extractJSXAttributes(attrs: any[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (const attr of attrs) {
        if (attr.type === 'JSXAttribute' && attr.name?.type === 'JSXIdentifier') {
            const name = attr.name.name;
            let value = '';
            if (attr.value?.type === 'StringLiteral') {
                value = attr.value.value;
            } else if (attr.value?.type === 'JSXExpressionContainer') {
                value = '[expression]';
            }
            result[name] = value;
        }
    }
    return result;
}

/**
 * Get 1-indexed line number for a character position
 */
function getLineNumber(content: string, position: number): number {
    const before = content.substring(0, position);
    return (before.match(/\n/g) || []).length + 1;
}

// Store the last generated ID map for lookup
// This is necessary because IDs are ephemeral and only exist in the preview HTML
let lastIdMap = new Map<string, { start: number; end: number; tagName: string }>();

/**
 * Inject data-ag-id attributes into HTML content for element tracking.
 * Returns the modified content and a map of IDs to positions.
 */
export function injectElementIds(content: string): {
    content: string;
    idMap: Map<string, { start: number; end: number; tagName: string }>;
} {
    console.log('[ASTParser] Injecting element IDs');

    const idMap = new Map<string, { start: number; end: number; tagName: string }>();
    let result = content;

    // Parse to get element positions
    const parseResult = parseHTML(content);

    // Inject IDs in reverse order to preserve positions
    const allNodes: ElementNode[] = [];
    function collectNodes(node: ElementNode) {
        allNodes.push(node);
        for (const child of node.children) {
            collectNodes(child);
        }
    }
    for (const node of parseResult.nodes) {
        collectNodes(node);
    }

    // Sort by position descending (inject from end to start)
    allNodes.sort((a, b) => b.start - a.start);

    for (const node of allNodes) {
        // Skip doctype, html, head, body - these are structural
        if (['!doctype', 'html', 'head', 'body', 'meta', 'link', 'script', 'style', 'title'].includes(node.tagName)) {
            continue;
        }

        // Find the position to inject the attribute (right after tag name)
        const tagStart = node.start;
        const searchContent = result.substring(tagStart);
        const match = searchContent.match(new RegExp(`^<${node.tagName}(\\s|>|/>)`, 'i'));

        if (match) {
            const insertPos = tagStart + match[0].length - 1;
            const id = node.id;
            const injection = ` data-ag-id="${id}"`;

            result = result.substring(0, insertPos) + injection + result.substring(insertPos);

            // Store mapping
            idMap.set(id, {
                start: node.start,
                end: node.end,
                tagName: node.tagName,
            });
        }
    }

    console.log('[ASTParser] Injected', idMap.size, 'element IDs');

    // Update the global map
    lastIdMap = idMap;

    return { content: result, idMap };
}

/**
 * Find an element by its data-ag-id using the stored map
 */
export function findElementById(
    content: string,
    id: string
): { start: number; end: number; tagName: string } | null {
    console.log('[ASTParser] Finding element by ID:', id);

    // Use the stored map instead of searching content
    // The ID only exists in the preview HTML, not in the source content
    const location = lastIdMap.get(id);

    if (location) {
        console.log('[ASTParser] Found position in map:', location);
        return location;
    }

    console.log('[ASTParser] ID not found in map');
    return null;
}

/**
 * Delete an element from content by its ID
 */
export function deleteElementById(content: string, id: string): string | null {
    const element = findElementById(content, id);
    if (!element) return null;

    return content.substring(0, element.start) + content.substring(element.end);
}

/**
 * Duplicate an element in content by its ID
 */
export function duplicateElementById(content: string, id: string): string | null {
    const element = findElementById(content, id);
    if (!element) return null;

    const elementContent = content.substring(element.start, element.end);
    // Remove the data-ag-id from the duplicate (it will get a new one)
    const cleanedContent = elementContent.replace(/\s*data-ag-id=["'][^"']*["']/, '');

    return content.substring(0, element.end) + '\n' + cleanedContent + content.substring(element.end);
}
