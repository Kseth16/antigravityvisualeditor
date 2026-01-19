import * as parser from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import * as t from '@babel/types';

export interface JSXElementLocation {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
}

export interface ParsedJSXElement {
    tagName: string;
    attributes: Record<string, any>;
    location: JSXElementLocation;
    children: ParsedJSXElement[];
    textContent?: string;
    path: string;
    isComponent: boolean;
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
                            path: this.buildPath(elementStack, tagName, this.extractAttributes(openingElement.attributes)),
                            isComponent,
                        };

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
     * Find an element by its path
     */
    public findElementByPath(path: string): ParsedJSXElement | null {
        const elements = this.parse();
        return this.searchByPath(elements, path);
    }

    private searchByPath(elements: ParsedJSXElement[], path: string): ParsedJSXElement | null {
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
     * Apply a text edit to an element
     */
    public applyTextEdit(element: ParsedJSXElement, newText: string): string {
        if (!element.textContent) return this.content;

        const lines = this.content.split('\n');

        // Find the text in the element's line range
        for (let i = element.location.startLine - 1; i < element.location.endLine; i++) {
            if (lines[i].includes(element.textContent)) {
                lines[i] = lines[i].replace(element.textContent, newText);
                break;
            }
        }

        return lines.join('\n');
    }

    /**
     * Apply a style change to an element
     */
    public applyStyleEdit(element: ParsedJSXElement, property: string, value: string): string {
        const lines = this.content.split('\n');
        const lineIndex = element.location.startLine - 1;
        let line = lines[lineIndex];

        // Check if element already has style prop
        const styleMatch = line.match(/style\s*=\s*\{\{([^}]*)\}\}/);

        if (styleMatch) {
            // Update existing style
            const existingStyle = styleMatch[1];
            const propRegex = new RegExp(`${property}\\s*:\\s*['"][^'"]*['"]`, 'g');

            let newStyle: string;
            if (existingStyle.match(propRegex)) {
                newStyle = existingStyle.replace(propRegex, `${property}: '${value}'`);
            } else {
                newStyle = `${existingStyle}, ${property}: '${value}'`;
            }

            lines[lineIndex] = line.replace(/style\s*=\s*\{\{[^}]*\}\}/, `style={{ ${newStyle} }}`);
        } else {
            // Add new style prop
            const tagEndMatch = line.match(/<(\w+)([^>]*)(\/?>)/);
            if (tagEndMatch) {
                const [full, tag, attrs, close] = tagEndMatch;
                const newTag = `<${tag}${attrs} style={{ ${property}: '${value}' }}${close}`;
                lines[lineIndex] = line.replace(full, newTag);
            }
        }

        return lines.join('\n');
    }

    /**
     * Apply a className change to an element
     */
    public applyClassNameEdit(element: ParsedJSXElement, className: string, add: boolean = true): string {
        const lines = this.content.split('\n');
        const lineIndex = element.location.startLine - 1;
        let line = lines[lineIndex];

        const classMatch = line.match(/className\s*=\s*["']([^"']*)["']/);

        if (classMatch) {
            const existingClasses = classMatch[1].split(' ');

            if (add && !existingClasses.includes(className)) {
                existingClasses.push(className);
            } else if (!add) {
                const index = existingClasses.indexOf(className);
                if (index > -1) existingClasses.splice(index, 1);
            }

            lines[lineIndex] = line.replace(
                /className\s*=\s*["'][^"']*["']/,
                `className="${existingClasses.join(' ')}"`
            );
        } else if (add) {
            // Add new className prop
            const tagEndMatch = line.match(/<(\w+)([^>]*)(\/?>)/);
            if (tagEndMatch) {
                const [full, tag, attrs, close] = tagEndMatch;
                lines[lineIndex] = line.replace(full, `<${tag}${attrs} className="${className}"${close}`);
            }
        }

        return lines.join('\n');
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
}
