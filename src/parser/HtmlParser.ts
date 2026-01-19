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
     * Apply a text edit to an element
     */
    public applyTextEdit(element: ParsedElement, newText: string): string {
        if (!element.textContent) return this.content;

        const lines = this.content.split('\n');
        const line = lines[element.location.startLine - 1];

        // Find and replace the text content
        const regex = new RegExp(`(>)([^<]*)(${this.escapeRegex(element.textContent)})([^<]*)(<)`, 'g');
        lines[element.location.startLine - 1] = line.replace(regex, `$1$2${newText}$4$5`);

        return lines.join('\n');
    }

    /**
     * Apply a style change to an element
     */
    public applyStyleEdit(element: ParsedElement, property: string, value: string): string {
        const lines = this.content.split('\n');
        const startLine = element.location.startLine - 1;

        // Get the opening tag
        let tagContent = '';
        let endLine = startLine;

        for (let i = startLine; i < lines.length; i++) {
            tagContent += lines[i];
            if (tagContent.includes('>')) {
                endLine = i;
                break;
            }
            tagContent += '\n';
        }

        // Parse existing style attribute
        const styleMatch = tagContent.match(/style\s*=\s*["']([^"']*)["']/);
        const existingStyle = styleMatch ? styleMatch[1] : '';

        // Update or add the property
        const cssProperty = this.camelToKebab(property);
        const styleRegex = new RegExp(`${cssProperty}\\s*:\\s*[^;]+;?`, 'g');

        let newStyle: string;
        if (existingStyle.match(styleRegex)) {
            newStyle = existingStyle.replace(styleRegex, `${cssProperty}: ${value};`);
        } else {
            newStyle = existingStyle ? `${existingStyle}; ${cssProperty}: ${value}` : `${cssProperty}: ${value}`;
        }

        // Apply the style
        let newTagContent: string;
        if (styleMatch) {
            newTagContent = tagContent.replace(/style\s*=\s*["'][^"']*["']/, `style="${newStyle}"`);
        } else {
            newTagContent = tagContent.replace(/>/, ` style="${newStyle}">`);
        }

        // Reconstruct content
        const beforeTag = lines.slice(0, startLine).join('\n');
        const afterTag = lines.slice(endLine + 1).join('\n');

        return beforeTag + (beforeTag ? '\n' : '') + newTagContent + (afterTag ? '\n' : '') + afterTag;
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
