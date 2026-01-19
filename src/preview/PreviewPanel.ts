import * as vscode from 'vscode';
import * as path from 'path';
import { AgentContext, SelectedElement } from '../agent/AgentContext';
import { DevServerManager } from '../server/DevServerManager';
import { getPreviewHtml, processHtmlForPreview } from './previewHtml';
import { CodeSync } from '../sync/CodeSync';

export class PreviewPanel {
    public static currentPanel: PreviewPanel | undefined;
    private static readonly viewType = 'antigravityPreview';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _agentContext: AgentContext;
    private _document: vscode.TextDocument;
    private _devServer: DevServerManager | null = null;
    private _isEditMode: boolean = true;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(
        extensionUri: vscode.Uri,
        document: vscode.TextDocument,
        agentContext: AgentContext
    ) {
        const column = vscode.ViewColumn.Beside;

        if (PreviewPanel.currentPanel) {
            PreviewPanel.currentPanel._panel.reveal(column);
            PreviewPanel.currentPanel.updateDocument(document);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            PreviewPanel.viewType,
            'Visual Editor',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'webview'),
                    vscode.Uri.joinPath(extensionUri, 'dist'),
                ],
            }
        );

        PreviewPanel.currentPanel = new PreviewPanel(panel, extensionUri, document, agentContext);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        document: vscode.TextDocument,
        agentContext: AgentContext
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._document = document;
        this._agentContext = agentContext;

        this._initializeContent();

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            (message) => this._handleMessage(message),
            null,
            this._disposables
        );

        // Handle panel disposal
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    private async _initializeContent() {
        const isReactProject = await this._detectProjectType();

        if (isReactProject) {
            await this._startDevServer();
        } else {
            this._renderHtmlContent();
        }
    }

    private async _detectProjectType(): Promise<boolean> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(this._document.uri);
        if (!workspaceFolder) return false;

        const packageJsonPath = vscode.Uri.joinPath(workspaceFolder.uri, 'package.json');

        try {
            const packageJsonContent = await vscode.workspace.fs.readFile(packageJsonPath);
            const packageJson = JSON.parse(packageJsonContent.toString());

            const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

            // Check for React-based frameworks
            return !!(deps.react || deps.vue || deps.svelte || deps.next);
        } catch {
            return false;
        }
    }

    private async _startDevServer() {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(this._document.uri);
        if (!workspaceFolder) return;

        this._devServer = new DevServerManager(workspaceFolder.uri.fsPath);

        try {
            const url = await this._devServer.start();
            this._panel.webview.html = getPreviewHtml(
                this._panel.webview,
                this._extensionUri,
                { type: 'url', url, editMode: this._isEditMode }
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start dev server: ${error}`);
            this._renderHtmlContent();
        }
    }

    private _renderHtmlContent() {
        const content = this._document.getText();
        this._panel.webview.html = getPreviewHtml(
            this._panel.webview,
            this._extensionUri,
            { type: 'html', content, editMode: this._isEditMode }
        );
    }

    private _handleMessage(message: any) {
        // console.log('[PreviewPanel] Received message:', message.type, message.data ? JSON.stringify(message.data).substring(0, 200) : '');

        switch (message.type) {
            case 'elementSelected':
                this._onElementSelected(message.data);
                break;
            case 'textEdited':
                this._onTextEdited(message.data);
                break;
            case 'styleChanged':
                this._onStyleChanged(message.data);
                break;
            case 'stylesBatchChanged':
                this._onStylesBatchChanged(message.data);
                break;
            case 'elementMoved':
                this._onElementMoved(message.data);
                break;
            case 'elementDeleted':
                this._onElementDeleted(message.data);
                break;
            case 'elementDuplicated':
                this._onElementDuplicated(message.data);
                break;
            case 'requestContent':
                this._sendContentToPreview();
                break;
            default:
                console.log('[PreviewPanel] Unknown message type:', message.type);
        }
    }

    private _onElementSelected(data: SelectedElement) {
        // Get source location using CodeSync
        const sourceLocation = CodeSync.getElementSourceLocation(this._document, data.path);
        if (sourceLocation) {
            data.sourceLocation = sourceLocation;
        }

        // Update agent context with selected element
        this._agentContext.setSelectedElement(data);

        // Jump to element in source code
        CodeSync.jumpToElement(this._document, data.path);
    }

    private async _onTextEdited(data: { path: string; newText: string }) {
        const success = await CodeSync.applyTextEdit(this._document, data.path, data.newText);
        if (success) {
            vscode.window.showInformationMessage('Text updated!');
        }
    }

    private async _onStyleChanged(data: { path: string; property: string; value: string }) {
        const success = await CodeSync.applyStyleEdit(
            this._document,
            data.path,
            data.property,
            data.value
        );
        if (success) {
            // Notify webview to refresh if needed
            this._panel.webview.postMessage({ type: 'styleApplied', property: data.property, value: data.value });
        }
    }

    private async _onStylesBatchChanged(data: { path: string; agId?: string; batch: { styles?: any; textContent?: string } }) {
        // Apply all style changes sequentially
        if (data.batch.styles) {
            for (const [property, value] of Object.entries(data.batch.styles)) {
                await CodeSync.applyStyleEdit(
                    this._document,
                    data.path,
                    property,
                    value as string
                );
            }
        }

        // Apply text content change if present
        if (data.batch.textContent !== undefined) {
            await CodeSync.applyTextEdit(this._document, data.path, data.batch.textContent);
        }

        // Note: All changes are batched into a single diff by DiffPreviewProvider
    }

    private async _onElementMoved(data: { path: string; newParentPath: string; newIndex: number }) {
        // console.log('[PreviewPanel] _onElementMoved called:', data);
        const success = await CodeSync.applyElementMove(
            this._document,
            data.path,
            data.newParentPath,
            data.newIndex
        );
        // console.log('[PreviewPanel] applyElementMove returned:', success);
        // Note: Don't show duplicate message - DiffPreviewProvider handles messaging
    }

    private async _onElementDeleted(data: { path: string; agId?: string }) {
        // console.log('[PreviewPanel] _onElementDeleted called:', data);
        const success = await CodeSync.applyElementDelete(
            this._document,
            data.path,
            data.agId
        );
        // console.log('[PreviewPanel] applyElementDelete returned:', success);
    }

    private async _onElementDuplicated(data: { path: string; agId?: string }) {
        // console.log('[PreviewPanel] _onElementDuplicated called:', data);
        const success = await CodeSync.applyElementDuplicate(
            this._document,
            data.path,
            data.agId
        );
        // console.log('[PreviewPanel] applyElementDuplicate returned:', success);
    }

    private _sendContentToPreview() {
        this._panel.webview.postMessage({
            type: 'contentUpdate',
            content: this._document.getText(),
        });
    }

    public toggleEditMode() {
        this._isEditMode = !this._isEditMode;
        this._panel.webview.postMessage({
            type: 'toggleEditMode',
            enabled: this._isEditMode,
        });
    }

    public updateDocument(document: vscode.TextDocument) {
        this._document = document;
        this._initializeContent();
    }

    public onDocumentChange(event: vscode.TextDocumentChangeEvent) {
        if (event.document.uri.toString() === this._document.uri.toString()) {
            // Debounce updates for performance
            const rawContent = event.document.getText();

            // KEY FIX: Process the content to inject IDs before sending to webview
            // This updates the AST map and ensures elements can still be tracked
            const processedContent = processHtmlForPreview(rawContent);

            this._panel.webview.postMessage({
                type: 'contentUpdate',
                content: processedContent,
            });
        }
    }

    public applyAgentEdit(edit: { property: string; value: string }) {
        // Called by agent context when AI makes an edit
        if (this._agentContext.selectedElement) {
            this._onStyleChanged({
                path: this._agentContext.selectedElement.path,
                property: edit.property,
                value: edit.value,
            });
        }
    }

    public dispose() {
        PreviewPanel.currentPanel = undefined;

        // Stop dev server if running
        if (this._devServer) {
            this._devServer.stop();
        }

        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
