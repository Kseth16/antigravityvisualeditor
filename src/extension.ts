import * as vscode from 'vscode';
import { PreviewPanel } from './preview/PreviewPanel';
import { AdvancedStylePanelProvider } from './sidebar/StylePanelProvider';
import { ElementTreeProvider } from './sidebar/ElementTreeProvider';
import { AgentContext } from './agent/AgentContext';
import { AgentCommands } from './agent/AgentCommands';
import { ContextProvider } from './agent/ContextProvider';
import { DiffPreviewProvider } from './diff/DiffPreviewProvider';

const fs = require('fs');
const path = require('path');

let agentContext: AgentContext;
let agentCommands: AgentCommands;
let contextProvider: ContextProvider;
let diffPreviewProvider: DiffPreviewProvider;

export function activate(context: vscode.ExtensionContext) {
    console.log('Antigravity Visual Editor is now active!');

    // Initialize agent context for AI integration
    agentContext = new AgentContext(context);

    // Initialize agent commands (registers commands for AI to use)
    agentCommands = new AgentCommands(context, agentContext);

    // Initialize context provider (updates VS Code context for AI)
    contextProvider = new ContextProvider(context, agentContext);

    // Initialize diff preview provider for showing code changes
    diffPreviewProvider = DiffPreviewProvider.register(context);

    // Auto-install the Agent Workflow
    installAgentWorkflow(context);

    // Register the style panel sidebar (enhanced version)
    const stylePanelProvider = new AdvancedStylePanelProvider(context.extensionUri, agentContext);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('antigravity.stylePanel', stylePanelProvider)
    );

    // Register the element tree sidebar
    const elementTreeProvider = new ElementTreeProvider(context.extensionUri, agentContext);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('antigravity.elementTree', elementTreeProvider)
    );

    // Command: Open Visual Editor Preview
    const openPreviewCommand = vscode.commands.registerCommand('antigravity.openPreview', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('Please open an HTML or React file first');
            return;
        }

        PreviewPanel.createOrShow(context.extensionUri, editor.document, agentContext);
        contextProvider.setVisualEditorOpen(true);
    });

    // Command: Toggle Visual Edit Mode
    const toggleEditModeCommand = vscode.commands.registerCommand('antigravity.toggleEditMode', () => {
        if (PreviewPanel.currentPanel) {
            PreviewPanel.currentPanel.toggleEditMode();
        } else {
            vscode.window.showWarningMessage('Open the Visual Editor preview first');
        }
    });

    // Command: Get selected element info (for AI agent)
    const getContextCommand = vscode.commands.registerCommand('antigravity.getContext', () => {
        return contextProvider.getFormattedContext();
    });

    context.subscriptions.push(openPreviewCommand);
    context.subscriptions.push(toggleEditModeCommand);
    context.subscriptions.push(getContextCommand);

    // Command: Test Context Provider (Added for verification)
    context.subscriptions.push(vscode.commands.registerCommand('antigravity.testContext', async () => {
        const mockElement = {
            tagName: 'DIV',
            id: 'test-id',
            className: 'test-class',
            path: 'div#test-id.test-class',
            styles: { 'color': 'red', 'fontSize': '16px' },
            textContent: 'Hello Context Test',
            sourceLocation: { file: 'test.html', line: 1, column: 1 },
            rect: { x: 0, y: 0, width: 100, height: 100 }
        };

        console.log('[Test] Setting mocked selected element...');
        agentContext.setSelectedElement(mockElement as any);

        // Wait for file write (500ms)
        await new Promise(resolve => setTimeout(resolve, 500));

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                vscode.window.showErrorMessage('No workspace open');
                return;
            }

            // Check file existence and content
            const contextPath = vscode.Uri.joinPath(workspaceFolders[0].uri, '.antigravity-context.json');
            const contentArr = await vscode.workspace.fs.readFile(contextPath);

            // Decode content
            const { TextDecoder } = require('util');
            const contentStr = new TextDecoder().decode(contentArr);
            const json = JSON.parse(contentStr);

            if (json.selectedElement && json.selectedElement.id === 'test-id') {
                // Also verify formatted string
                if (contextProvider) {
                    const formatted = contextProvider.getFormattedContext();
                    console.log('[Test] Formatted Context:', formatted);
                }
                vscode.window.showInformationMessage(`✅ Context Verified! Found element: ${json.selectedElement.tagName}`);
            } else {
                vscode.window.showErrorMessage('❌ Context Test Failed: ID mismatch in file');
            }
        } catch (e) {
            console.error(e);
            vscode.window.showErrorMessage(`❌ Context Test Error: ${e}`);
        }
    }));

    // Listen for active editor changes to update preview
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor && PreviewPanel.currentPanel) {
                PreviewPanel.currentPanel.updateDocument(editor.document);
            }
        })
    );

    // Listen for document changes to update preview
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (PreviewPanel.currentPanel) {
                PreviewPanel.currentPanel.onDocumentChange(event);
            }
        })
    );
}

export function deactivate() {
    // Cleanup: stop any running dev servers
    if (PreviewPanel.currentPanel) {
        PreviewPanel.currentPanel.dispose();
    }
}

// Export agent context for other modules
export function getAgentContext(): AgentContext {
    return agentContext;
}

// Export formatted context for external access
export function getFormattedContext(): string {
    return contextProvider ? contextProvider.getFormattedContext() : '';
}

/**
 * Automatically installs the Agent Workflow definitions into the user's workspace
 */
async function installAgentWorkflow(context: vscode.ExtensionContext) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return; // No workspace open
    }

    const rootUri = workspaceFolders[0].uri;
    const agentDir = vscode.Uri.joinPath(rootUri, '.agent');
    const workflowsDir = vscode.Uri.joinPath(agentDir, 'workflows');

    // List of workflow files to install to .agent/workflows/
    const workflowFiles = ['visual-editor.md', 'code-generation.md'];

    try {
        // Create directories first
        await vscode.workspace.fs.createDirectory(agentDir);
        await vscode.workspace.fs.createDirectory(workflowsDir);

        // Install workflow files
        for (const fileName of workflowFiles) {
            const targetFile = vscode.Uri.joinPath(workflowsDir, fileName);
            const sourceFile = vscode.Uri.joinPath(context.extensionUri, 'resources', 'workflows', fileName);

            // Check if target already exists to avoid overwriting user customizations
            try {
                await vscode.workspace.fs.stat(targetFile);
                console.log(`[Antigravity] Workflow ${fileName} already exists, skipping.`);
                continue;
            } catch (e) {
                // Target doesn't exist, proceed
            }

            await vscode.workspace.fs.copy(sourceFile, targetFile, { overwrite: true });
            console.log(`[Antigravity] Workflow ${fileName} injected successfully.`);
        }

        // Install AGENTS.md to project root (AI assistants read this automatically)
        const agentsTarget = vscode.Uri.joinPath(rootUri, 'AGENTS.md');
        const agentsSource = vscode.Uri.joinPath(context.extensionUri, 'resources', 'AGENTS.md');

        try {
            await vscode.workspace.fs.stat(agentsTarget);
            console.log('[Antigravity] AGENTS.md already exists, skipping.');
        } catch (e) {
            // Doesn't exist, install it
            await vscode.workspace.fs.copy(agentsSource, agentsTarget, { overwrite: true });
            console.log('[Antigravity] AGENTS.md installed to project root.');
        }

    } catch (error) {
        console.error('[Antigravity] Failed to inject workflows:', error);
    }
}
export function getFormattedAgentContext(): string {
    return contextProvider.getFormattedContext();
}
