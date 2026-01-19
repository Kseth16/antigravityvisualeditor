import * as vscode from 'vscode';
import { HtmlParser } from '../parser/HtmlParser';
import { ReactParser } from '../parser/ReactParser';
import { SelectedElement } from '../agent/AgentContext';
import { DiffPreviewProvider } from '../diff/DiffPreviewProvider';
import { deleteElementById, duplicateElementById } from '../parser/ASTParser';

/**
 * CodeSync handles bi-directional synchronization between visual edits and source code
 * This version uses more direct text manipulation for reliability
 */
export class CodeSync {

    /**
     * Apply a text edit from the visual editor to the source code
     */
    public static async applyTextEdit(
        document: vscode.TextDocument,
        elementPath: string,
        newText: string
    ): Promise<boolean> {
        console.log('[CodeSync] applyTextEdit:', { elementPath, newText });

        const content = document.getText();

        // Extract tag name and identifiers from path
        const pathInfo = this.parseElementPath(elementPath);
        console.log('[CodeSync] Parsed path:', pathInfo);

        if (!pathInfo) {
            vscode.window.showErrorMessage('Could not parse element path');
            return false;
        }

        // Find the element in the content using regex
        const elementRegex = this.buildElementRegex(pathInfo);
        const match = content.match(elementRegex);

        if (!match) {
            // Try simpler approach: find by tag name
            const simpleResult = await this.simpleTextReplace(document, pathInfo.tagName, newText);
            return simpleResult;
        }

        // Replace the text content between tags
        const startTag = match[0];
        const startIndex = content.indexOf(startTag);
        const closeTag = `</${pathInfo.tagName}>`;
        const closeIndex = content.indexOf(closeTag, startIndex + startTag.length);

        if (closeIndex === -1) {
            vscode.window.showErrorMessage('Could not find closing tag');
            return false;
        }

        const newContent =
            content.substring(0, startIndex + startTag.length) +
            newText +
            content.substring(closeIndex);

        return await this.applyEdit(document, content, newContent, 'Text Edit');
    }

    /**
     * Simple text replacement for first matching element
     */
    private static async simpleTextReplace(
        document: vscode.TextDocument,
        tagName: string,
        newText: string
    ): Promise<boolean> {
        const content = document.getText();

        // Match <tagName...>content</tagName>
        const regex = new RegExp(`(<${tagName}[^>]*>)([^<]*)(</${tagName}>)`, 'i');
        const match = content.match(regex);

        if (!match) {
            vscode.window.showErrorMessage(`Could not find <${tagName}> element`);
            return false;
        }

        const newContent = content.replace(regex, `$1${newText}$3`);
        return await this.applyEdit(document, content, newContent, 'Text Edit');
    }

    /**
     * Apply a style change from the visual editor to the source code
     */
    public static async applyStyleEdit(
        document: vscode.TextDocument,
        elementPath: string,
        property: string,
        value: string
    ): Promise<boolean> {
        console.log('[CodeSync] applyStyleEdit:', { elementPath, property, value });

        const content = document.getText();
        const pathInfo = this.parseElementPath(elementPath);

        if (!pathInfo) {
            vscode.window.showErrorMessage('Could not parse element path');
            return false;
        }

        // Convert camelCase to kebab-case for CSS
        const cssProperty = property.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

        // Find the element's opening tag
        let tagRegex: RegExp;
        if (pathInfo.id) {
            tagRegex = new RegExp(`<${pathInfo.tagName}[^>]*id=["']${pathInfo.id}["'][^>]*>`, 'i');
        } else if (pathInfo.className) {
            tagRegex = new RegExp(`<${pathInfo.tagName}[^>]*class=["'][^"']*${pathInfo.className}[^"']*["'][^>]*>`, 'i');
        } else {
            tagRegex = new RegExp(`<${pathInfo.tagName}[^>]*>`, 'i');
        }

        const match = content.match(tagRegex);
        if (!match) {
            vscode.window.showErrorMessage(`Could not find <${pathInfo.tagName}> element`);
            return false;
        }

        const openingTag = match[0];
        let newOpeningTag: string;

        // Check if element already has a style attribute
        const styleMatch = openingTag.match(/style=["']([^"']*)["']/);

        if (styleMatch) {
            // Update existing style
            const existingStyle = styleMatch[1];
            const propRegex = new RegExp(`${cssProperty}\\s*:\\s*[^;]+;?`, 'g');

            let newStyle: string;
            if (existingStyle.match(propRegex)) {
                newStyle = existingStyle.replace(propRegex, `${cssProperty}: ${value};`);
            } else {
                newStyle = existingStyle.endsWith(';')
                    ? `${existingStyle} ${cssProperty}: ${value};`
                    : `${existingStyle}; ${cssProperty}: ${value};`;
            }

            newOpeningTag = openingTag.replace(/style=["'][^"']*["']/, `style="${newStyle}"`);
        } else {
            // Add new style attribute before the closing >
            newOpeningTag = openingTag.replace(/>$/, ` style="${cssProperty}: ${value};">`);
        }

        const newContent = content.replace(openingTag, newOpeningTag);
        return await this.applyEdit(document, content, newContent, `Style: ${cssProperty}`);
    }

    /**
     * Apply an element move from the visual editor to the source code
     */
    /**
     * Sanitize element path by removing preview-specific prefixes
     * The webview wraps content in #preview-content which doesn't exist in source
     */
    private static sanitizePath(path: string): string {
        // Remove #preview-content prefix if present
        const previewPrefixes = ['#preview-content > ', '#preview-content>'];
        for (const prefix of previewPrefixes) {
            if (path.startsWith(prefix)) {
                return path.substring(prefix.length);
            }
        }
        return path;
    }

    /**
     * Find an element by its source line number (from data-ag-line attribute).
     * This is the reliable way to locate elements - much better than CSS path matching.
     * Returns the element bounds { start, end } or null if not found.
     */
    private static findElementByLine(content: string, lineNumber: number): {
        start: number;
        end: number;
        lineContent: string;
    } | null {
        if (!lineNumber || lineNumber < 1) {
            console.log('[CodeSync] findElementByLine: Invalid line number:', lineNumber);
            return null;
        }

        console.log('[CodeSync] findElementByLine:', lineNumber);

        const lines = content.split('\n');
        if (lineNumber > lines.length) {
            console.log('[CodeSync] findElementByLine: Line number exceeds file length');
            return null;
        }

        // Calculate the character offset for this line
        let charOffset = 0;
        for (let i = 0; i < lineNumber - 1; i++) {
            charOffset += lines[i].length + 1; // +1 for newline
        }

        const targetLine = lines[lineNumber - 1];
        console.log('[CodeSync] Found line content:', targetLine.substring(0, 100));

        // Find the opening tag on this line
        const openTagMatch = targetLine.match(/<([a-zA-Z][a-zA-Z0-9]*)[^>]*>/);
        if (!openTagMatch) {
            console.log('[CodeSync] No opening tag found on line');
            return null;
        }

        const tagName = openTagMatch[1].toLowerCase();
        const tagStartInLine = targetLine.indexOf(openTagMatch[0]);
        const elementStart = charOffset + tagStartInLine;

        console.log('[CodeSync] Found tag:', tagName, 'at position:', elementStart);

        // Now find the matching closing tag
        const searchContent = content.substring(elementStart);
        const openTag = openTagMatch[0];
        const openTagEnd = elementStart + openTag.length;

        // Check if it's self-closing
        const selfClosingTags = ['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr'];
        if (openTag.endsWith('/>') || selfClosingTags.includes(tagName)) {
            return {
                start: elementStart,
                end: openTagEnd,
                lineContent: targetLine
            };
        }

        // Find the matching closing tag
        const closeResult = this.findMatchingCloseTag(content, openTagEnd, tagName);
        if (!closeResult) {
            console.log('[CodeSync] Could not find closing tag for:', tagName);
            // If no closing tag, just return the opening tag line
            return {
                start: elementStart,
                end: charOffset + targetLine.length,
                lineContent: targetLine
            };
        }

        console.log('[CodeSync] Element bounds:', elementStart, '-', closeResult.end);
        return {
            start: elementStart,
            end: closeResult.end,
            lineContent: targetLine
        };
    }

    /**
     * Find an element in HTML content by traversing the full CSS path
     * Returns { start, end, openTagEnd } positions or null if not found
     */
    private static findElementByPath(content: string, path: string): {
        start: number;
        end: number;
        openTagEnd: number;
        closeTagStart: number;
    } | null {
        console.log('[CodeSync] findElementByPath:', path);

        const segments = path.split('>').map(s => s.trim()).filter(s => s.length > 0);
        console.log('[CodeSync] Path segments:', segments);

        // Find the body tag to start searching from there (for HTML files)
        // Or search within return statement for React files
        // Falls back to searching entire content if neither found
        let searchStart = 0;
        let searchEnd = content.length;

        // Try HTML body tag first
        const bodyMatch = content.match(/<body[^>]*>/i);
        if (bodyMatch && bodyMatch.index !== undefined) {
            searchStart = bodyMatch.index + bodyMatch[0].length;
            const bodyCloseMatch = content.match(/<\/body>/i);
            if (bodyCloseMatch && bodyCloseMatch.index !== undefined) {
                searchEnd = bodyCloseMatch.index;
            }
            console.log('[CodeSync] HTML file - searching within body tag:', searchStart, '-', searchEnd);
        } else {
            // Try React - find the main return statement with JSX
            // Look for return ( or return <
            const returnMatch = content.match(/return\s*\(\s*</);
            if (returnMatch && returnMatch.index !== undefined) {
                searchStart = returnMatch.index;
                // Find the matching closing of the return statement is complex,
                // so just search from return to end of file
                console.log('[CodeSync] React file - searching from return statement:', searchStart);
            } else {
                // Fallback: just search the entire content
                console.log('[CodeSync] No body/return found, searching entire content');
            }
        }

        let currentElementStart = searchStart;
        let currentElementEnd = searchEnd;
        let currentOpenTagEnd = searchStart;
        let currentCloseTagStart = searchEnd;

        for (let segIdx = 0; segIdx < segments.length; segIdx++) {
            const segment = segments[segIdx];
            const segmentInfo = this.parsePathSegment(segment);
            console.log('[CodeSync] Processing segment:', segment, '-> info:', segmentInfo);

            if (!segmentInfo) {
                console.log('[CodeSync] Failed to parse segment:', segment);
                return null;
            }

            // Find this element within the current search range
            const found = this.findElementInRange(
                content,
                searchStart,
                currentCloseTagStart,
                segmentInfo
            );

            if (!found) {
                console.log('[CodeSync] Element not found for segment:', segment, 'in range', searchStart, '-', currentCloseTagStart);
                return null;
            }

            console.log('[CodeSync] Found element for segment:', segment, 'at positions:', found);

            currentElementStart = found.start;
            currentElementEnd = found.end;
            currentOpenTagEnd = found.openTagEnd;
            currentCloseTagStart = found.closeTagStart;

            // For the next segment, search inside this element
            searchStart = currentOpenTagEnd;
        }

        return {
            start: currentElementStart,
            end: currentElementEnd,
            openTagEnd: currentOpenTagEnd,
            closeTagStart: currentCloseTagStart
        };
    }

    /**
     * Parse a single path segment like "div:nth-child(2)" or "#myId" or ".myClass"
     */
    private static parsePathSegment(segment: string): {
        tagName: string;
        id?: string;
        className?: string;
        nthChild?: number
    } | null {
        if (!segment) return null;

        let tagName = 'div'; // default
        let id: string | undefined;
        let className: string | undefined;
        let nthChild: number | undefined;

        // Check for id (#)
        const idMatch = segment.match(/#([^\.\:\s\[]+)/);
        if (idMatch) {
            id = idMatch[1];
        }

        // Check for class (.)
        const classMatch = segment.match(/\.([^\.\:\s\[]+)/);
        if (classMatch) {
            className = classMatch[1];
        }

        // Check for nth-child
        const nthMatch = segment.match(/:nth-child\((\d+)\)/);
        if (nthMatch) {
            nthChild = parseInt(nthMatch[1]);
        }

        // Extract tag name (must be at the start)
        const tagMatch = segment.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
        if (tagMatch) {
            tagName = tagMatch[1].toLowerCase();
        }

        return { tagName, id, className, nthChild };
    }

    /**
     * Find an element within a specific range of the content
     */
    private static findElementInRange(
        content: string,
        rangeStart: number,
        rangeEnd: number,
        info: { tagName: string; id?: string; className?: string; nthChild?: number }
    ): { start: number; end: number; openTagEnd: number; closeTagStart: number } | null {
        console.log('[CodeSync] findElementInRange:', { rangeStart, rangeEnd, info });

        // If we have an ID, find it directly (IDs should be unique)
        if (info.id) {
            const idRegex = new RegExp(`<${info.tagName}[^>]*id=["']${info.id}["'][^>]*>`, 'i');
            const searchContent = content.substring(rangeStart, rangeEnd);
            const match = searchContent.match(idRegex);

            if (match && match.index !== undefined) {
                const elementStart = rangeStart + match.index;
                const openTagEnd = elementStart + match[0].length;
                const closeResult = this.findMatchingCloseTag(content, openTagEnd, info.tagName);

                if (closeResult) {
                    return {
                        start: elementStart,
                        end: closeResult.end,
                        openTagEnd: openTagEnd,
                        closeTagStart: closeResult.start
                    };
                }
            }
            return null;
        }

        // Find by nth-child or first match
        const targetIndex = info.nthChild ? info.nthChild - 1 : 0; // nth-child is 1-indexed
        let foundCount = 0;
        let pos = rangeStart;
        let depth = 0;

        while (pos < rangeEnd) {
            // Find next tag
            const tagStart = content.indexOf('<', pos);
            if (tagStart === -1 || tagStart >= rangeEnd) break;

            // Skip comments
            if (content.substring(tagStart, tagStart + 4) === '<!--') {
                const commentEnd = content.indexOf('-->', tagStart);
                pos = commentEnd !== -1 ? commentEnd + 3 : rangeEnd;
                continue;
            }

            // Check if it's a closing tag
            if (content[tagStart + 1] === '/') {
                if (depth > 0) depth--;
                const closeEnd = content.indexOf('>', tagStart);
                pos = closeEnd !== -1 ? closeEnd + 1 : rangeEnd;
                continue;
            }

            // Get tag name
            const tagMatch = content.substring(tagStart).match(/^<([a-zA-Z][a-zA-Z0-9]*)/);
            if (!tagMatch) {
                pos = tagStart + 1;
                continue;
            }

            const foundTagName = tagMatch[1].toLowerCase();
            const openTagEndPos = content.indexOf('>', tagStart);

            if (openTagEndPos === -1) {
                pos = tagStart + 1;
                continue;
            }

            const openTag = content.substring(tagStart, openTagEndPos + 1);
            const isSelfClosing = openTag.endsWith('/>') ||
                ['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr']
                    .includes(foundTagName);

            // Only consider direct children (depth 0)
            if (depth === 0) {
                // Check if this matches our criteria
                let matches = foundTagName === info.tagName.toLowerCase();

                if (matches && info.className) {
                    matches = openTag.includes(info.className);
                }

                if (matches) {
                    if (foundCount === targetIndex) {
                        // Found it!
                        if (isSelfClosing) {
                            return {
                                start: tagStart,
                                end: openTagEndPos + 1,
                                openTagEnd: openTagEndPos + 1,
                                closeTagStart: openTagEndPos + 1
                            };
                        }

                        const closeResult = this.findMatchingCloseTag(content, openTagEndPos + 1, foundTagName);
                        if (closeResult) {
                            return {
                                start: tagStart,
                                end: closeResult.end,
                                openTagEnd: openTagEndPos + 1,
                                closeTagStart: closeResult.start
                            };
                        }
                    }
                    foundCount++;
                }
            }

            if (!isSelfClosing) {
                depth++;
            }
            pos = openTagEndPos + 1;
        }

        return null;
    }

    /**
     * Find the matching closing tag for an element
     */
    private static findMatchingCloseTag(
        content: string,
        searchStart: number,
        tagName: string
    ): { start: number; end: number } | null {
        let depth = 1;
        let pos = searchStart;
        const lowerTagName = tagName.toLowerCase();

        while (pos < content.length && depth > 0) {
            const tagStart = content.indexOf('<', pos);
            if (tagStart === -1) break;

            // Skip comments
            if (content.substring(tagStart, tagStart + 4) === '<!--') {
                const commentEnd = content.indexOf('-->', tagStart);
                pos = commentEnd !== -1 ? commentEnd + 3 : content.length;
                continue;
            }

            // Check if closing tag
            if (content[tagStart + 1] === '/') {
                const closeTagMatch = content.substring(tagStart).match(/^<\/([a-zA-Z][a-zA-Z0-9]*)\s*>/);
                if (closeTagMatch) {
                    const closeTagName = closeTagMatch[1].toLowerCase();
                    if (closeTagName === lowerTagName) {
                        depth--;
                        if (depth === 0) {
                            return {
                                start: tagStart,
                                end: tagStart + closeTagMatch[0].length
                            };
                        }
                    }
                    pos = tagStart + closeTagMatch[0].length;
                    continue;
                }
            } else {
                // Opening tag
                const openTagMatch = content.substring(tagStart).match(/^<([a-zA-Z][a-zA-Z0-9]*)/);
                if (openTagMatch) {
                    const openTagName = openTagMatch[1].toLowerCase();
                    const openTagEnd = content.indexOf('>', tagStart);

                    if (openTagEnd !== -1) {
                        const fullTag = content.substring(tagStart, openTagEnd + 1);
                        const isSelfClosing = fullTag.endsWith('/>') ||
                            ['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr']
                                .includes(openTagName);

                        if (!isSelfClosing && openTagName === lowerTagName) {
                            depth++;
                        }
                        pos = openTagEnd + 1;
                        continue;
                    }
                }
            }
            pos = tagStart + 1;
        }

        return null;
    }

    /**
     * Delete an element from the source code
     */
    public static async applyElementDelete(
        document: vscode.TextDocument,
        elementPath: string,
        agId?: string
    ): Promise<boolean> {
        console.log('[CodeSync] applyElementDelete:', { elementPath, agId });

        const content = document.getText();
        let newContent: string | null = null;

        // Priority 1: Use AST-based deletion (most reliable)
        if (agId) {
            newContent = deleteElementById(content, agId);
            if (newContent) {
                console.log('[CodeSync] Deleted element using AST ID:', agId);
            } else {
                console.log('[CodeSync] Failed to delete by ID, falling back to path');
            }
        }

        // Fallback: Use path-based deletion
        if (!newContent) {
            const cleanPath = this.sanitizePath(elementPath);
            console.log('[CodeSync] Falling back to path search:', cleanPath);
            const elementLocation = this.findElementByPath(content, cleanPath);

            if (elementLocation) {
                newContent = content.substring(0, elementLocation.start) +
                    content.substring(elementLocation.end);
            }
        }

        if (!newContent) {
            console.log('[CodeSync] Could not find element to delete');
            vscode.window.showErrorMessage('Could not find element to delete');
            return false;
        }

        return await this.applyEdit(document, content, newContent, 'Element Deleted');
    }

    /**
     * Duplicate an element in the source code
     */
    public static async applyElementDuplicate(
        document: vscode.TextDocument,
        elementPath: string,
        agId?: string
    ): Promise<boolean> {
        console.log('[CodeSync] applyElementDuplicate:', { elementPath, agId });

        const content = document.getText();
        let newContent: string | null = null;

        // Priority 1: Use AST-based duplication
        if (agId) {
            newContent = duplicateElementById(content, agId);
            if (newContent) {
                console.log('[CodeSync] Duplicated element using AST ID:', agId);
            } else {
                console.log('[CodeSync] Failed to duplicate by ID, falling back to path');
            }
        }

        // Fallback: path-based
        if (!newContent) {
            const cleanPath = this.sanitizePath(elementPath);
            console.log('[CodeSync] Falling back to path search:', cleanPath);
            const elementLocation = this.findElementByPath(content, cleanPath);

            if (elementLocation) {
                const elementContent = content.substring(elementLocation.start, elementLocation.end);
                newContent = content.substring(0, elementLocation.end) +
                    '\n' + elementContent +
                    content.substring(elementLocation.end);
            }
        }

        if (!newContent) {
            console.log('[CodeSync] Could not find element to duplicate');
            vscode.window.showErrorMessage('Could not find element to duplicate');
            return false;
        }

        return await this.applyEdit(document, content, newContent, 'Element Duplicated');
    }

    public static async applyElementMove(
        document: vscode.TextDocument,
        elementPath: string,
        newParentPath: string,
        newIndex: number
    ): Promise<boolean> {
        // Sanitize paths to remove preview-specific prefixes
        const cleanElementPath = this.sanitizePath(elementPath);
        const cleanParentPath = this.sanitizePath(newParentPath);

        console.log('[CodeSync] applyElementMove:', {
            originalElementPath: elementPath,
            originalParentPath: newParentPath,
            cleanElementPath,
            cleanParentPath,
            newIndex
        });

        const content = document.getText();

        // Use new path traversal to find the element
        const elementLocation = this.findElementByPath(content, cleanElementPath);
        if (!elementLocation) {
            console.log('[CodeSync] Could not find element by path:', cleanElementPath);
            vscode.window.showErrorMessage('Could not find element to move');
            return false;
        }

        console.log('[CodeSync] Found element at:', elementLocation);

        // Extract the element HTML
        const elementHtml = content.substring(elementLocation.start, elementLocation.end);
        console.log('[CodeSync] Element HTML length:', elementHtml.length);

        // Remove the element from current position
        let newContent = content.substring(0, elementLocation.start) +
            content.substring(elementLocation.end);

        // Find the parent element (in the modified content)
        const parentLocation = this.findElementByPath(newContent, cleanParentPath);
        if (!parentLocation) {
            console.log('[CodeSync] Could not find parent by path:', cleanParentPath);
            vscode.window.showErrorMessage('Could not find parent element');
            return false;
        }

        console.log('[CodeSync] Found parent at:', parentLocation);

        // Get the content inside the parent (between opening and closing tags)
        const parentInnerContent = newContent.substring(parentLocation.openTagEnd, parentLocation.closeTagStart);
        console.log('[CodeSync] Parent inner content length:', parentInnerContent.length);

        // Find direct child elements only (track nesting depth)
        const directChildPositions: number[] = [];
        let depth = 0;
        let i = 0;

        while (i < parentInnerContent.length) {
            if (parentInnerContent[i] === '<') {
                // Skip comments
                if (parentInnerContent.substring(i, i + 4) === '<!--') {
                    const commentEnd = parentInnerContent.indexOf('-->', i);
                    i = commentEnd !== -1 ? commentEnd + 3 : parentInnerContent.length;
                    continue;
                }

                // Check if it's a closing tag
                if (parentInnerContent[i + 1] === '/') {
                    if (depth > 0) depth--;
                    const closeEnd = parentInnerContent.indexOf('>', i);
                    i = closeEnd !== -1 ? closeEnd + 1 : parentInnerContent.length;
                    continue;
                }

                // It's an opening tag
                const tagMatch = parentInnerContent.substring(i).match(/^<([a-zA-Z][a-zA-Z0-9]*)/);
                if (tagMatch) {
                    const tagName = tagMatch[1].toLowerCase();

                    // Only record position if at depth 0 (direct child)
                    if (depth === 0) {
                        directChildPositions.push(i);
                    }

                    const tagEnd = parentInnerContent.indexOf('>', i);
                    if (tagEnd !== -1) {
                        const tagContent = parentInnerContent.substring(i, tagEnd + 1);
                        const isSelfClosing = tagContent.endsWith('/>') ||
                            ['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr']
                                .includes(tagName);

                        if (!isSelfClosing) {
                            depth++;
                        }
                        i = tagEnd + 1;
                        continue;
                    }
                }
            }
            i++;
        }

        console.log('[CodeSync] Direct child positions found:', directChildPositions.length, directChildPositions);
        console.log('[CodeSync] Requested newIndex:', newIndex);

        // Determine where to insert based on newIndex
        let insertPosition: number;

        if (newIndex <= 0 || directChildPositions.length === 0) {
            insertPosition = parentLocation.openTagEnd;
            console.log('[CodeSync] Inserting at BEGINNING, position:', insertPosition);
        } else if (newIndex >= directChildPositions.length) {
            insertPosition = parentLocation.closeTagStart;
            console.log('[CodeSync] Inserting at END, position:', insertPosition);
        } else {
            insertPosition = parentLocation.openTagEnd + directChildPositions[newIndex];
            console.log('[CodeSync] Inserting at index', newIndex, ', position:', insertPosition);
        }

        console.log('[CodeSync] Final insert position:', insertPosition,
            '| Parent open end:', parentLocation.openTagEnd,
            '| Parent close:', parentLocation.closeTagStart);

        // Insert the element at the calculated position
        newContent = newContent.substring(0, insertPosition) +
            '\n  ' + elementHtml +
            newContent.substring(insertPosition);

        return await this.applyEdit(document, content, newContent, 'Element Rearranged');
    }

    /**
     * Jump editor cursor to an element's source location
     */
    public static async jumpToElement(
        document: vscode.TextDocument,
        elementPath: string
    ): Promise<void> {
        const content = document.getText();
        const pathInfo = this.parseElementPath(elementPath);

        if (!pathInfo) return;

        // Find the element
        let tagRegex: RegExp;
        if (pathInfo.id) {
            tagRegex = new RegExp(`<${pathInfo.tagName}[^>]*id=["']${pathInfo.id}["']`, 'i');
        } else if (pathInfo.className) {
            tagRegex = new RegExp(`<${pathInfo.tagName}[^>]*class=["'][^"']*${pathInfo.className}`, 'i');
        } else {
            tagRegex = new RegExp(`<${pathInfo.tagName}`, 'i');
        }

        const match = content.match(tagRegex);
        if (!match || match.index === undefined) return;

        // Convert offset to position
        const position = document.positionAt(match.index);

        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.uri.toString() === document.uri.toString()) {
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter
            );
        }
    }

    /**
     * Get source location for an element (for agent context)
     */
    public static getElementSourceLocation(
        document: vscode.TextDocument,
        elementPath: string
    ): { file: string; line: number; column: number } | null {
        const content = document.getText();
        const pathInfo = this.parseElementPath(elementPath);

        if (!pathInfo) return null;

        let tagRegex: RegExp;
        if (pathInfo.id) {
            tagRegex = new RegExp(`<${pathInfo.tagName}[^>]*id=["']${pathInfo.id}["']`, 'i');
        } else if (pathInfo.className) {
            tagRegex = new RegExp(`<${pathInfo.tagName}[^>]*class=["'][^"']*${pathInfo.className}`, 'i');
        } else {
            tagRegex = new RegExp(`<${pathInfo.tagName}`, 'i');
        }

        const match = content.match(tagRegex);
        if (!match || match.index === undefined) return null;

        const position = document.positionAt(match.index);

        return {
            file: document.uri.fsPath,
            line: position.line + 1,
            column: position.character,
        };
    }

    /**
     * Parse an element path like "body > div.container > h1:nth-child(2)"
     */
    private static parseElementPath(path: string): { tagName: string; id?: string; className?: string; nthChild?: number } | null {
        if (!path) return null;

        // Get the last segment (the actual element)
        const segments = path.split('>').map(s => s.trim());
        const lastSegment = segments[segments.length - 1];

        // Parse tag name, id, class, nth-child
        let tagName = lastSegment;
        let id: string | undefined;
        let className: string | undefined;
        let nthChild: number | undefined;

        // Check for id (#)
        if (lastSegment.startsWith('#')) {
            const idMatch = lastSegment.match(/^#([^\.\:\s]+)/);
            if (idMatch) {
                id = idMatch[1];
                tagName = 'div'; // Default, might be refined
            }
        }

        // Check for class (.)
        const classMatch = lastSegment.match(/\.([^\.\:\s\[]+)/);
        if (classMatch) {
            className = classMatch[1];
        }

        // Check for nth-child
        const nthMatch = lastSegment.match(/:nth-child\((\d+)\)/);
        if (nthMatch) {
            nthChild = parseInt(nthMatch[1]);
        }

        // Extract tag name if present
        const tagMatch = lastSegment.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
        if (tagMatch) {
            tagName = tagMatch[1];
        }

        return { tagName, id, className, nthChild };
    }

    private static buildElementRegex(pathInfo: { tagName: string; id?: string; className?: string }): RegExp {
        if (pathInfo.id) {
            return new RegExp(`<${pathInfo.tagName}[^>]*id=["']${pathInfo.id}["'][^>]*>`, 'i');
        } else if (pathInfo.className) {
            return new RegExp(`<${pathInfo.tagName}[^>]*class=["'][^"']*${pathInfo.className}[^"']*["'][^>]*>`, 'i');
        } else {
            return new RegExp(`<${pathInfo.tagName}[^>]*>`, 'i');
        }
    }

    private static isReactFile(document: vscode.TextDocument): boolean {
        return ['javascriptreact', 'typescriptreact'].includes(document.languageId);
    }

    private static async applyEdit(
        document: vscode.TextDocument,
        oldContent: string,
        newContent: string,
        description: string = 'Visual Editor Change'
    ): Promise<boolean> {
        if (oldContent === newContent) {
            console.log('[CodeSync] No changes to apply');
            return false;
        }

        console.log('[CodeSync] Recording change for diff preview:', description);

        // Use the DiffPreviewProvider to record changes and show diff view
        const diffProvider = DiffPreviewProvider.getInstance();
        return await diffProvider.recordChange(document, newContent, description);
    }
}
