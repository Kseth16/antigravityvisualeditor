import * as vscode from 'vscode';
import { AgentContext, SelectedElement } from '../agent/AgentContext';

/**
 * Advanced Style Panel with more controls including flexbox, grid, transforms
 */
export class AdvancedStylePanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'antigravity.stylePanel';

  private _view?: vscode.WebviewView;
  private _extensionUri: vscode.Uri;
  private _agentContext: AgentContext;

  constructor(extensionUri: vscode.Uri, agentContext: AgentContext) {
    this._extensionUri = extensionUri;
    this._agentContext = agentContext;

    this._agentContext.onSelectionChange((element) => {
      this._updatePanel(element);
    });
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

    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.type) {
        case 'styleChange':
          this._onStyleChange(message.property, message.value);
          break;
      }
    });
  }

  private _updatePanel(element: SelectedElement | null): void {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'elementSelected',
        element: element,
      });
    }
  }

  private _onStyleChange(property: string, value: string): void {
    this._agentContext.applyAgentEdit({
      type: 'style',
      property,
      value,
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Style Panel</title>
  <style>
    :root {
      --bg: var(--vscode-sideBar-background);
      --fg: var(--vscode-sideBar-foreground);
      --input-bg: var(--vscode-input-background);
      --input-border: var(--vscode-input-border);
      --button-bg: var(--vscode-button-background);
      --button-fg: var(--vscode-button-foreground);
      --accent: var(--vscode-focusBorder);
    }
    
    body {
      padding: 0;
      font-family: var(--vscode-font-family);
      font-size: 12px;
      color: var(--fg);
      background: var(--bg);
    }
    
    .no-selection {
      text-align: center;
      opacity: 0.7;
      padding: 20px 10px;
    }
    
    .tabs {
      display: flex;
      border-bottom: 1px solid var(--input-border);
    }
    
    .tab {
      flex: 1;
      padding: 8px;
      text-align: center;
      cursor: pointer;
      border: none;
      background: none;
      color: var(--fg);
      opacity: 0.6;
      font-size: 11px;
    }
    
    .tab.active {
      opacity: 1;
      border-bottom: 2px solid var(--accent);
    }
    
    .panel-content {
      padding: 10px;
      max-height: calc(100vh - 100px);
      overflow-y: auto;
    }
    
    .section {
      margin-bottom: 16px;
    }
    
    .section-title {
      font-weight: 600;
      margin-bottom: 8px;
      font-size: 11px;
      text-transform: uppercase;
      opacity: 0.7;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    
    .section-title::before {
      content: '';
      width: 12px;
      height: 12px;
      background: var(--accent);
      border-radius: 2px;
      display: inline-block;
    }
    
    .property-row {
      display: flex;
      align-items: center;
      margin-bottom: 6px;
      gap: 8px;
    }
    
    .property-label {
      flex: 0 0 70px;
      font-size: 11px;
      opacity: 0.9;
    }
    
    .property-input {
      flex: 1;
      padding: 4px 6px;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--fg);
      border-radius: 3px;
      font-size: 11px;
    }
    
    .property-input:focus {
      outline: 1px solid var(--accent);
    }
    
    .color-input-wrapper {
      display: flex;
      gap: 4px;
      flex: 1;
    }
    
    .color-input {
      width: 24px;
      height: 24px;
      padding: 0;
      border: 1px solid var(--input-border);
      border-radius: 3px;
      cursor: pointer;
    }
    
    .spacing-box {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      grid-template-rows: auto auto auto;
      gap: 4px;
      background: var(--input-bg);
      padding: 8px;
      border-radius: 4px;
    }
    
    .spacing-label {
      grid-column: 1 / 4;
      text-align: center;
      font-size: 10px;
      opacity: 0.6;
      margin-bottom: 4px;
    }
    
    .spacing-input {
      width: 100%;
      padding: 3px;
      text-align: center;
      background: var(--bg);
      border: 1px solid var(--input-border);
      color: var(--fg);
      border-radius: 2px;
      font-size: 10px;
    }
    
    .element-info {
      padding: 8px;
      background: var(--input-bg);
      border-radius: 4px;
      margin-bottom: 12px;
      font-size: 11px;
      font-family: monospace;
    }
    
    .button-group {
      display: flex;
      gap: 4px;
    }
    
    .btn {
      flex: 1;
      padding: 4px 8px;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--fg);
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
    }
    
    .btn.active {
      background: var(--accent);
      color: var(--button-fg);
      border-color: var(--accent);
    }
    
    .flex-preview {
      display: flex;
      gap: 4px;
      background: var(--input-bg);
      padding: 8px;
      border-radius: 4px;
      min-height: 60px;
      flex-wrap: wrap;
    }
    
    .flex-item {
      width: 20px;
      height: 20px;
      background: var(--accent);
      border-radius: 2px;
      opacity: 0.6;
    }
    
    select.property-input {
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div id="no-selection" class="no-selection">
    <p>👆 Select an element in preview</p>
  </div>
  
  <div id="style-controls" style="display: none;">
    <div class="tabs">
      <button class="tab active" data-tab="styles">Styles</button>
      <button class="tab" data-tab="layout">Layout</button>
      <button class="tab" data-tab="effects">Effects</button>
    </div>
    
    <div class="panel-content">
      <div class="element-info" id="element-info"></div>
      
      <!-- Styles Tab -->
      <div id="tab-styles">
        <div class="section">
          <div class="section-title">Typography</div>
          <div class="property-row">
            <span class="property-label">Font</span>
            <select class="property-input" id="fontFamily">
              <option value="inherit">Inherit</option>
              <option value="Inter, sans-serif">Inter</option>
              <option value="Roboto, sans-serif">Roboto</option>
              <option value="system-ui">System</option>
              <option value="Georgia, serif">Georgia</option>
              <option value="monospace">Monospace</option>
            </select>
          </div>
          <div class="property-row">
            <span class="property-label">Size</span>
            <input type="text" class="property-input" id="fontSize" placeholder="16px">
          </div>
          <div class="property-row">
            <span class="property-label">Weight</span>
            <select class="property-input" id="fontWeight">
              <option value="normal">Normal</option>
              <option value="500">Medium</option>
              <option value="600">Semibold</option>
              <option value="bold">Bold</option>
            </select>
          </div>
          <div class="property-row">
            <span class="property-label">Color</span>
            <div class="color-input-wrapper">
              <input type="color" class="color-input" id="color">
              <input type="text" class="property-input" id="colorText" placeholder="#000000">
            </div>
          </div>
          <div class="property-row">
            <span class="property-label">Align</span>
            <div class="button-group">
              <button class="btn" data-prop="textAlign" data-val="left">←</button>
              <button class="btn" data-prop="textAlign" data-val="center">↔</button>
              <button class="btn" data-prop="textAlign" data-val="right">→</button>
            </div>
          </div>
        </div>
        
        <div class="section">
          <div class="section-title">Background</div>
          <div class="property-row">
            <span class="property-label">Color</span>
            <div class="color-input-wrapper">
              <input type="color" class="color-input" id="backgroundColor">
              <input type="text" class="property-input" id="backgroundColorText" placeholder="transparent">
            </div>
          </div>
        </div>
        
        <div class="section">
          <div class="section-title">Spacing</div>
          <div class="property-row">
            <span class="property-label">Padding</span>
            <input type="text" class="property-input" id="padding" placeholder="0px">
          </div>
          <div class="property-row">
            <span class="property-label">Margin</span>
            <input type="text" class="property-input" id="margin" placeholder="0px">
          </div>
        </div>
        
        <div class="section">
          <div class="section-title">Border</div>
          <div class="property-row">
            <span class="property-label">Width</span>
            <input type="text" class="property-input" id="borderWidth" placeholder="0px">
          </div>
          <div class="property-row">
            <span class="property-label">Radius</span>
            <input type="text" class="property-input" id="borderRadius" placeholder="0px">
          </div>
          <div class="property-row">
            <span class="property-label">Color</span>
            <div class="color-input-wrapper">
              <input type="color" class="color-input" id="borderColor">
              <input type="text" class="property-input" id="borderColorText" placeholder="#000000">
            </div>
          </div>
        </div>
      </div>
      
      <!-- Layout Tab -->
      <div id="tab-layout" style="display: none;">
        <div class="section">
          <div class="section-title">Display</div>
          <div class="property-row">
            <span class="property-label">Type</span>
            <select class="property-input" id="display">
              <option value="block">Block</option>
              <option value="flex">Flex</option>
              <option value="grid">Grid</option>
              <option value="inline">Inline</option>
              <option value="inline-block">Inline Block</option>
              <option value="none">None</option>
            </select>
          </div>
        </div>
        
        <div class="section" id="flex-controls">
          <div class="section-title">Flexbox</div>
          <div class="property-row">
            <span class="property-label">Direction</span>
            <select class="property-input" id="flexDirection">
              <option value="row">Row →</option>
              <option value="column">Column ↓</option>
              <option value="row-reverse">Row ←</option>
              <option value="column-reverse">Column ↑</option>
            </select>
          </div>
          <div class="property-row">
            <span class="property-label">Justify</span>
            <select class="property-input" id="justifyContent">
              <option value="flex-start">Start</option>
              <option value="center">Center</option>
              <option value="flex-end">End</option>
              <option value="space-between">Space Between</option>
              <option value="space-around">Space Around</option>
            </select>
          </div>
          <div class="property-row">
            <span class="property-label">Align</span>
            <select class="property-input" id="alignItems">
              <option value="stretch">Stretch</option>
              <option value="flex-start">Start</option>
              <option value="center">Center</option>
              <option value="flex-end">End</option>
            </select>
          </div>
          <div class="property-row">
            <span class="property-label">Gap</span>
            <input type="text" class="property-input" id="gap" placeholder="0px">
          </div>
        </div>
        
        <div class="section">
          <div class="section-title">Size</div>
          <div class="property-row">
            <span class="property-label">Width</span>
            <input type="text" class="property-input" id="width" placeholder="auto">
          </div>
          <div class="property-row">
            <span class="property-label">Height</span>
            <input type="text" class="property-input" id="height" placeholder="auto">
          </div>
          <div class="property-row">
            <span class="property-label">Min W</span>
            <input type="text" class="property-input" id="minWidth" placeholder="0">
          </div>
          <div class="property-row">
            <span class="property-label">Max W</span>
            <input type="text" class="property-input" id="maxWidth" placeholder="none">
          </div>
        </div>
        
        <div class="section">
          <div class="section-title">Position</div>
          <div class="property-row">
            <span class="property-label">Type</span>
            <select class="property-input" id="position">
              <option value="static">Static</option>
              <option value="relative">Relative</option>
              <option value="absolute">Absolute</option>
              <option value="fixed">Fixed</option>
              <option value="sticky">Sticky</option>
            </select>
          </div>
        </div>
      </div>
      
      <!-- Effects Tab -->
      <div id="tab-effects" style="display: none;">
        <div class="section">
          <div class="section-title">Opacity</div>
          <div class="property-row">
            <input type="range" min="0" max="100" value="100" id="opacity" style="flex: 1;">
            <span id="opacityValue">100%</span>
          </div>
        </div>
        
        <div class="section">
          <div class="section-title">Shadow</div>
          <div class="property-row">
            <span class="property-label">Box</span>
            <select class="property-input" id="boxShadow">
              <option value="none">None</option>
              <option value="0 1px 3px rgba(0,0,0,0.12)">Small</option>
              <option value="0 4px 6px rgba(0,0,0,0.1)">Medium</option>
              <option value="0 10px 25px rgba(0,0,0,0.15)">Large</option>
              <option value="0 20px 50px rgba(0,0,0,0.2)">XL</option>
            </select>
          </div>
        </div>
        
        <div class="section">
          <div class="section-title">Transform</div>
          <div class="property-row">
            <span class="property-label">Scale</span>
            <input type="text" class="property-input" id="scale" placeholder="1">
          </div>
          <div class="property-row">
            <span class="property-label">Rotate</span>
            <input type="text" class="property-input" id="rotate" placeholder="0deg">
          </div>
        </div>
        
        <div class="section">
          <div class="section-title">Transition</div>
          <div class="property-row">
            <span class="property-label">Duration</span>
            <input type="text" class="property-input" id="transitionDuration" placeholder="0.3s">
          </div>
        </div>
        
        <div class="section">
          <div class="section-title">Cursor</div>
          <div class="property-row">
            <select class="property-input" id="cursor">
              <option value="auto">Auto</option>
              <option value="pointer">Pointer</option>
              <option value="default">Default</option>
              <option value="move">Move</option>
              <option value="not-allowed">Not Allowed</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const noSelection = document.getElementById('no-selection');
    const styleControls = document.getElementById('style-controls');
    const elementInfo = document.getElementById('element-info');
    
    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        const tabName = tab.dataset.tab;
        document.querySelectorAll('[id^="tab-"]').forEach(p => p.style.display = 'none');
        document.getElementById('tab-' + tabName).style.display = 'block';
      });
    });
    
    // All editable properties
    const properties = [
      'fontFamily', 'fontSize', 'fontWeight', 'color', 'textAlign',
      'backgroundColor', 'padding', 'margin',
      'borderWidth', 'borderRadius', 'borderColor',
      'display', 'flexDirection', 'justifyContent', 'alignItems', 'gap',
      'width', 'height', 'minWidth', 'maxWidth', 'position',
      'boxShadow', 'cursor', 'transitionDuration'
    ];
    
    // Add change listeners
    properties.forEach(prop => {
      const input = document.getElementById(prop);
      if (input) {
        input.addEventListener('change', () => {
          vscode.postMessage({ type: 'styleChange', property: prop, value: input.value });
        });
      }
    });
    
    // Button groups
    document.querySelectorAll('.btn[data-prop]').forEach(btn => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ 
          type: 'styleChange', 
          property: btn.dataset.prop, 
          value: btn.dataset.val 
        });
        
        // Toggle active state
        btn.parentElement.querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
    
    // Sync color pickers
    ['color', 'backgroundColor', 'borderColor'].forEach(prop => {
      const picker = document.getElementById(prop);
      const text = document.getElementById(prop + 'Text');
      if (picker && text) {
        picker.addEventListener('input', () => { text.value = picker.value; });
        text.addEventListener('change', () => { picker.value = text.value; });
      }
    });
    
    // Opacity slider
    const opacitySlider = document.getElementById('opacity');
    const opacityValue = document.getElementById('opacityValue');
    opacitySlider?.addEventListener('input', () => {
      opacityValue.textContent = opacitySlider.value + '%';
      vscode.postMessage({ 
        type: 'styleChange', 
        property: 'opacity', 
        value: (opacitySlider.value / 100).toString() 
      });
    });
    
    // Handle messages
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'elementSelected') {
        if (message.element) {
          noSelection.style.display = 'none';
          styleControls.style.display = 'block';
          
          const el = message.element;
          elementInfo.textContent = '<' + el.tagName.toLowerCase() + 
            (el.id ? ' #' + el.id : '') +
            (el.className ? ' .' + el.className.split(' ')[0] : '') + '>';
          
          // Update all inputs
          properties.forEach(prop => {
            const input = document.getElementById(prop);
            if (input && el.styles && el.styles[prop]) {
              input.value = el.styles[prop];
            }
          });
        } else {
          noSelection.style.display = 'block';
          styleControls.style.display = 'none';
        }
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
