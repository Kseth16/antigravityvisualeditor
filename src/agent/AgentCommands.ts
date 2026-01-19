import * as vscode from 'vscode';
import { AgentContext } from './AgentContext';
import { CodeSync } from '../sync/CodeSync';
import { PreviewPanel } from '../preview/PreviewPanel';

/**
 * Commands that can be triggered by the AI agent to modify the selected element
 */
export class AgentCommands {
    private _context: vscode.ExtensionContext;
    private _agentContext: AgentContext;

    constructor(context: vscode.ExtensionContext, agentContext: AgentContext) {
        this._context = context;
        this._agentContext = agentContext;
        this._registerCommands();
    }

    private _registerCommands(): void {
        // Command to apply a style change from the agent
        this._context.subscriptions.push(
            vscode.commands.registerCommand('antigravity.applyStyle', async (property: string, value: string) => {
                await this.applyStyleChange(property, value);
            })
        );

        // Command to apply a text change from the agent
        this._context.subscriptions.push(
            vscode.commands.registerCommand('antigravity.applyText', async (newText: string) => {
                await this.applyTextChange(newText);
            })
        );

        // Command to delete the selected element
        this._context.subscriptions.push(
            vscode.commands.registerCommand('antigravity.deleteElement', async () => {
                await this.deleteSelectedElement();
            })
        );

        // Command to duplicate the selected element
        this._context.subscriptions.push(
            vscode.commands.registerCommand('antigravity.duplicateElement', async () => {
                await this.duplicateSelectedElement();
            })
        );

        // Command to get selected element info (for agent context)
        this._context.subscriptions.push(
            vscode.commands.registerCommand('antigravity.getSelectedElement', () => {
                return this._agentContext.getAgentContextData();
            })
        );

        // Command to apply multiple style changes at once
        this._context.subscriptions.push(
            vscode.commands.registerCommand('antigravity.applyStyles', async (styles: Record<string, string>) => {
                await this.applyMultipleStyles(styles);
            })
        );
    }

    /**
     * Apply a single style change to the selected element
     */
    public async applyStyleChange(property: string, value: string): Promise<boolean> {
        const element = this._agentContext.selectedElement;
        if (!element) {
            vscode.window.showWarningMessage('No element selected in Visual Editor');
            return false;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) return false;

        const success = await CodeSync.applyStyleEdit(
            editor.document,
            element.path,
            property,
            value
        );

        if (success) {
            // Update the element's cached styles
            element.styles[property] = value;
            this._agentContext.setSelectedElement(element);

            vscode.window.showInformationMessage(`Applied ${property}: ${value}`);
        }

        return success;
    }

    /**
     * Apply multiple style changes at once
     */
    public async applyMultipleStyles(styles: Record<string, string>): Promise<boolean> {
        for (const [property, value] of Object.entries(styles)) {
            await this.applyStyleChange(property, value);
        }
        return true;
    }

    /**
     * Apply a text change to the selected element
     */
    public async applyTextChange(newText: string): Promise<boolean> {
        const element = this._agentContext.selectedElement;
        if (!element) {
            vscode.window.showWarningMessage('No element selected in Visual Editor');
            return false;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) return false;

        const success = await CodeSync.applyTextEdit(
            editor.document,
            element.path,
            newText
        );

        if (success) {
            element.textContent = newText;
            this._agentContext.setSelectedElement(element);

            vscode.window.showInformationMessage('Text updated!');
        }

        return success;
    }

    /**
     * Delete the selected element
     */
    public async deleteSelectedElement(): Promise<boolean> {
        const element = this._agentContext.selectedElement;
        if (!element) {
            vscode.window.showWarningMessage('No element selected in Visual Editor');
            return false;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Delete <${element.tagName.toLowerCase()}>?`,
            'Delete',
            'Cancel'
        );

        if (confirm !== 'Delete') return false;

        // TODO: Implement element deletion in CodeSync
        vscode.window.showInformationMessage('Element deletion coming soon!');
        return false;
    }

    /**
     * Duplicate the selected element
     */
    public async duplicateSelectedElement(): Promise<boolean> {
        const element = this._agentContext.selectedElement;
        if (!element) {
            vscode.window.showWarningMessage('No element selected in Visual Editor');
            return false;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) return false;

        const success = await CodeSync.applyElementDuplicate(
            editor.document,
            element.path,
            element.id // Pass ID if available, though backend might need just path
        );

        if (success) {
            vscode.window.showInformationMessage(`Duplicated <${element.tagName.toLowerCase()}>`);
        }

        return success;
    }

    /**
     * Get a natural language description of what styles can be changed
     */
    public getAvailableActions(): string {
        const element = this._agentContext.selectedElement;
        if (!element) {
            return 'No element is selected. Tell the user to click an element in the Visual Editor first.';
        }

        return `
You can modify the selected <${element.tagName.toLowerCase()}> element with these commands:

STYLE CHANGES (use antigravity.applyStyle command):
- color: Change text color (e.g., "blue", "#ff0000", "rgb(255,0,0)")
- backgroundColor: Change background (e.g., "white", "#f0f0f0")
- fontSize: Change font size (e.g., "16px", "1.5rem", "larger")
- fontWeight: Change font weight (e.g., "bold", "400", "600")
- padding: Add padding (e.g., "10px", "1rem 2rem")
- margin: Add margin (e.g., "20px", "0 auto")
- borderRadius: Round corners (e.g., "8px", "50%")
- textAlign: Align text (e.g., "center", "left", "right")
- display: Change display (e.g., "flex", "grid", "block")

- antigravity.applyStyle(property, value) - Change a CSS property
- antigravity.applyText(newText) - Change the text content
- antigravity.duplicateElement() - Duplicate the element
- antigravity.deleteElement() - Delete the element

Example: To make this element blue, use: antigravity.applyStyle("color", "blue")
Example: To duplicate this element, use: antigravity.duplicateElement()
`;
    }
}
