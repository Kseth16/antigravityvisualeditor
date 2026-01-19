import * as vscode from 'vscode';
import { AgentContext, SelectedElement } from './AgentContext';

/**
 * Provides context variables for the Antigravity AI agent
 * These are accessible through VS Code's context system
 */
export class ContextProvider {
    private _context: vscode.ExtensionContext;
    private _agentContext: AgentContext;
    private _statusBarItem: vscode.StatusBarItem;

    constructor(context: vscode.ExtensionContext, agentContext: AgentContext) {
        this._context = context;
        this._agentContext = agentContext;

        // Create status bar item to show selected element
        this._statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this._statusBarItem.tooltip = 'Click to open Visual Editor';
        this._statusBarItem.command = 'antigravity.openPreview';
        context.subscriptions.push(this._statusBarItem);

        // Listen for selection changes
        this._agentContext.onSelectionChange((element) => {
            this._updateContext(element);
            this._updateStatusBar(element);
        });

        this._initializeContext();
    }

    private _initializeContext(): void {
        // Set initial context values
        vscode.commands.executeCommand('setContext', 'antigravity.hasSelection', false);
        vscode.commands.executeCommand('setContext', 'antigravity.selectedTag', '');
        vscode.commands.executeCommand('setContext', 'antigravity.isVisualEditorOpen', false);
    }

    private _updateContext(element: SelectedElement | null): void {
        // Update VS Code context for when-clauses and agent access
        vscode.commands.executeCommand(
            'setContext',
            'antigravity.hasSelection',
            element !== null
        );

        if (element) {
            vscode.commands.executeCommand(
                'setContext',
                'antigravity.selectedTag',
                element.tagName.toLowerCase()
            );

            // Store detailed element data in workspace state
            this._context.workspaceState.update('antigravity.element', {
                tagName: element.tagName,
                id: element.id,
                className: element.className,
                path: element.path,
                styles: element.styles,
                textContent: element.textContent?.substring(0, 100),
                sourceLocation: element.sourceLocation,
            });

            // Store a simple description for quick access
            this._context.workspaceState.update(
                'antigravity.elementDescription',
                this._agentContext.getElementDescription()
            );
        } else {
            this._context.workspaceState.update('antigravity.element', null);
            this._context.workspaceState.update('antigravity.elementDescription', null);
        }
    }

    private _updateStatusBar(element: SelectedElement | null): void {
        if (element) {
            const tag = element.tagName.toLowerCase();
            const id = element.id ? `#${element.id}` : '';
            const cls = element.className ? `.${element.className.split(' ')[0]}` : '';

            this._statusBarItem.text = `$(symbol-class) ${tag}${id}${cls}`;
            this._statusBarItem.show();
        } else {
            this._statusBarItem.text = '$(eye) Visual Editor';
            this._statusBarItem.show();
        }
    }

    public setVisualEditorOpen(isOpen: boolean): void {
        vscode.commands.executeCommand('setContext', 'antigravity.isVisualEditorOpen', isOpen);

        if (isOpen) {
            this._statusBarItem.text = '$(eye) Visual Editor Active';
        } else {
            this._statusBarItem.text = '$(eye) Visual Editor';
        }
    }

    /**
     * Get a formatted description suitable for passing to the AI agent
     */
    public getFormattedContext(): string {
        const element = this._agentContext.selectedElement;

        if (!element) {
            return `
[Visual Editor Context]
No element is currently selected.
To select an element, tell the user to:
1. Open an HTML or React file
2. Press Ctrl+Shift+V to open Visual Editor
3. Click on any element in the preview
`;
        }

        const styles = element.styles;
        const importantStyles = ['color', 'backgroundColor', 'fontSize', 'fontWeight', 'padding', 'margin', 'display'];
        const styleList = importantStyles
            .filter(s => styles[s])
            .map(s => `  ${s}: ${styles[s]}`)
            .join('\n');

        return `
[Visual Editor Context]
Selected Element: <${element.tagName.toLowerCase()}${element.id ? ` id="${element.id}"` : ''}${element.className ? ` class="${element.className}"` : ''}>
${element.textContent ? `Text: "${element.textContent.substring(0, 50)}${element.textContent.length > 50 ? '...' : ''}"` : ''}
${element.sourceLocation ? `File: ${element.sourceLocation.file}:${element.sourceLocation.line}` : ''}

Current Styles:
${styleList || '  (no relevant styles set)'}

Available Commands:
- antigravity.applyStyle(property, value) - Change a CSS property
- antigravity.applyText(newText) - Change the text content
- antigravity.duplicateElement() - Duplicate the element
- antigravity.deleteElement() - Delete the element

Example: To make this element blue, use: antigravity.applyStyle("color", "blue")
`;
    }
}
