import * as vscode from 'vscode';
import { AgentContext, SelectedElement } from '../agent/AgentContext';

export class ElementTreeProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'antigravity.elementTree';

    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _agentContext: AgentContext;

    constructor(extensionUri: vscode.Uri, agentContext: AgentContext) {
        this._extensionUri = extensionUri;
        this._agentContext = agentContext;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    }

    public updateTree(elements: any[]): void {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'updateTree',
                elements: elements,
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Element Tree</title>
  <style>
    body {
      padding: 10px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-sideBar-foreground);
    }
    
    .tree-item {
      padding: 4px 8px;
      cursor: pointer;
      border-radius: 3px;
    }
    
    .tree-item:hover {
      background: var(--vscode-list-hoverBackground);
    }
    
    .tree-item.selected {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }
    
    .tree-children {
      padding-left: 16px;
    }
    
    .tag-name {
      color: var(--vscode-symbolIcon-classForeground);
    }
    
    .class-name {
      color: var(--vscode-symbolIcon-propertyForeground);
      opacity: 0.8;
    }
    
    .id-name {
      color: var(--vscode-symbolIcon-variableForeground);
    }
    
    .placeholder {
      opacity: 0.6;
      text-align: center;
      padding: 20px;
    }
  </style>
</head>
<body>
  <div id="tree-container">
    <div class="placeholder">
      Open the Visual Editor preview to see the element tree
    </div>
  </div>
  
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const container = document.getElementById('tree-container');
    
    function renderTree(elements, parent) {
      elements.forEach(el => {
        const item = document.createElement('div');
        item.className = 'tree-item';
        item.dataset.path = el.path;
        
        let html = '<span class="tag-name">' + el.tagName.toLowerCase() + '</span>';
        if (el.id) html += '<span class="id-name">#' + el.id + '</span>';
        if (el.className) html += '<span class="class-name">.' + el.className.split(' ')[0] + '</span>';
        
        item.innerHTML = html;
        parent.appendChild(item);
        
        if (el.children && el.children.length > 0) {
          const children = document.createElement('div');
          children.className = 'tree-children';
          parent.appendChild(children);
          renderTree(el.children, children);
        }
      });
    }
    
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'updateTree') {
        container.innerHTML = '';
        renderTree(message.elements, container);
      }
    });
  </script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
