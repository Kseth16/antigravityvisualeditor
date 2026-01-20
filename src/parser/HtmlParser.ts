import * as htmlparser2 from 'htmlparser2';
import * as vscode from 'vscode';

export interface ElementLocation {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    startOffset: number;
    endOffset: number;
}

export interface ParsedElement {
    tagName: string;
    attributes: Record<string, string>;
    location: ElementLocation;
    children: ParsedElement[];
    textContent?: string;
    path: string;
}

/**
 * Parses HTML content and provides utilities for finding and modifying elements
 */
export class HtmlParser {
    private content: string;
    private lines: string[];

    constructor(content: string) {
        this.content = content;
        this.lines = content.split('\n');
    }

    /**
     * Parse the HTML and return a tree of elements with locations
     */
    public parse(): ParsedElement[] {
        const elements: ParsedElement[] = [];
        const stack: ParsedElement[] = [];
        let currentOffset = 0;

        const parser = new htmlparser2.Parser({
            onopentag: (name, attribs) => {
                const startOffset = parser.startIndex;
                const location = this.offsetToLocation(startOffset);

                const element: ParsedElement = {
                    tagName: name,
                    attributes: attribs,
                    location: {
                        startLine: location.line,
                        startColumn: location.column,
                        endLine: 0,
                        endColumn: 0,
                        startOffset,
                        endOffset: 0,
                    },
                    children: [],
                    path: this.buildPath(stack, name, attribs),
                };

                if (stack.length > 0) {
                    stack[stack.length - 1].children.push(element);
                } else {
                    elements.push(element);
                }
                stack.push(element);
            },
            ontext: (text) => {
                if (stack.length > 0 && text.trim()) {
                    stack[stack.length - 1].textContent = text;
                }
            },
            onclosetag: (name) => {
                if (stack.length > 0) {
                    const element = stack.pop()!;
                    const endOffset = parser.endIndex! + 1;
                    const location = this.offsetToLocation(endOffset);
                    element.location.endLine = location.line;
                    element.location.endColumn = location.column;
                    element.location.endOffset = endOffset;
                }
            },
        }, { decodeEntities: true });

        parser.write(this.content);
        parser.end();

        return elements;
    }

    /**
     * Find an element by its CSS selector path
     */
    public findElementByPath(path: string): ParsedElement | null {
        const elements = this.parse();
        return this.searchByPath(elements, path);
    }

    private searchByPath(elements: ParsedElement[], path: string): ParsedElement | null {
        for (const el of elements) {
            if (el.path === path) return el;
            if (el.children.length > 0) {
                const found = this.searchByPath(el.children, path);
                if (found) return found;
            }
        }
        return null;
    }

    /**
     * Find element containing a specific text
     */
    public findElementByText(text: string): ParsedElement | null {
        const elements = this.parse();
        return this.searchByText(elements, text);
    }

    private searchByText(elements: ParsedElement[], text: string): ParsedElement | null {
        for (const el of elements) {
            if (el.textContent?.includes(text)) return el;
            if (el.children.length > 0) {
                const found = this.searchByText(el.children, text);
                if (found) return found;
            }
        }
        return null;
    }

    /**
     * Apply a text edit to an element using strict offsets
     */
    public applyTextEdit(element: ParsedElement, newText: string): string {
        const startOffset = element.location.startOffset;
        const endOffset = element.location.endOffset;

        // Find the end of the opening tag
        let openTagEnd = this.content.indexOf('>', startOffset);
        if (openTagEnd === -1) return this.content;

        // Check if self-closing or void
        if (this.content[openTagEnd - 1] === '/') {
            // It's self-closing <tag />. Convert to <tag>text</tag>
            // This is complex because we need to know the tag name to close it.
            // But usually we just replace content of existing elements.
            // For now, if self-closing, we change <tag /> to <tag>newText</tag>
            const openTag = this.content.substring(startOffset, openTagEnd + 1);
            const newOpenTag = openTag.replace('/>', '>');
            return this.content.substring(0, startOffset) +
                newOpenTag + newText + `</${element.tagName}>` +
                this.content.substring(openTagEnd + 1);
        }

        // It has a closing tag. Find the start of the closing tag.
        // We look backwards from endOffset.
        // element.location.endOffset marks the end of the closing tag </tag> (exclusive or inclusive? htmlparser2 usually provides endIndex inclusive).
        // Let's verify usage. In `onclosetag`: `const endOffset = parser.endIndex! + 1;` -> This is exclusive index for substring.

        let closeTagStart = this.content.lastIndexOf('<', endOffset - 1);

        if (closeTagStart <= openTagEnd) {
            // weird case, maybe <div ></div> with no content, closeTagStart should be > openTagEnd
            // If they are adjacent (empty content) <tag></tag>
            // openTagEnd is index of first >. closeTagStart is index of < of </tag>.
            return this.content.substring(0, openTagEnd + 1) + newText + this.content.substring(closeTagStart);
        }

        return this.content.substring(0, openTagEnd + 1) + newText + this.content.substring(closeTagStart);
    }

    /**
     * Apply a style change to an element using strict offsets
     */
    public applyStyleEdit(element: ParsedElement, property: string, value: string): string {
        const startOffset = element.location.startOffset;

        // Find the end of the opening tag
        let openTagEnd = this.content.indexOf('>', startOffset);
        if (openTagEnd === -1) return this.content;

        const openTag = this.content.substring(startOffset, openTagEnd + 1);

        // Tokenize attributes manually to find style
        // We search for style=...
        // We shouldn't use a global regex on the tag because it might match inside other attributes (unlikely for style, but possible).
        // Simple robust approach for style attribute:

        const styleRegex = /style\s*=\s*(["'])(.*?)\1/i;
        const match = openTag.match(styleRegex);

        const cssProperty = this.camelToKebab(property);
        const newStyleDecl = `${cssProperty}: ${value}`;

        if (match) {
            // Update existing style
            const existingStyle = match[2];
            const quote = match[1];

            // Check if property exists
            const propRegex = new RegExp(`${cssProperty}\\s*:\\s*[^;]+;?`, 'i');
            let newStyle: string;

            if (propRegex.test(existingStyle)) {
                newStyle = existingStyle.replace(propRegex, `${newStyleDecl};`);
            } else {
                newStyle = existingStyle.trim();
                if (newStyle && !newStyle.endsWith(';')) newStyle += '; ';
                newStyle += newStyleDecl + ';';
            }

            // Replace the style attribute value in the opening tag
            // We replace using the match index relative to openTag
            const newOpenTag = openTag.substring(0, match.index!) +
                `style=${quote}${newStyle}${quote}` +
                openTag.substring(match.index! + match[0].length);

            return this.content.substring(0, startOffset) + newOpenTag + this.content.substring(openTagEnd + 1);
        } else {
            // Add new style attribute
            // Insert before the closing > or />
            let insertPos = openTag.length - 1;
            if (openTag.endsWith('/>')) insertPos--;

            const needsSpace = !/\s/.test(openTag[insertPos - 1]);
            const insertStr = (needsSpace ? ' ' : '') + `style="${newStyleDecl};"`;

            const newOpenTag = openTag.substring(0, insertPos) + insertStr + openTag.substring(insertPos);
            return this.content.substring(0, startOffset) + newOpenTag + this.content.substring(openTagEnd + 1);
        }
    }

    /**
     * Move an element to a new position
     */
    public moveElement(element: ParsedElement, newParentPath: string, newIndex: number): string {
        // Extract the element HTML
        const elementHtml = this.content.substring(
            element.location.startOffset,
            element.location.endOffset
        );

        // Remove from current position
        let newContent =
            this.content.substring(0, element.location.startOffset) +
            this.content.substring(element.location.endOffset);

        // Find new parent and insert
        const newParser = new HtmlParser(newContent);
        const newParent = newParser.findElementByPath(newParentPath);

        if (newParent) {
            // Insert at new position (simplified - inserts at end of parent)
            const insertPos = newParent.location.endOffset - `</${newParent.tagName}>`.length - 1;
            newContent =
                newContent.substring(0, insertPos) +
                '\n' + elementHtml +
                newContent.substring(insertPos);
        }

        return newContent;
    }

    private offsetToLocation(offset: number): { line: number; column: number } {
        let line = 1;
        let column = 1;

        for (let i = 0; i < offset && i < this.content.length; i++) {
            if (this.content[i] === '\n') {
                line++;
                column = 1;
            } else {
                column++;
            }
        }

        return { line, column };
    }

    private buildPath(stack: ParsedElement[], tagName: string, attribs: Record<string, string>): string {
        const parts = stack.map(el => {
            let selector = el.tagName;
            if (el.attributes.id) selector = '#' + el.attributes.id;
            else if (el.attributes.class) selector += '.' + el.attributes.class.split(' ')[0];
            return selector;
        });

        let current = tagName;
        if (attribs.id) current = '#' + attribs.id;
        else if (attribs.class) current += '.' + attribs.class.split(' ')[0];
        parts.push(current);

        return parts.join(' > ');
    }

    private camelToKebab(str: string): string {
        return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
