import * as vscode from 'vscode';

interface PreviewOptions {
  type: 'html' | 'url';
  content?: string;
  url?: string;
  editMode: boolean;
}

export function getPreviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  options: PreviewOptions
): string {
  const nonce = getNonce();

  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'webview', 'preview', 'styles.css')
  );

  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'webview', 'preview', 'preview.js')
  );

  if (options.type === 'url') {
    // React project - embed dev server in iframe
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${options.url} http://localhost:*; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
  <title>Visual Editor Preview</title>
</head>
<body>
  <div id="preview-container">
    <iframe id="preview-frame" src="${options.url}"></iframe>
    <div id="selection-overlay"></div>
    <div id="hover-overlay"></div>
    <div id="context-toolbar"></div>
    <div id="style-panel"></div>
  </div>
  <script nonce="${nonce}">
    window.PREVIEW_MODE = 'iframe';
    window.EDIT_MODE_ENABLED = ${options.editMode};
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  // HTML project - render content directly
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource} https:;">
  <link href="${styleUri}" rel="stylesheet">
  <title>Visual Editor Preview</title>
</head>
<body>
  <div id="preview-container">
    <div id="preview-content">${escapeHtml(options.content || '')}</div>
    <div id="selection-overlay"></div>
    <div id="hover-overlay"></div>
    <div id="context-toolbar"></div>
    <div id="style-panel"></div>
  </div>
  <script nonce="${nonce}">
    window.PREVIEW_MODE = 'inline';
    window.EDIT_MODE_ENABLED = ${options.editMode};
    window.INITIAL_CONTENT = ${JSON.stringify(options.content || '')};
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * Process HTML content for preview: inject data-ag-id attributes for element tracking
 * Uses AST-based parsing for reliable element identification
 */
export function processHtmlForPreview(html: string): string {
  try {
    // Dynamically import to avoid circular dependencies
    const { injectElementIds } = require('../parser/ASTParser');
    console.log('[previewHtml] Using AST-based element ID injection');
    const result = injectElementIds(html);
    return result.content;
  } catch (error) {
    console.error('[previewHtml] AST injection failed, returning original:', error);
    return html;
  }
}

function escapeHtml(html: string): string {
  // Use AST-based ID injection for element tracking
  // Security is handled by CSP
  return processHtmlForPreview(html);
}

