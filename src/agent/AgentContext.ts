import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface SelectedElement {
    // Element identification
    tagName: string;
    id?: string;
    className?: string;
    path: string; // CSS selector path to element

    // Source code location
    sourceLocation?: {
        file: string;
        line: number;
        column: number;
    };

    // Element content
    textContent?: string;
    innerHTML?: string;

    // Computed styles
    styles: Record<string, string>;

    // Layout info
    rect?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };

    // Parent chain for context
    parentChain?: string[];
}

export interface AgentContextData {
    hasSelection: boolean;
    selectedElement: SelectedElement | null;
    currentFile: string | null;
    timestamp: number;
}

/**
 * AgentContext provides context about the currently selected element
 * to the Antigravity AI agent. 
 * 
 * It writes to a .antigravity-context.json file that Antigravity can read.
 */
export class AgentContext {
    private _context: vscode.ExtensionContext;
    private _selectedElement: SelectedElement | null = null;
    private _currentFile: string | null = null;
    private _onSelectionChange = new vscode.EventEmitter<SelectedElement | null>();
    private _contextFilePath: string | null = null;

    public readonly onSelectionChange = this._onSelectionChange.event;

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
        this._registerContextVariables();
        this._initContextFile();
    }

    private _initContextFile(): void {
        // Create context file in workspace root
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            this._contextFilePath = path.join(workspaceFolders[0].uri.fsPath, '.antigravity-context.json');
            this._writeContextFile();
        }
    }

    private _registerContextVariables(): void {
        vscode.commands.executeCommand(
            'setContext',
            'antigravity.hasElementSelection',
            false
        );
    }

    public setSelectedElement(element: SelectedElement | null): void {
        this._selectedElement = element;

        // Update VS Code context
        vscode.commands.executeCommand(
            'setContext',
            'antigravity.hasElementSelection',
            element !== null
        );

        // Store in workspace state for agent access
        this._context.workspaceState.update('antigravity.selectedElement', element);

        // Write to file so Antigravity can read it
        this._writeContextFile();

        // Also write to global storage for cross-workspace access
        this._context.globalState.update('antigravity.selectedElement', element);

        // Emit change event
        this._onSelectionChange.fire(element);

        // Show element info in status bar
        if (element) {
            this._updateStatusBar(element);
        }

        console.log('[AgentContext] Selection updated:', element ? `<${element.tagName}>` : 'none');
    }

    private _writeContextFile(): void {
        if (!this._contextFilePath) return;

        const contextData: AgentContextData = {
            hasSelection: this._selectedElement !== null,
            selectedElement: this._selectedElement,
            currentFile: this._currentFile,
            timestamp: Date.now()
        };

        try {
            fs.writeFileSync(
                this._contextFilePath,
                JSON.stringify(contextData, null, 2),
                'utf8'
            );
            console.log('[AgentContext] Context file written to:', this._contextFilePath);
        } catch (error) {
            console.error('[AgentContext] Failed to write context file:', error);
        }
    }

    public get selectedElement(): SelectedElement | null {
        return this._selectedElement;
    }

    public setCurrentFile(file: string | null): void {
        this._currentFile = file;
        this._context.workspaceState.update('antigravity.currentFile', file);
        this._writeContextFile();
    }

    public get currentFile(): string | null {
        return this._currentFile;
    }

    public getAgentContextData(): AgentContextData {
        return {
            hasSelection: this._selectedElement !== null,
            selectedElement: this._selectedElement,
            currentFile: this._currentFile,
            timestamp: Date.now()
        };
    }

    public getElementDescription(): string {
        if (!this._selectedElement) {
            return 'No element is currently selected in the Visual Editor.';
        }

        const el = this._selectedElement;
        let desc = `Selected element: <${el.tagName.toLowerCase()}`;

        if (el.id) desc += ` id="${el.id}"`;
        if (el.className) desc += ` class="${el.className}"`;
        desc += '>';

        if (el.textContent) {
            const text = el.textContent.substring(0, 50);
            desc += `\nText content: "${text}${el.textContent.length > 50 ? '...' : ''}"`;
        }

        if (el.sourceLocation) {
            desc += `\nLocation: ${el.sourceLocation.file}:${el.sourceLocation.line}`;
        }

        if (Object.keys(el.styles).length > 0) {
            desc += '\nCurrent styles:';
            const importantStyles = ['color', 'backgroundColor', 'fontSize', 'padding', 'margin'];
            for (const prop of importantStyles) {
                if (el.styles[prop]) {
                    desc += `\n  ${prop}: ${el.styles[prop]}`;
                }
            }
        }

        return desc;
    }

    public async applyAgentEdit(edit: {
        type: 'style' | 'text' | 'move' | 'delete';
        property?: string;
        value?: string;
        newText?: string;
        targetPath?: string;
        newIndex?: number;
    }): Promise<boolean> {
        if (!this._selectedElement) {
            vscode.window.showWarningMessage('No element selected in Visual Editor');
            return false;
        }

        vscode.commands.executeCommand('antigravity.applyEdit', edit);
        return true;
    }

    private _updateStatusBar(element: SelectedElement): void {
        const tag = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const cls = element.className ? `.${element.className.split(' ')[0]}` : '';

        vscode.window.setStatusBarMessage(
            `$(symbol-class) ${tag}${id}${cls} selected`,
            5000
        );
    }
}
