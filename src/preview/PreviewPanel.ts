import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
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
    private _devServerUrl: string | undefined;
    private _isEditMode: boolean = true;
    private _disposables: vscode.Disposable[] = [];
    private _isDisposed: boolean = false;
    private _hmrFallbackTimer: ReturnType<typeof setTimeout> | null = null;

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
        if (this._isDisposed) return;
        const isReactProject = await this._detectProjectType();
        if (this._isDisposed) return;

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
            const isReact = !!(deps.react || deps.next || deps.vite || deps['react-scripts']);
            return isReact;
        } catch {
            return false;
        }
    }

    private async _startDevServer() {
        if (this._isDisposed) return;

        if (!this._devServer) {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(this._document.uri);
            if (!workspaceFolder) return;

            this._devServer = new DevServerManager(workspaceFolder.uri.fsPath);
        }

        try {
            const url = await this._devServer!.start();
            if (this._isDisposed) return;

            // Only update if URL changed to avoid iframe reload flicker
            if (this._devServerUrl === url) {
                return;
            }

            this._devServerUrl = url;

            // Inject bridge script for iframe communication
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(this._document.uri);
            if (workspaceFolder) {
                this._injectBridgeScript(workspaceFolder.uri.fsPath);
            }

            this._updateWebview();
        } catch (error) {
            if (this._isDisposed) return;
            console.error('[PreviewPanel] Failed to start dev server:', error);
            this._renderHtmlContent(); // Fallback
        }
    }

    private _injectBridgeScript(workspacePath: string) {
        try {
            const publicDir = path.join(workspacePath, 'public');
            if (fs.existsSync(publicDir)) {
                const bridgeSrc = path.join(this._extensionUri.fsPath, 'resources', 'scripts', 'bridge.js');
                const bridgeDest = path.join(publicDir, 'antigravity-bridge.js');

                // Copy bridge file
                fs.copyFileSync(bridgeSrc, bridgeDest);
                console.log('[PreviewPanel] Injected bridge.js to', bridgeDest);

                // Ensure index.html includes it
                const indexHtmlPath = path.join(publicDir, 'index.html');
                const rootIndexHtml = path.join(workspacePath, 'index.html');
                const targetIndex = fs.existsSync(indexHtmlPath) ? indexHtmlPath : (fs.existsSync(rootIndexHtml) ? rootIndexHtml : null);

                if (targetIndex) {
                    let htmlContent = fs.readFileSync(targetIndex, 'utf-8');
                    // Avoid duplicate injection
                    if (!htmlContent.includes('antigravity-bridge.js')) {
                        // Inject before </head>
                        if (htmlContent.includes('</head>')) {
                            htmlContent = htmlContent.replace('</head>', '<script src="/antigravity-bridge.js"></script>\n</head>');
                            fs.writeFileSync(targetIndex, htmlContent);
                            console.log('[PreviewPanel] Injected script tag into', targetIndex);
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[PreviewPanel] Failed to inject bridge script:', e);
        }
    }

    private _updateWebview() {
        if (this._isDisposed) return;

        if (this._devServerUrl) {
            const newHtml = getPreviewHtml(
                this._panel.webview,
                this._extensionUri,
                { type: 'url', url: this._devServerUrl, editMode: this._isEditMode }
            );

            // Optimization: Only update if HTML is actually different
            if (this._panel.webview.html !== newHtml) {
                this._panel.webview.html = newHtml;
            }
        } else {
            this._renderHtmlContent();
        }
    }

    private _renderHtmlContent() {
        if (this._isDisposed) return;
        const content = this._document.getText();
        const newHtml = getPreviewHtml(
            this._panel.webview,
            this._extensionUri,
            { type: 'html', content, editMode: this._isEditMode, fileName: this._document.fileName }
        );

        if (this._panel.webview.html !== newHtml) {
            this._panel.webview.html = newHtml;
        }
    }

    private _handleMessage(message: any) {
        console.log('[PreviewPanel] Received message:', message.type, message.data ? JSON.stringify(message.data).substring(0, 200) : '');

        switch (message.type) {
            case 'log':
                console.log('[Webview Log]', ...message.args);
                break;
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
                vscode.window.showInformationMessage('Element Delete Request Received');
                this._onElementDeleted(message.data);
                break;
            case 'elementDuplicated':
                vscode.window.showInformationMessage('Element Duplicate Request Received');
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

    private async _onElementMoved(data: any) {
        // console.log('[PreviewPanel] _onElementMoved called:', data);
        const success = await CodeSync.applyElementMove(
            this._document,
            data.path,
            data.newParentPath,
            data.newIndex,
            data.agId,
            data.direction,
            data.moveType
        );
        // console.log('[PreviewPanel] applyElementMove returned:', success);
        // Note: Don't show duplicate message - DiffPreviewProvider handles messaging
    }

    private async _onElementDeleted(data: { path: string; agId?: string }) {
        const success = await CodeSync.applyElementDelete(
            this._document,
            data.path,
            data.agId
        );

        if (success) {
            if (!this._devServerUrl) {
                // Static HTML mode: Send optimistic update to immediately remove element
                this._panel.webview.postMessage({
                    type: 'optimisticDelete',
                    data: data
                });
            } else {
                // Dev server mode: HMR will handle refresh. Add fallback reload.
                this._scheduleHmrFallback();
            }
        }
    }

    private async _onElementDuplicated(data: { path: string; agId?: string }) {
        // console.log('[PreviewPanel] _onElementDuplicated called:', data);
        const success = await CodeSync.applyElementDuplicate(
            this._document,
            data.path,
            data.agId
        );
        // console.log('[PreviewPanel] applyElementDuplicate returned:', success);

        if (success) {
            if (!this._devServerUrl) {
                // Static HTML mode: Send optimistic update
                this._panel.webview.postMessage({
                    type: 'optimisticDuplicate',
                    data: data
                });
            } else {
                // Dev server mode: HMR will handle refresh. Add fallback reload.
                this._scheduleHmrFallback();
            }


        }
    }

    private _sendContentToPreview() {
        this._panel.webview.postMessage({
            type: 'contentUpdate',
            content: this._document.getText(),
        });
    }

    /**
     * Schedule a fallback iframe reload if HMR doesn't trigger within 2s
     */
    private _scheduleHmrFallback() {
        // Clear any existing timer
        if (this._hmrFallbackTimer) {
            clearTimeout(this._hmrFallbackTimer);
        }

        // Set a 2 second fallback to reload the iframe if HMR doesn't work
        this._hmrFallbackTimer = setTimeout(() => {
            console.log('[PreviewPanel] HMR fallback triggered - reloading iframe');
            this._panel.webview.postMessage({
                type: 'forceReload'
            });
            this._hmrFallbackTimer = null;
        }, 2000);
    }

    public toggleEditMode() {
        this._isEditMode = !this._isEditMode;
        this._panel.webview.postMessage({
            type: 'toggleEditMode',
            enabled: this._isEditMode,
        });
    }

    public updateDocument(document: vscode.TextDocument) {
        if (this._isDisposed) return;

        if (this._document && this._document.uri.fsPath.toLowerCase() === document.uri.fsPath.toLowerCase()) {
            // Already showing this document (case-insensitive for Windows)
            return;
        }
        this._document = document;
        this._initializeContent();
    }

    public onDocumentChange(event: vscode.TextDocumentChangeEvent) {
        if (this._isDisposed) return;
        if (event.document.uri.toString() === this._document.uri.toString()) {
            // Dev Server handles its own HMR via Vite/Next
            if (this._devServerUrl) {
                return;
            }

            // For static HTML, send content update
            const rawContent = event.document.getText();
            const processedContent = processHtmlForPreview(rawContent, this._document.fileName);

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
        if (this._isDisposed) return;
        this._isDisposed = true;
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
