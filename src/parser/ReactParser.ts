import * as parser from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import * as t from '@babel/types';

export interface JSXElementLocation {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
}

interface PathSegment {
    tagName: string;
    id?: string;
    className?: string;
    nthChild?: number;
}

export interface ParsedJSXElement {
    tagName: string;
    attributes: Record<string, any>;
    location: JSXElementLocation;
    children: ParsedJSXElement[];
    textContent?: string;
    path: string; // Kept for debug/legacy
    isComponent: boolean;
    index: number; // 1-based index among JSXElement siblings
}

/**
 * Parses React JSX/TSX files and provides utilities for finding and modifying elements
 */
export class ReactParser {
    private content: string;
    private isTypeScript: boolean;

    constructor(content: string, isTypeScript: boolean = false) {
        this.content = content;
        this.isTypeScript = isTypeScript;
    }

    /**
     * Parse the JSX/TSX and return a tree of elements with locations
     */
    public parse(): ParsedJSXElement[] {
        const elements: ParsedJSXElement[] = [];

        try {
            const ast = parser.parse(this.content, {
                sourceType: 'module',
                plugins: [
                    'jsx',
                    ...(this.isTypeScript ? ['typescript'] as const : []),
                ],
            });

            const elementStack: ParsedJSXElement[] = [];

            traverse(ast, {
                JSXElement: {
                    enter: (path) => {
                        const openingElement = path.node.openingElement;
                        const tagName = this.getTagName(openingElement.name);
                        const isComponent = tagName[0] === tagName[0].toUpperCase();

                        // Calculate index among siblings
                        let index = 1;
                        if (path.container && Array.isArray(path.container)) {
                            const siblings = path.container.filter(n => t.isJSXElement(n));
                            const myIndex = siblings.indexOf(path.node as any);
                            if (myIndex !== -1) {
                                index = myIndex + 1;
                            }
                        } else if (path.key && typeof path.key === 'number') {
                            // Fallback if container logic is tricky (though above should work for arrays)
                            // But for non-array containers (like ReturnStatement), index is effectively 1
                            index = 1;
                        }

                        const element: ParsedJSXElement = {
                            tagName,
                            attributes: this.extractAttributes(openingElement.attributes),
                            location: {
                                startLine: path.node.loc?.start.line || 0,
                                startColumn: path.node.loc?.start.column || 0,
                                endLine: path.node.loc?.end.line || 0,
                                endColumn: path.node.loc?.end.column || 0,
                            },
                            children: [],
                            path: '', // populated below or ignored in new logic
                            isComponent,
                            index
                        };

                        // Legacy path building (optional, but good for debug)
                        element.path = this.buildPath(elementStack, tagName, element.attributes);

                        // Check for text content
                        const textChild = path.node.children.find(
                            (child): child is t.JSXText => t.isJSXText(child)
                        );
                        if (textChild) {
                            element.textContent = textChild.value.trim();
                        }

                        if (elementStack.length > 0) {
                            elementStack[elementStack.length - 1].children.push(element);
                        } else {
                            elements.push(element);
                        }
                        elementStack.push(element);
                    },
                    exit: () => {
                        elementStack.pop();
                    },
                },
            });
        } catch (error) {
            console.error('Failed to parse JSX:', error);
        }

        return elements;
    }

    /**
     * Find an element by its path selector
     */
    public findElementByPath(pathStr: string): ParsedJSXElement | null {
        const elements = this.parse();
        const segments = this.parseSelector(pathStr);

        console.log(`[ReactParser] Finding element by path: ${pathStr}`);
        console.log(`[ReactParser] Parsed segments:`, JSON.stringify(segments));

        let currentCandidates = elements;
        let startIndex = 0;

        // Special case: If first segment has an ID, find it anywhere in the tree first
        if (segments.length > 0 && segments[0].id) {
            const rootIdMatch = this.findElementById(elements, segments[0].id);
            if (rootIdMatch) {
                console.log(`[ReactParser] Found start ID match: #${segments[0].id}`);
                if (segments.length === 1) return rootIdMatch;
                currentCandidates = rootIdMatch.children;
                startIndex = 1;
            } else {
                console.log(`[ReactParser] Start ID #${segments[0].id} not found in tree`);
                return null;
            }
        }

        for (let i = startIndex; i < segments.length; i++) {
            const segment = segments[i];
            const match = currentCandidates.find(el => this.matchesSegment(el, segment));

            if (!match) {
                console.log(`[ReactParser] Failed to match segment at index ${i}:`, segment);
                return null;
            }

            if (i === segments.length - 1) {
                console.log(`[ReactParser] Found full path match!`);
                return match;
            }

            currentCandidates = match.children;
        }

        return null;
    }

    private findElementById(elements: ParsedJSXElement[], id: string): ParsedJSXElement | null {
        for (const el of elements) {
            if (el.attributes.id === id) return el;
            const found = this.findElementById(el.children, id);
            if (found) return found;
        }
        return null;
    }

    /**
     * Find an element by its data-ag-id attribute using AST
     */
    findElementByAgId(elements: ParsedJSXElement[], agId: string): ParsedJSXElement | null {
        for (const el of elements) {
            if (el.attributes['data-ag-id'] === agId) return el;
            const found = this.findElementByAgId(el.children, agId);
            if (found) return found;
        }
        return null;
    }

    private matchesSegment(element: ParsedJSXElement, segment: PathSegment): boolean {
        // BUG FIX: When segment has an ID but tagName is 'div' (the default),
        // prioritize ID matching. This handles cases like #reviews where the
        // actual element is <section id="reviews">, not <div id="reviews">.
        const hasIdButDefaultTag = segment.id && segment.tagName === 'div';

        // Match Tag Name (skip if this is an ID-only selector with default tag)
        if (!hasIdButDefaultTag && element.tagName.toLowerCase() !== segment.tagName.toLowerCase()) {
            return false;
        }

        // Match ID
        if (segment.id && element.attributes.id !== segment.id) {
            return false;
        }

        // Match Class (partial)
        if (segment.className && element.attributes.className) {
            const classes = String(element.attributes.className).split(/\s+/);
            if (!classes.includes(segment.className)) {
                return false;
            }
        } else if (segment.className) {
            return false; // Segment expects class, element has none
        }

        // Match nth-child
        if (segment.nthChild !== undefined) {
            if (element.index !== segment.nthChild) {
                return false;
            }
        }

        return true;
    }

    private parseSelector(path: string): PathSegment[] {
        const parts = path.split('>').map(s => s.trim()).filter(s => s.length > 0);
        return parts.map(part => {
            const segment: PathSegment = { tagName: 'div' }; // defaults

            // Extract nth-child
            const nthMatch = part.match(/:nth-child\((\d+)\)/);
            if (nthMatch) {
                segment.nthChild = parseInt(nthMatch[1]);
            }

            // Remove pseudo-classes for parsing tag/id/class
            let cleanPart = part.replace(/:[a-zA-Z-]+\([^\)]+\)/g, '').replace(/:[a-zA-Z-]+/g, '');

            // Extract ID
            const idMatch = cleanPart.match(/#([^\.\#]+)/);
            if (idMatch) {
                segment.id = idMatch[1];
                cleanPart = cleanPart.replace(idMatch[0], '');
            }

            // Extract class
            const classMatch = cleanPart.match(/\.([^\.\#]+)/);
            if (classMatch) {
                segment.className = classMatch[1];
                cleanPart = cleanPart.replace(classMatch[0], '');
            }

            // Extract Tag
            const tagMatch = cleanPart.match(/^([a-zA-Z0-9\-\_]+)/);
            if (tagMatch) {
                segment.tagName = tagMatch[1];
            } else if (segment.id || segment.className) {
                // Implicit div if id/class present but no tag? 
                // Actually browser usually provides tag. Default to div if missing.
            }

            return segment;
        });
    }

    /**
     * Apply a text edit to an element
     */
    /**
     * Apply a text edit to an element using AST
     */
    public applyTextEdit(element: ParsedJSXElement, newText: string): string {
        // Parse AST to find the exact location of the text node
        const ast = parser.parse(this.content, {
            sourceType: 'module',
            plugins: ['jsx', ...(this.isTypeScript ? ['typescript'] as const : [])],
        });

        let newContent = this.content;
        let editApplied = false;

        traverse(ast, {
            JSXElement: (path) => {
                if (editApplied) return;

                // Match exact location of the parent element
                if (this.isLocationMatch(path.node.loc, element.location)) {
                    // Find the text child
                    const textChild = path.node.children.find(
                        (child): child is t.JSXText => t.isJSXText(child)
                    );

                    if (textChild && textChild.loc) {
                        // Replace existing text
                        const { start, end } = this.getIndices(textChild.loc);
                        newContent = this.content.substring(0, start) + newText + this.content.substring(end);
                        editApplied = true;
                    } else if (path.node.openingElement.loc && path.node.closingElement?.loc) {
                        // No text child, insert between tags
                        // Check if it's self-closing? AST usually gives distinct opening/closing for normal elements

                        const openEnd = this.getIndices(path.node.openingElement.loc).end;
                        const closeStart = this.getIndices(path.node.closingElement.loc).start;

                        // If openEnd < closeStart, we can insert
                        if (openEnd < closeStart) {
                            newContent = this.content.substring(0, openEnd) + newText + this.content.substring(closeStart);
                            editApplied = true;
                        }
                    } else if (path.node.selfClosing && path.node.openingElement.loc) {
                        // Convert self-closing to standard: <div /> -> <div>text</div>
                        // This is header, slightly complex string manip: replace '/>' with '>text</tagName>'
                        const loc = path.node.openingElement.loc;
                        const { end } = this.getIndices(loc);
                        const tagName = element.tagName;
                        // Expecting ... /> at end
                        newContent = this.content.substring(0, end - 2) + '>' + newText + `</${tagName}>` + this.content.substring(end);
                        editApplied = true;
                    }
                }
            }
        });

        return newContent;
    }

    /**
     * Apply a style change to an element
     */
    /**
     * Apply a style change to an element using AST
     */
    public applyStyleEdit(element: ParsedJSXElement, property: string, value: string): string {
        // Re-parse to get full AST with locations
        const ast = parser.parse(this.content, {
            sourceType: 'module',
            plugins: ['jsx', ...(this.isTypeScript ? ['typescript'] as const : [])],
        });

        let newContent = this.content;
        let editApplied = false;

        traverse(ast, {
            JSXElement: (path) => {
                if (editApplied) return;

                const openingElement = path.node.openingElement;

                if (this.isLocationMatch(path.node.loc, element.location)) {
                    // FOUND TARGET ELEMENT
                    const camelProp = this.toCamelCase(property);

                    const styleAttr = openingElement.attributes.find(
                        attr => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'style'
                    ) as t.JSXAttribute;

                    if (styleAttr) {
                        // Update existing style
                        if (t.isJSXExpressionContainer(styleAttr.value) && t.isObjectExpression(styleAttr.value.expression)) {
                            const properties = styleAttr.value.expression.properties;
                            const existingProp = properties.find(
                                p => t.isObjectProperty(p) && t.isIdentifier(p.key) && p.key.name === camelProp
                            ) as t.ObjectProperty;

                            if (existingProp && t.isObjectProperty(existingProp) && existingProp.value && existingProp.value.loc) {
                                // Replace value
                                const valLoc = existingProp.value.loc; // Use value location
                                const { start, end } = this.getIndices(valLoc);
                                newContent = this.content.substring(0, start) + `'${value}'` + this.content.substring(end);
                            } else if (styleAttr.value && styleAttr.value.expression && styleAttr.value.expression.loc) {
                                // Add new property
                                // Insert before closing brace '}'
                                const { end } = this.getIndices(styleAttr.value.expression.loc);

                                // Safe insertion point: last property end, or just before '}'
                                const insertPos = end - 1; // Before '}'
                                const prefix = properties.length > 0 ? ', ' : ' ';
                                newContent = this.content.substring(0, insertPos) + `${prefix}${camelProp}: '${value}'` + this.content.substring(insertPos);
                            }
                        }
                        editApplied = true;
                    } else if (openingElement.loc) {
                        // Add new style attribute
                        const { end } = this.getIndices(openingElement.loc);
                        // Find index of '>' or '/>'
                        const tagEnd = this.content.substring(end - 2, end);
                        const closingLength = tagEnd.endsWith('/>') ? 2 : 1;

                        const insertPos = end - closingLength;
                        newContent = this.content.substring(0, insertPos) + ` style={{ ${camelProp}: '${value}' }}` + this.content.substring(insertPos);
                        editApplied = true;
                    }
                }
            }
        });

        return newContent;
    }

    private isLocationMatch(nodeLoc: t.SourceLocation | null | undefined, targetLoc: JSXElementLocation): boolean {
        if (!nodeLoc) return false;
        return nodeLoc.start.line === targetLoc.startLine &&
            nodeLoc.start.column === targetLoc.startColumn;
        // End might vary slightly due to whitespace handling in parser, start is reliable
    }

    private buildPathFromStack(stack: string[], tagName: string, attribs: Record<string, any>): string {
        // Dummy implementation if we switch to location matching
        return '';
    }

    /**
     * Apply a className change to an element
     */
    /**
     * Apply a className change to an element using strict AST traversal
     */
    public applyClassNameEdit(element: ParsedJSXElement, className: string, add: boolean = true): string {
        // Parse again to get fresh AST
        const ast = parser.parse(this.content, {
            sourceType: 'module',
            plugins: [
                'jsx',
                ...(this.isTypeScript ? ['typescript'] as const : []),
            ],
            tokens: true
        });

        let newContent = this.content;
        let editApplied = false;

        traverse(ast, {
            JSXOpeningElement: (path) => {
                if (editApplied) return;

                const node = path.node;
                if (this.isLocationMatch(node.loc, element.location)) {
                    // Found the element
                    const classNameAttr = node.attributes.find(attr =>
                        t.isJSXAttribute(attr) &&
                        t.isJSXIdentifier(attr.name) &&
                        attr.name.name === 'className'
                    ) as t.JSXAttribute | undefined;

                    if (classNameAttr) {
                        // Modify existing className
                        if (t.isStringLiteral(classNameAttr.value)) {
                            const currentClasses = classNameAttr.value.value.split(/\s+/).filter(Boolean);

                            if (add && !currentClasses.includes(className)) {
                                currentClasses.push(className);
                            } else if (!add) {
                                const index = currentClasses.indexOf(className);
                                if (index > -1) currentClasses.splice(index, 1);
                            }

                            // Use precise location replacement
                            if (classNameAttr.value.loc) {
                                const { start, end } = this.getIndices(classNameAttr.value.loc);
                                newContent =
                                    this.content.substring(0, start) +
                                    `"${currentClasses.join(' ')}"` +
                                    this.content.substring(end);
                            }
                        }
                    } else if (add) {
                        // Add new className attribute
                        // Insert before the end of the opening tag
                        // We need to find where to insert.
                        // If self-closing "/>", insert before "/". If ">", insert before ">".
                        // Using tokenizer or simple location logic from AST node end.

                        // Default to inserting at the end of attributes
                        if (node.loc) {
                            const { end } = this.getIndices(node.loc);
                            // Find the tag closing characters
                            const tagClosingMatch = this.content.substring(end - 2, end).match(/\/?>/);
                            const closingLength = tagClosingMatch ? tagClosingMatch[0].length : 1;
                            const insertPos = end - closingLength;

                            // Check if we need leading space
                            const needsSpace = !this.content[insertPos - 1].match(/\s/);
                            const insertStr = (needsSpace ? ' ' : '') + `className="${className}"`;

                            newContent =
                                this.content.substring(0, insertPos) +
                                insertStr +
                                this.content.substring(insertPos);
                        }
                    }
                    editApplied = true;
                }
            }
        });

        return newContent;
    }

    private getTagName(node: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName): string {
        if (t.isJSXIdentifier(node)) {
            return node.name;
        } else if (t.isJSXMemberExpression(node)) {
            return `${this.getTagName(node.object)}.${node.property.name}`;
        } else {
            return `${node.namespace.name}:${node.name.name}`;
        }
    }

    private extractAttributes(attrs: (t.JSXAttribute | t.JSXSpreadAttribute)[]): Record<string, any> {
        const result: Record<string, any> = {};

        for (const attr of attrs) {
            if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name)) {
                const name = attr.name.name;

                if (attr.value === null) {
                    result[name] = true;
                } else if (t.isStringLiteral(attr.value)) {
                    result[name] = attr.value.value;
                } else if (t.isJSXExpressionContainer(attr.value)) {
                    // Simplified - just store that it's an expression
                    result[name] = '[expression]';
                }
            }
        }

        return result;
    }

    private buildPath(stack: ParsedJSXElement[], tagName: string, attribs: Record<string, any>): string {
        const parts = stack.map(el => {
            let selector = el.tagName;
            if (el.attributes.id) selector = '#' + el.attributes.id;
            else if (el.attributes.className) {
                const cls = el.attributes.className.split(' ')[0];
                selector += '.' + cls;
            }
            return selector;
        });

        let current = tagName;
        if (attribs.id) current = '#' + attribs.id;
        else if (attribs.className) {
            const cls = attribs.className.split(' ')[0];
            current += '.' + cls;
        }
        parts.push(current);

        return parts.join(' > ');
    }

    // =========================================================================
    // AST-BASED EDITING METHODS (No Regex)
    // =========================================================================

    /**
     * Delete an element using precise AST location.
     */
    public deleteElement(element: ParsedJSXElement): string {
        const { start, end } = this.getIndices(element.location);

        // Remove the element content
        return this.content.substring(0, start) + this.content.substring(end);
    }

    /**
     * Duplicate an element using precise AST location.
     */
    public duplicateElement(element: ParsedJSXElement): string {
        const { start, end } = this.getIndices(element.location);
        const elementHtml = this.content.substring(start, end);

        // Simple duplication - insert after itself
        return this.content.substring(0, end) + '\n' + elementHtml + this.content.substring(end);
    }

    /**
     * Reorder an element to a specific index within its parent
     */
    public reorderElement(element: ParsedJSXElement, newIndex: number): string {
        const tree = this.parse();
        const parent = this.findParent(tree, element);
        if (!parent) return this.content;

        const siblings = [...parent.children];
        const oldIndex = siblings.findIndex(s =>
            s.location.startLine === element.location.startLine &&
            s.location.startColumn === element.location.startColumn
        );

        if (oldIndex === -1 || oldIndex === newIndex) return this.content;

        // Extract all sibling HTML fragments and their ranges
        const siblingRanges = siblings.map(s => this.getIndices(s.location));

        // Remove the element from its old position
        siblings.splice(oldIndex, 1);
        // Insert at new position
        siblings.splice(newIndex, 0, element);

        // Reconstruct the parent's content
        // This is tricky because we need to preserve whitespace/content between siblings.
        // For now, let's use a simpler approach: 
        // 1. Get the range of the entire child block (from start of first sibling to end of last)
        const firstSib = parent.children[0];
        const lastSib = parent.children[parent.children.length - 1];
        const blockStart = this.getIndices(firstSib.location).start;
        const blockEnd = this.getIndices(lastSib.location).end;

        // 2. Map the new siblings to their original HTML
        const newChildContent = siblings.map(s => {
            const range = this.getIndices(s.location);
            return this.content.substring(range.start, range.end);
        }).join('\n  '); // Add some basic formatting

        return this.content.substring(0, blockStart) + newChildContent + this.content.substring(blockEnd);
    }

    public findParent(elements: ParsedJSXElement[], target: ParsedJSXElement): ParsedJSXElement | null {
        for (const el of elements) {
            if (el.children.some(child =>
                child.location.startLine === target.location.startLine &&
                child.location.startColumn === target.location.startColumn
            )) {
                return el;
            }
            const found = this.findParent(el.children, target);
            if (found) return found;
        }
        return null;
    }

    /**
     * Helper to convert 1-based line/column to 0-based string index
     */
    private getIndices(loc: JSXElementLocation | t.SourceLocation): { start: number, end: number } {
        const lines = this.content.split('\n');
        let startIndex = 0;
        let endIndex = 0;

        const startLine = 'startLine' in loc ? loc.startLine : loc.start.line;
        const startColumn = 'startColumn' in loc ? loc.startColumn : loc.start.column;
        const endLine = 'endLine' in loc ? loc.endLine : loc.end.line;
        const endColumn = 'endColumn' in loc ? loc.endColumn : loc.end.column;

        // Calculate start index
        for (let i = 0; i < startLine - 1; i++) {
            startIndex += lines[i].length + 1; // +1 for \n
        }
        startIndex += startColumn;

        // Calculate end index
        for (let i = 0; i < endLine - 1; i++) {
            endIndex += lines[i].length + 1;
        }
        endIndex += endColumn;

        return { start: startIndex, end: endIndex };
    }
    /**
     * Helper to convert kebab-case CSS properties to camelCase
     */
    private toCamelCase(str: string): string {
        return str.replace(/-([a-z])/g, function (g) { return g[1].toUpperCase(); });
    }
}
