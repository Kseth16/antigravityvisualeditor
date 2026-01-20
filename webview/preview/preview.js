/**
 * Preview WebView Script
 * Handles element selection, floating context toolbar, and WYSIWYG style editing
 */

(function () {
    const vscode = acquireVsCodeApi();

    // Forward logs to host for debugging
    const originalLog = console.log;
    console.log = (...args) => {
        originalLog(...args);
        vscode.postMessage({ type: 'log', args: args });
    };

    // State
    let selectedElement = null;
    let hoveredElement = null;
    let isDragging = false;
    let draggedElement = null;
    let dragStartPos = { x: 0, y: 0 };
    let elementStartPos = { x: 0, y: 0 };
    let currentDropTarget = null;
    let currentDragMode = null; // 'move' or 'rearrange'
    let stylePanelVisible = false;

    // Rearrange state - for live preview
    let originalNextSibling = null;  // Store where the element was originally
    let originalParent = null;
    let hasMovedFromOriginal = false;

    // Batched style changes state
    let pendingStyleChanges = {};  // Buffer for style edits {property: value}
    let hasPendingChanges = false;  // Track if Save button should be enabled
    let originalStyles = {};  // Element's original styles before edits (for Cancel)
    let pendingTextContent = null;  // Buffer for text content changes

    // DOM References
    const selectionOverlay = document.getElementById('selection-overlay');
    const hoverOverlay = document.getElementById('hover-overlay');
    const contextToolbar = document.getElementById('context-toolbar');
    const stylePanel = document.getElementById('style-panel');

    const isIframe = window.PREVIEW_MODE === 'iframe';
    let targetDocument = document;
    let previewContainer = null;

    function init() {
        previewContainer = document.getElementById('preview-container');

        if (isIframe) {
            const iframe = document.getElementById('preview-frame');
            iframe.addEventListener('load', () => {
                console.log('[Preview] Iframe loaded, attempting access...');
                try {
                    // Try to access contentDocument - this should fail for cross-origin
                    const doc = iframe.contentDocument || iframe.contentWindow.document;
                    console.log('[Preview] Iframe access SUCCESS (Unexpected for localhost)');
                    targetDocument = doc;
                    setupEventListeners();
                } catch (e) {
                    console.error('[Preview] Iframe access BLOCKED (Expected for localhost):', e);
                    console.log('[Preview] Switching to Bridge Mode communication');
                }
            });
        } else {
            targetDocument = document;
            setupEventListeners();
        }

        createContextToolbar();
        createStylePanel();

        window.addEventListener('message', handleMessage);

        // Debug: Log all global clicks
        document.addEventListener('click', (e) => {
            console.log('[Preview] GLOBAL CLICK caught on:', e.target.tagName, e.target.id, e.target.className);
            // Check if we hit the iframe (should not happen if overlay blocks) or overlays
        }, true); // Capture phase to ensure we see it first

        document.addEventListener('click', onDocumentClick);
    }

    function setupEventListeners() {
        const content = isIframe ? targetDocument.body : document.getElementById('preview-content');
        if (!content) return;

        content.addEventListener('mouseover', onMouseOver);
        content.addEventListener('mouseout', onMouseOut);
        content.addEventListener('click', onClick);
        content.addEventListener('dblclick', onDoubleClick);
        content.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        content.addEventListener('dragstart', (e) => e.preventDefault());
    }

    // ===========================================
    // CONTEXT TOOLBAR
    // ===========================================

    function createContextToolbar() {
        contextToolbar.innerHTML = `
            <button id="ctx-edit" title="Edit Styles">✏️</button>
            <button id="ctx-rearrange" title="Drag to Rearrange">↕️</button>
            <span class="separator"></span>
            <button id="ctx-parent" title="Select Parent">🔝</button>
            <button id="ctx-duplicate" title="Duplicate">📋</button>
            <button id="ctx-delete" class="danger" title="Delete">🗑️</button>
        `;

        // Use event delegation to persist listeners even if innerHTML changes
        contextToolbar.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;

            console.log('[Preview] Delegated Toolbar Click:', btn.id);
            // Stop propagation to prevent selecting the toolbar itself or underlying elements
            e.stopPropagation();

            if (btn.id === 'ctx-edit') toggleStylePanel();
            else if (btn.id === 'ctx-rearrange') startDragMode('rearrange');
            else if (btn.id === 'ctx-parent') selectParentElement();
            else if (btn.id === 'ctx-duplicate') {
                console.log('[Preview] Delegated Duplicate Action');
                duplicateElement();
            }
            else if (btn.id === 'ctx-delete') {
                console.log('[Preview] Delegated Delete Action');
                deleteElement();
            }
        });
    }

    function showContextToolbar(element) {
        const rect = getElementRect(element);

        // Position above the element, centered
        const toolbarHeight = 36;
        const gap = 8;

        let top = rect.top - toolbarHeight - gap;
        let left = rect.left + rect.width / 2;

        // Ensure toolbar stays in view
        if (top < 10) {
            top = rect.top + rect.height + gap;
        }

        contextToolbar.style.top = top + 'px';
        contextToolbar.style.left = left + 'px';
        contextToolbar.classList.add('visible');
    }

    function hideContextToolbar() {
        contextToolbar.classList.remove('visible');
        hideStylePanel();
    }

    function startDragMode(mode) {
        const wasActive = currentDragMode === mode;
        currentDragMode = wasActive ? null : mode;

        // Toggle button state
        document.getElementById('ctx-rearrange').classList.toggle('active', currentDragMode === 'rearrange');

        // Notify bridge to enter/exit drag mode (for iframe elements)
        if (isIframe) {
            const iframe = document.getElementById('preview-frame');
            iframe?.contentWindow?.postMessage({
                type: 'bridgeAction',
                action: currentDragMode ? 'enterDragMode' : 'exitDragMode'
            }, '*');
        }

        if (currentDragMode) {
            showModeToast('↕️ Click and drag to rearrange');
        } else {
            showModeToast('✖️ Drag mode cancelled');
        }
    }

    function showModeToast(message) {
        document.getElementById('mode-toast')?.remove();
        const toast = document.createElement('div');
        toast.id = 'mode-toast';
        toast.style.cssText = `
            position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
            padding: 10px 20px; background: #0e639c; color: white;
            border-radius: 6px; font-size: 13px; z-index: 10002; font-family: system-ui;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }

    // ===========================================
    // WYSIWYG STYLE PANEL
    // ===========================================

    function createStylePanel() {
        stylePanel.innerHTML = `
            <!-- Sticky Header with Save/Cancel Buttons -->
            <div class="style-panel-header">
                <button class="save-btn" id="save-styles-btn" disabled>Save Changes</button>
                <button class="cancel-btn" id="cancel-styles-btn" disabled>Cancel</button>
            </div>

            <!-- Scrollable Content Area -->
            <div class="style-panel-content">
                <!-- Content Section (Text Editing) -->
                <div class="style-section" id="section-content">
                    <div class="style-section-header" onclick="toggleSection('section-content')">
                        <span class="section-title">Content</span>
                        <span class="section-toggle">▼</span>
                    </div>
                    <div class="style-section-content">
                        <textarea class="content-textarea" id="style-text-content" placeholder="Edit element text content..." rows="3"></textarea>
                    </div>
                </div>

                <!-- Text Section -->
                <div class="style-section" id="section-text">
                    <div class="style-section-header" onclick="toggleSection('section-text')">
                        <span class="section-title">Text</span>
                        <span class="section-toggle">▼</span>
                    </div>
                    <div class="style-section-content">
                        <div class="style-row">
                            <label>Font</label>
                            <select class="style-select" id="style-font-family">
                                <option value="inherit">Inherit</option>
                                <option value="system-ui, sans-serif">System UI</option>
                                <option value="Arial, sans-serif">Arial</option>
                                <option value="Georgia, serif">Georgia</option>
                                <option value="'Courier New', monospace">Courier New</option>
                                <option value="'Times New Roman', serif">Times New Roman</option>
                            </select>
                        </div>
                        <div class="style-row">
                            <label>Size</label>
                            <div class="input-group">
                                <input type="number" class="style-input" id="style-font-size" placeholder="16" min="1" max="200">
                                <span style="color:#888">px</span>
                            </div>
                        </div>
                        <div class="style-row">
                            <label>Style</label>
                            <div class="toggle-group">
                                <button class="toggle-btn" id="style-bold" title="Bold">B</button>
                                <button class="toggle-btn" id="style-italic" title="Italic" style="font-style:italic">I</button>
                                <button class="toggle-btn" id="style-underline" title="Underline" style="text-decoration:underline">U</button>
                            </div>
                        </div>
                        <div class="style-row">
                            <label>Color</label>
                            <div class="color-input-wrapper">
                                <div class="color-swatch">
                                    <input type="color" id="style-color" value="#333333">
                                </div>
                                <input type="text" class="style-input" id="style-color-text" placeholder="#333333">
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Background Section -->
                <div class="style-section" id="section-background">
                    <div class="style-section-header" onclick="toggleSection('section-background')">
                        <span class="section-title">Background</span>
                        <span class="section-toggle">▼</span>
                    </div>
                    <div class="style-section-content">
                        <div class="style-row">
                            <label>Color</label>
                            <div class="color-input-wrapper">
                                <div class="color-swatch">
                                    <input type="color" id="style-bg-color" value="#ffffff">
                                </div>
                                <input type="text" class="style-input" id="style-bg-color-text" placeholder="transparent">
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Spacing Section -->
                <div class="style-section" id="section-spacing">
                    <div class="style-section-header" onclick="toggleSection('section-spacing')">
                        <span class="section-title">Spacing</span>
                        <span class="section-toggle">▼</span>
                    </div>
                    <div class="style-section-content">
                        <div class="spacing-box">
                            <span class="spacing-label">Margin</span>
                            <div class="margin-box">
                                <div class="spacing-row">
                                    <input type="number" class="spacing-input" id="style-margin-top" placeholder="0" title="Margin Top">
                                </div>
                                <div class="spacing-row horizontal">
                                    <input type="number" class="spacing-input" id="style-margin-left" placeholder="0" title="Margin Left">
                                    <div class="padding-box">
                                        <span class="spacing-label">Padding</span>
                                        <div class="spacing-row">
                                            <input type="number" class="spacing-input" id="style-padding-top" placeholder="0" title="Padding Top">
                                        </div>
                                        <div class="spacing-row horizontal">
                                            <input type="number" class="spacing-input" id="style-padding-left" placeholder="0" title="Padding Left">
                                            <div class="content-box">content</div>
                                            <input type="number" class="spacing-input" id="style-padding-right" placeholder="0" title="Padding Right">
                                        </div>
                                        <div class="spacing-row">
                                            <input type="number" class="spacing-input" id="style-padding-bottom" placeholder="0" title="Padding Bottom">
                                        </div>
                                    </div>
                                    <input type="number" class="spacing-input" id="style-margin-right" placeholder="0" title="Margin Right">
                                </div>
                                <div class="spacing-row">
                                    <input type="number" class="spacing-input" id="style-margin-bottom" placeholder="0" title="Margin Bottom">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Border Section -->
                <div class="style-section" id="section-border">
                    <div class="style-section-header" onclick="toggleSection('section-border')">
                        <span class="section-title">Border</span>
                        <span class="section-toggle">▼</span>
                    </div>
                    <div class="style-section-content">
                        <div class="style-row">
                            <label>Width</label>
                            <div class="input-group">
                                <input type="number" class="style-input" id="style-border-width" placeholder="0" min="0">
                                <span style="color:#888">px</span>
                            </div>
                        </div>
                        <div class="style-row">
                            <label>Style</label>
                            <select class="style-select" id="style-border-style">
                                <option value="none">None</option>
                                <option value="solid">Solid</option>
                                <option value="dashed">Dashed</option>
                                <option value="dotted">Dotted</option>
                                <option value="double">Double</option>
                            </select>
                        </div>
                        <div class="style-row">
                            <label>Color</label>
                            <div class="color-input-wrapper">
                                <div class="color-swatch">
                                    <input type="color" id="style-border-color" value="#cccccc">
                                </div>
                                <input type="text" class="style-input" id="style-border-color-text" placeholder="#cccccc">
                            </div>
                        </div>
                        <div class="style-row">
                            <label>Radius</label>
                            <div class="input-group">
                                <input type="number" class="style-input" id="style-border-radius" placeholder="0" min="0">
                                <span style="color:#888">px</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Custom CSS Section -->
                <div class="style-section" id="section-custom">
                    <div class="style-section-header" onclick="toggleSection('section-custom')">
                        <span class="section-title">Custom CSS</span>
                        <span class="section-toggle">▼</span>
                    </div>
                    <div class="style-section-content">
                        <textarea class="custom-css-textarea" id="style-custom-css" placeholder="property: value;&#10;another-property: value;"></textarea>
                    </div>
                </div>
            </div>
        `;


        // Attach event listeners
        attachStylePanelListeners();
    }

    function attachStylePanelListeners() {
        // Save and Cancel buttons
        document.getElementById('save-styles-btn').addEventListener('click', () => {
            saveStyleChanges();
        });

        document.getElementById('cancel-styles-btn').addEventListener('click', () => {
            cancelStyleChanges();
        });

        // Content textarea (text editing)
        document.getElementById('style-text-content').addEventListener('input', (e) => {
            pendingTextContent = e.target.value;
            hasPendingChanges = true;
            updateSaveButtonState();
        });

        // Font family
        document.getElementById('style-font-family').addEventListener('change', (e) => {
            applyStyle('fontFamily', e.target.value);
        });

        // Font size
        document.getElementById('style-font-size').addEventListener('input', (e) => {
            if (e.target.value) applyStyle('fontSize', e.target.value + 'px');
        });

        // Bold
        document.getElementById('style-bold').addEventListener('click', (e) => {
            e.target.classList.toggle('active');
            applyStyle('fontWeight', e.target.classList.contains('active') ? 'bold' : 'normal');
        });

        // Italic
        document.getElementById('style-italic').addEventListener('click', (e) => {
            e.target.classList.toggle('active');
            applyStyle('fontStyle', e.target.classList.contains('active') ? 'italic' : 'normal');
        });

        // Underline
        document.getElementById('style-underline').addEventListener('click', (e) => {
            e.target.classList.toggle('active');
            applyStyle('textDecoration', e.target.classList.contains('active') ? 'underline' : 'none');
        });

        // Text color
        document.getElementById('style-color').addEventListener('input', (e) => {
            document.getElementById('style-color-text').value = e.target.value;
            applyStyle('color', e.target.value);
        });
        document.getElementById('style-color-text').addEventListener('change', (e) => {
            document.getElementById('style-color').value = e.target.value;
            applyStyle('color', e.target.value);
        });

        // Background color
        document.getElementById('style-bg-color').addEventListener('input', (e) => {
            document.getElementById('style-bg-color-text').value = e.target.value;
            applyStyle('backgroundColor', e.target.value);
        });
        document.getElementById('style-bg-color-text').addEventListener('change', (e) => {
            if (e.target.value) {
                try { document.getElementById('style-bg-color').value = e.target.value; } catch (err) { }
                applyStyle('backgroundColor', e.target.value);
            }
        });

        // Padding inputs
        ['Top', 'Right', 'Bottom', 'Left'].forEach(side => {
            document.getElementById('style-padding-' + side.toLowerCase()).addEventListener('input', (e) => {
                if (e.target.value !== '') applyStyle('padding' + side, e.target.value + 'px');
            });
            document.getElementById('style-margin-' + side.toLowerCase()).addEventListener('input', (e) => {
                if (e.target.value !== '') applyStyle('margin' + side, e.target.value + 'px');
            });
        });

        // Border
        document.getElementById('style-border-width').addEventListener('input', (e) => {
            if (e.target.value !== '') applyStyle('borderWidth', e.target.value + 'px');
        });
        document.getElementById('style-border-style').addEventListener('change', (e) => {
            applyStyle('borderStyle', e.target.value);
        });
        document.getElementById('style-border-color').addEventListener('input', (e) => {
            document.getElementById('style-border-color-text').value = e.target.value;
            applyStyle('borderColor', e.target.value);
        });
        document.getElementById('style-border-color-text').addEventListener('change', (e) => {
            if (e.target.value) {
                try { document.getElementById('style-border-color').value = e.target.value; } catch (err) { }
                applyStyle('borderColor', e.target.value);
            }
        });
        document.getElementById('style-border-radius').addEventListener('input', (e) => {
            if (e.target.value !== '') applyStyle('borderRadius', e.target.value + 'px');
        });

        // Custom CSS
        document.getElementById('style-custom-css').addEventListener('blur', (e) => {
            applyCustomCSS(e.target.value);
        });
    }

    function toggleStylePanel() {
        stylePanelVisible = !stylePanelVisible;
        document.getElementById('ctx-edit').classList.toggle('active', stylePanelVisible);

        if (stylePanelVisible) {
            showStylePanel();
        } else {
            hideStylePanel();
        }
    }

    function showStylePanel() {
        if (!selectedElement) return;

        populateStylePanel();

        const rect = getElementRect(selectedElement);
        const toolbarRect = contextToolbar.getBoundingClientRect();

        // Position below toolbar
        let top = toolbarRect.bottom + 8;
        let left = rect.left + rect.width / 2 - 140; // 280/2 = 140

        // Ensure it stays in view
        if (left < 10) left = 10;
        if (left + 280 > window.innerWidth - 10) left = window.innerWidth - 290;

        stylePanel.style.top = top + 'px';
        stylePanel.style.left = left + 'px';
        stylePanel.classList.add('visible');
        stylePanelVisible = true;
    }

    function hideStylePanel() {
        // Check for unsaved changes before closing
        if (hasPendingChanges) {
            const confirmDiscard = confirm('You have unsaved style changes. Discard them?');
            if (!confirmDiscard) {
                return; // Don't close panel
            }
            // User confirmed - revert changes
            cancelStyleChanges();
        }

        stylePanel.classList.remove('visible');
        stylePanelVisible = false;
        document.getElementById('ctx-edit')?.classList.remove('active');
    }

    function populateStylePanel() {
        if (!selectedElement) return;

        // Reset pending changes buffer for new element
        resetPendingChanges();

        let computed;
        if (selectedElement instanceof Element) {
            computed = window.getComputedStyle(selectedElement);
        } else {
            // Use proxied styles from bridge (msg.data.styles)
            computed = selectedElement.style || {};
        }

        // Capture original styles for Cancel functionality
        originalStyles = {
            fontSize: computed.fontSize,
            fontWeight: computed.fontWeight,
            fontStyle: computed.fontStyle,
            textDecoration: computed.textDecoration || 'none',
            color: computed.color,
            backgroundColor: computed.backgroundColor,
            paddingTop: computed.paddingTop,
            paddingRight: computed.paddingRight,
            paddingBottom: computed.paddingBottom,
            paddingLeft: computed.paddingLeft,
            marginTop: computed.marginTop,
            marginRight: computed.marginRight,
            marginBottom: computed.marginBottom,
            marginLeft: computed.marginLeft,
            borderWidth: computed.borderWidth,
            borderStyle: computed.borderStyle,
            borderColor: computed.borderColor,
            borderRadius: computed.borderRadius,
            textContent: selectedElement instanceof Element ? selectedElement.textContent : selectedElement.textContent
        };

        // Populate Content textarea with element text
        const contentVal = selectedElement instanceof Element ? selectedElement.textContent : selectedElement.textContent;
        document.getElementById('style-text-content').value = contentVal || '';

        // Font
        document.getElementById('style-font-size').value = parseInt(computed.fontSize) || '';

        // Style toggles
        const isBold = computed.fontWeight === 'bold' || parseInt(computed.fontWeight) >= 700;
        document.getElementById('style-bold').classList.toggle('active', isBold);

        const isItalic = computed.fontStyle === 'italic';
        document.getElementById('style-italic').classList.toggle('active', isItalic);

        const isUnderline = (computed.textDecoration || '').includes('underline');
        document.getElementById('style-underline').classList.toggle('active', isUnderline);

        // Colors
        document.getElementById('style-color-text').value = rgbToHex(computed.color);
        try { document.getElementById('style-color').value = rgbToHex(computed.color); } catch (e) { }

        document.getElementById('style-bg-color-text').value =
            computed.backgroundColor === 'rgba(0, 0, 0, 0)' || computed.backgroundColor === 'transparent' ? 'transparent' : rgbToHex(computed.backgroundColor);
        try {
            if (computed.backgroundColor !== 'rgba(0, 0, 0, 0)' && computed.backgroundColor !== 'transparent') {
                document.getElementById('style-bg-color').value = rgbToHex(computed.backgroundColor);
            }
        } catch (e) { }

        // Padding
        document.getElementById('style-padding-top').value = parseInt(computed.paddingTop) || '';
        document.getElementById('style-padding-right').value = parseInt(computed.paddingRight) || '';
        document.getElementById('style-padding-bottom').value = parseInt(computed.paddingBottom) || '';
        document.getElementById('style-padding-left').value = parseInt(computed.paddingLeft) || '';

        // Margin
        document.getElementById('style-margin-top').value = parseInt(computed.marginTop) || '';
        document.getElementById('style-margin-right').value = parseInt(computed.marginRight) || '';
        document.getElementById('style-margin-bottom').value = parseInt(computed.marginBottom) || '';
        document.getElementById('style-margin-left').value = parseInt(computed.marginLeft) || '';

        // Border
        document.getElementById('style-border-width').value = parseInt(computed.borderWidth) || '';
        document.getElementById('style-border-style').value = computed.borderStyle || 'none';
        document.getElementById('style-border-color-text').value = rgbToHex(computed.borderColor);
        try { document.getElementById('style-border-color').value = rgbToHex(computed.borderColor); } catch (e) { }
        document.getElementById('style-border-radius').value = parseInt(computed.borderRadius) || '';

        // Custom CSS - show inline style attribute
        const inlineStyle = selectedElement instanceof Element ? selectedElement.getAttribute('style') : '';
        document.getElementById('style-custom-css').value = inlineStyle || '';
    }

    function applyStyle(property, value) {
        if (!selectedElement) return;

        // Apply to preview immediately (visual feedback) if possible
        if (selectedElement instanceof Element) {
            selectedElement.style[property] = value;
        } else {
            // Forward to bridge for optimistic style update
            const iframe = document.getElementById('preview-frame');
            iframe?.contentWindow?.postMessage({
                type: 'bridgeAction',
                action: 'applyStyle',
                agId: getElementId(selectedElement),
                path: getElementPath(selectedElement),
                property: property,
                value: value
            }, '*');
        }


        // Buffer the change instead of sending
        pendingStyleChanges[property] = value;
        hasPendingChanges = true;
        updateSaveButtonState();
    }

    function applyCustomCSS(cssText) {
        if (!selectedElement) return;

        // Parse and apply each property
        const declarations = cssText.split(';').filter(d => d.trim());
        declarations.forEach(decl => {
            const [prop, val] = decl.split(':').map(s => s.trim());
            if (prop && val) {
                const camelProp = kebabToCamel(prop);
                if (selectedElement instanceof Element) {
                    selectedElement.style[camelProp] = val;
                }
                // Buffer this change too
                pendingStyleChanges[camelProp] = val;
            }
        });

        hasPendingChanges = true;
        updateSaveButtonState();
    }

    // Update Save/Cancel button enabled state
    function updateSaveButtonState() {
        const saveBtn = document.getElementById('save-styles-btn');
        const cancelBtn = document.getElementById('cancel-styles-btn');

        if (saveBtn && cancelBtn) {
            saveBtn.disabled = !hasPendingChanges;
            // Cancel button always enabled to allow closing
            cancelBtn.disabled = false;
        }
    }

    // Save all buffered style changes as a batch
    function saveStyleChanges() {
        if (!selectedElement || !hasPendingChanges) return;

        const changes = {};

        // Convert buffered style changes to kebab-case for backend
        for (const [property, value] of Object.entries(pendingStyleChanges)) {
            changes[camelToKebab(property)] = value;
        }

        // Include text content change if any
        const batch = { styles: changes };
        if (pendingTextContent !== null) {
            batch.textContent = pendingTextContent;

            if (selectedElement instanceof Element) {
                selectedElement.textContent = pendingTextContent;
            } else {
                // Forward text update to bridge if pending
                const iframe = document.getElementById('preview-frame');
                iframe?.contentWindow?.postMessage({
                    type: 'bridgeAction',
                    action: 'applyText',
                    agId: getElementId(selectedElement),
                    path: getElementPath(selectedElement),
                    value: pendingTextContent
                }, '*');
            }
        }

        // Send batch to extension
        vscode.postMessage({
            type: 'stylesBatchChanged',
            data: {
                path: getElementPath(selectedElement),
                agId: getElementId(selectedElement),
                batch: batch
            }
        });

        // Reset buffer
        resetPendingChanges();
        showModeToast('✅ Changes saved');
        hideStylePanel(); // Close panel after save
    }

    // Cancel all buffered changes and revert preview
    function cancelStyleChanges() {
        if (!selectedElement) return;

        // Revert all style changes to original
        if (hasPendingChanges) {
            for (const property in originalStyles) {
                if (property !== 'textContent' && selectedElement instanceof Element) {
                    selectedElement.style[property] = originalStyles[property];
                }
            }

            // Revert text content if changed
            if (pendingTextContent !== null && originalStyles.textContent) {
                selectedElement.textContent = originalStyles.textContent;
                const contentTextarea = document.getElementById('style-text-content');
                if (contentTextarea) {
                    contentTextarea.value = originalStyles.textContent;
                }
            }
            showModeToast('↩️ Changes discarded');
        }

        // Reset buffer and close
        resetPendingChanges();
        hideStylePanel();
    }

    // Reset pending changes buffer
    function resetPendingChanges() {
        pendingStyleChanges = {};
        pendingTextContent = null;
        hasPendingChanges = false;
        originalStyles = {};
        updateSaveButtonState();
    }

    // Global function for section toggle
    window.toggleSection = function (sectionId) {
        const section = document.getElementById(sectionId);
        section.classList.toggle('collapsed');
        const toggle = section.querySelector('.section-toggle');
        toggle.textContent = section.classList.contains('collapsed') ? '▶' : '▼';
    };

    // ===========================================
    // ELEMENT ACTIONS
    // ===========================================

    function duplicateElement() {
        if (!selectedElement) {
            console.log('[Preview] duplicateElement: No element selected');
            return;
        }

        console.log('[Preview] duplicateElement CALLED. Tag:', selectedElement.tagName);
        const path = getElementPath(selectedElement);
        const agId = getElementId(selectedElement);

        // Handle Proxy Object (React/Bridge)
        if (selectedElement.path) {
            console.log('[Preview] duplicateElement: Proxy mode. Path:', path, 'AgId:', agId);

            vscode.postMessage({
                type: 'elementDuplicated',
                data: { path, agId }
            });
            showModeToast('📋 Element duplicated');
            return;
        }

        // Handle Static HTML (DOM Element)
        if (selectedElement instanceof Element) {
            console.log('[Preview] duplicateElement: Static DOM mode');

            // Optimistic update
            const clone = selectedElement.cloneNode(true);
            selectedElement.parentNode.insertBefore(clone, selectedElement.nextSibling);
            setTimeout(() => selectElement(clone), 50);

            vscode.postMessage({
                type: 'elementDuplicated',
                data: { path, agId }
            });
            showModeToast('📋 Element duplicated');
        }
    }

    function deleteElement() {
        if (!selectedElement) {
            console.log('[Preview] deleteElement: No element selected');
            return;
        }

        console.log('[Preview] deleteElement CALLED. Tag:', selectedElement.tagName);
        const path = getElementPath(selectedElement);
        const agId = getElementId(selectedElement);

        // Handle Proxy Object (React/Bridge)
        if (selectedElement.path) {
            console.log('[Preview] deleteElement: Proxy mode. Path:', path, 'AgId:', agId);

            // Hide toolbars immediately
            hideContextToolbar();
            deselectElement();

            vscode.postMessage({
                type: 'elementDeleted',
                data: { path, agId }
            });
            showModeToast('🗑️ Element deleted');
            return;
        }

        // Handle Static HTML (DOM Element)
        if (selectedElement instanceof Element) {
            console.log('[Preview] deleteElement: Static DOM mode');

            // Optimistic update
            selectedElement.remove();
            hideContextToolbar();
            deselectElement();

            vscode.postMessage({
                type: 'elementDeleted',
                data: { path, agId }
            });
            showModeToast('🗑️ Element deleted');
        }
    }

    function selectParentElement() {
        if (!selectedElement) {
            console.log('[Preview] selectParentElement: No element selected');
            return;
        }

        const parent = selectedElement.parentElement;
        const parentPath = selectedElement.parentPath || (parent ? getElementPath(parent) : null);

        console.log('[Preview] selectParentElement:', {
            currentElement: selectedElement.tagName,
            currentPath: getElementPath(selectedElement),
            parentElement: parent?.tagName,
            parentPath: parentPath
        });

        // Handle Bridge Mode Parent Selection
        if (!(selectedElement instanceof Element) && parentPath) {
            console.log('[Preview] selectParentElement: Proxy mode, requesting parent from bridge');
            const iframe = document.getElementById('preview-frame');
            iframe?.contentWindow?.postMessage({
                type: 'bridgeAction',
                action: 'selectParent',
                path: parentPath
            }, '*');
            return;
        }

        // Don't select body, html, or preview container
        if (!parent ||
            parent === targetDocument.body ||
            parent === targetDocument.documentElement ||
            parent.id === 'preview-content' ||
            parent.id === 'preview-container') {
            console.log('[Preview] selectParentElement: Reached top-level, cannot go higher');
            showModeToast('⬆️ Already at top level');
            return;
        }

        // Check if parent is selectable
        if (!isSelectableElement(parent)) {
            console.log('[Preview] selectParentElement: Parent is not selectable');
            showModeToast('⬆️ Parent not selectable');
            return;
        }

        selectElement(parent);
        showModeToast('⬆️ Selected parent: <' + parent.tagName.toLowerCase() + '>');
    }

    // ===========================================
    // MOUSE EVENTS
    // ===========================================

    function onMouseOver(e) {
        if (isDragging) return;
        const target = getSelectableElement(e.target);
        if (!target || target === selectedElement) return;
        hoveredElement = target;
        updateHoverOverlay(target);
    }

    function onMouseOut() {
        if (isDragging) return;
        hoveredElement = null;
        hideHoverOverlay();
    }

    function onClick(e) {
        // Prevent default behavior for links/forms during editing
        e.preventDefault();
        e.stopPropagation();

        const target = getSelectableElement(e.target);
        if (!target) return;

        selectElement(target);
    }

    function onDocumentClick(e) {
        // Click outside to deselect
        if (!previewContainer) return;

        const isToolbarClick = contextToolbar.contains(e.target);
        const isStylePanelClick = stylePanel.contains(e.target);
        const isOverlayClick = e.target === selectionOverlay || e.target === hoverOverlay;

        if (!isToolbarClick && !isStylePanelClick && !isOverlayClick) {
            const previewContent = document.getElementById('preview-content');
            if (previewContent && !previewContent.contains(e.target)) {
                deselectElement();
            }
        }
    }

    function onDoubleClick(e) {
        const target = getSelectableElement(e.target);
        if (target) {
            selectElement(target);
            showStylePanel();
            // Expand Content section
            const contentSection = document.getElementById('section-content');
            if (contentSection && contentSection.classList.contains('collapsed')) {
                toggleSection('section-content');
            }
            // Focus textarea
            setTimeout(() => {
                const textarea = document.getElementById('style-text-content');
                if (textarea) textarea.focus();
            }, 100);
        }
    }

    function onMouseDown(e) {
        if (!currentDragMode || !selectedElement) return;

        // In Bridge mode, we might be clicking the selection overlay handle
        const target = getSelectableElement(e.target);
        const isOverlayClick = e.target === selectionOverlay || selectionOverlay.contains(e.target);

        if (target !== selectedElement && !isOverlayClick) return;

        isDragging = true;
        draggedElement = selectedElement;
        dragStartPos = { x: e.clientX, y: e.clientY };

        const isProxy = !(draggedElement instanceof Element);

        // Make dragged element semi-transparent
        if (isProxy) {
            // For React: send startDrag to bridge 
            const iframe = document.getElementById('preview-frame');
            iframe?.contentWindow?.postMessage({
                type: 'bridgeAction',
                action: 'startDrag'
            }, '*');
        } else {
            draggedElement.style.opacity = '0.5';
            draggedElement.style.outline = '2px dashed #0e639c';
        }

        if (currentDragMode === 'move') {
            if (isProxy) {
                // Moving absolute elements in React not fully supported yet via drag
                // but we at least shouldn't crash.
                elementStartPos = { x: 0, y: 0 };
            } else {
                const computed = window.getComputedStyle(draggedElement);
                if (computed.position === 'static') {
                    draggedElement.style.position = 'relative';
                }
                elementStartPos = {
                    x: parseFloat(computed.left) || 0,
                    y: parseFloat(computed.top) || 0
                };
            }
        } else if (currentDragMode === 'rearrange') {
            // Store original position for live preview
            if (!isProxy) {
                originalParent = draggedElement.parentElement;
                originalNextSibling = draggedElement.nextElementSibling;
            }
            hasMovedFromOriginal = false;
        }

        e.preventDefault();
    }

    function onMouseMove(e) {
        if (!isDragging || !draggedElement) return;

        if (currentDragMode === 'move') {
            const dx = e.clientX - dragStartPos.x;
            const dy = e.clientY - dragStartPos.y;
            draggedElement.style.left = (elementStartPos.x + dx) + 'px';
            draggedElement.style.top = (elementStartPos.y + dy) + 'px';
            showPositionInfo(elementStartPos.x + dx, elementStartPos.y + dy);
        } else if (currentDragMode === 'rearrange') {
            liveRearrange(e.clientY);
        }
    }

    function onMouseUp(e) {
        if (!isDragging || !draggedElement) return;

        if (currentDragMode === 'move') {
            const isProxy = !(draggedElement instanceof Element);
            if (!isProxy) {
                const computed = window.getComputedStyle(draggedElement);
                sendStyleChange('position', 'relative');
                sendStyleChange('left', computed.left);
                sendStyleChange('top', computed.top);
            }
        } else if (currentDragMode === 'rearrange' && hasMovedFromOriginal) {
            // Element was moved, notify extension to update source code
            finalizeRearrange();
        }

        cleanupDrag();
    }

    // ===========================================
    // REARRANGE LOGIC (Live Preview)
    // ===========================================

    function liveRearrange(mouseY) {
        if (!draggedElement) return;

        // Bridge Mode: Delegate to iframe
        if (!(draggedElement instanceof Element)) {
            const iframe = document.getElementById('preview-frame');
            iframe?.contentWindow?.postMessage({
                type: 'bridgeAction',
                action: 'liveRearrange',
                mouseY: mouseY
            }, '*');
            return;
        }

        if (!draggedElement.parentElement) return;

        const parent = draggedElement.parentElement;

        // Get all siblings (elements that are NOT the dragged element)
        const siblings = Array.from(parent.children).filter(child =>
            child !== draggedElement && isSelectableElement(child)
        );

        if (siblings.length === 0) return;

        // Find where to insert based on mouse position
        // Strategy: find the sibling whose vertical center is closest to mouse
        // Then decide: insert before or after based on mouse position relative to center

        let bestTarget = null;
        let insertBefore = true;

        for (let i = 0; i < siblings.length; i++) {
            const sibling = siblings[i];
            const rect = sibling.getBoundingClientRect();
            const centerY = rect.top + rect.height / 2;

            if (mouseY < centerY) {
                // Mouse is above this element's center - insert BEFORE this element
                bestTarget = sibling;
                insertBefore = true;
                break;
            } else {
                // Mouse is below this element's center
                // This could be the one to insert after
                bestTarget = sibling;
                insertBefore = false;
                // Keep looking in case there's another element below
            }
        }

        if (!bestTarget) return;

        // Check if this would actually change the position
        let needsMove = false;

        if (insertBefore) {
            // We want to insert BEFORE bestTarget
            // Only move if dragged element is not already right before bestTarget
            const currentPrev = bestTarget.previousElementSibling;
            if (currentPrev !== draggedElement) {
                needsMove = true;
            }
        } else {
            // We want to insert AFTER bestTarget
            // Only move if dragged element is not already right after bestTarget
            const currentNext = bestTarget.nextElementSibling;
            if (currentNext !== draggedElement) {
                needsMove = true;
            }
        }

        if (needsMove) {
            // Perform the DOM move
            if (insertBefore) {
                parent.insertBefore(draggedElement, bestTarget);
            } else {
                // Insert after bestTarget
                const nextSibling = bestTarget.nextElementSibling;
                if (nextSibling && nextSibling !== draggedElement) {
                    parent.insertBefore(draggedElement, nextSibling);
                } else if (!nextSibling) {
                    parent.appendChild(draggedElement);
                }
            }

            hasMovedFromOriginal = true;

            // LOG: Track position during preview
            const newIndex = getElementIndex(draggedElement);
            console.log('[Preview] Element moved to index:', newIndex, '| insertBefore:', insertBefore, '| bestTarget:', bestTarget.tagName);

            // Update overlays to follow the moved element
            updateSelectionOverlay(draggedElement);
            showContextToolbar(draggedElement);
        }
    }

    function getSiblings(element) {
        if (!element || !element.parentElement) return [];
        return Array.from(element.parentElement.children).filter(child =>
            child !== element && isSelectableElement(child)
        );
    }


    function finalizeRearrange() {
        if (!draggedElement) return;

        const isProxy = !(draggedElement instanceof Element);
        const finalIndex = isProxy ? (draggedElement.newIndex ?? 0) : getElementIndex(draggedElement);
        const elementTag = draggedElement.tagName;
        const parentTag = !isProxy ? draggedElement.parentElement?.tagName : 'PARENT';

        console.log('[Preview] FINALIZING - Element:', elementTag, '| Final Index:', finalIndex, '| Parent:', parentTag);

        const path = isProxy ? (draggedElement.path) : getElementPath(draggedElement);
        const agId = getElementId(draggedElement);

        // Send message to extension to update source code with new position
        vscode.postMessage({
            type: 'elementMoved',
            data: {
                path: path,
                agId: agId,
                newParentPath: !isProxy ? getElementPath(draggedElement.parentElement) : draggedElement.parentPath,
                newIndex: finalIndex,
                moveType: 'rearrange'
            }
        });

        showModeToast('✓ Element repositioned');

        // Re-select at new position
        setTimeout(() => selectElement(draggedElement), 50);
    }

    // ===========================================
    // FREE MOVE HELPERS
    // ===========================================

    function showPositionInfo(x, y) {
        let info = document.getElementById('pos-info');
        if (!info) {
            info = document.createElement('div');
            info.id = 'pos-info';
            info.style.cssText = `
                position: fixed; bottom: 10px; right: 10px;
                padding: 8px 12px; background: rgba(0,0,0,0.8);
                color: white; border-radius: 4px; font: 12px monospace; z-index: 10001;
            `;
            document.body.appendChild(info);
        }
        info.textContent = `left: ${Math.round(x)}px  top: ${Math.round(y)}px`;
    }

    function sendStyleChange(property, value) {
        vscode.postMessage({
            type: 'styleChanged',
            data: {
                path: getElementPath(draggedElement),
                property: property,
                value: value
            }
        });
    }

    // ===========================================
    // CLEANUP
    // ===========================================

    function cleanupDrag() {
        isDragging = false;
        currentDragMode = null;
        document.getElementById('pos-info')?.remove();

        if (draggedElement) {
            const isProxy = !(draggedElement instanceof Element);
            if (isProxy) {
                // For React: send endDrag to bridge
                const iframe = document.getElementById('preview-frame');
                iframe?.contentWindow?.postMessage({
                    type: 'bridgeAction',
                    action: 'endDrag'
                }, '*');
            } else {
                draggedElement.style.opacity = '';
                draggedElement.style.outline = '';
            }
            updateSelectionOverlay(draggedElement);
            showContextToolbar(draggedElement);
        }

        // Reset rearrange state
        originalParent = null;
        originalNextSibling = null;
        hasMovedFromOriginal = false;

        draggedElement = null;
        currentDropTarget = null;

        // Reset button states
        document.getElementById('ctx-rearrange')?.classList.remove('active');
    }

    // ===========================================
    // SELECTION
    // ===========================================

    function selectElement(element) {
        // console.log('[Preview] selectElement:', {
        //     tagName: element.tagName,
        //     id: element.id || null,
        //     className: element.className || null,
        //     path: getElementPath(element)
        // });

        if (selectedElement) {
            if (selectedElement instanceof Element) {
                selectedElement.removeAttribute('data-antigravity-selected');
                selectedElement.removeAttribute('contenteditable');
            }
        }
        selectedElement = element;
        if (selectedElement instanceof Element) {
            element.setAttribute('data-antigravity-selected', 'true');
        }
        updateSelectionOverlay(element);
        showContextToolbar(element);
        sendElementSelected(element);

        // Refresh style panel if open
        if (stylePanelVisible) {
            populateStylePanel();
        }
    }

    function deselectElement() {
        if (selectedElement) {
            if (selectedElement instanceof Element) {
                selectedElement.removeAttribute('data-antigravity-selected');
                selectedElement.removeAttribute('contenteditable');
            }
        }
        selectedElement = null;
        selectionOverlay.style.display = 'none';
        hideContextToolbar();
    }

    function updateSelectionOverlay(element) {
        const rect = getElementRect(element);
        selectionOverlay.style.display = 'block';
        selectionOverlay.style.top = rect.top + 'px';
        selectionOverlay.style.left = rect.left + 'px';
        selectionOverlay.style.width = rect.width + 'px';
        selectionOverlay.style.height = rect.height + 'px';
    }

    function updateHoverOverlay(element) {
        const rect = getElementRect(element);
        hoverOverlay.style.display = 'block';
        hoverOverlay.style.top = rect.top + 'px';
        hoverOverlay.style.left = rect.left + 'px';
        hoverOverlay.style.width = rect.width + 'px';
        hoverOverlay.style.height = rect.height + 'px';
    }

    function hideHoverOverlay() {
        hoverOverlay.style.display = 'none';
    }

    // ===========================================
    // TEXT EDITING (Legacy removed - use Style Panel)
    // ===========================================

    // (Functions removed to prevent conflict with Style Panel)

    // ===========================================
    // UTILITIES
    // ===========================================

    function getSelectableElement(element) {
        if (element.nodeType !== 1) return null;
        if (element.closest('#context-toolbar')) return null;
        if (element.closest('#style-panel')) return null;
        if (['selection-overlay', 'hover-overlay', 'drop-line', 'drop-info', 'pos-info', 'mode-toast'].includes(element.id)) return null;
        if (element === targetDocument.body || element === targetDocument.documentElement) return null;
        return element;
    }

    function isSelectableElement(element) {
        return getSelectableElement(element) !== null;
    }

    function getElementRect(element) {
        let rect;
        if (element instanceof Element) {
            rect = element.getBoundingClientRect();
        } else if (element && element.rect) {
            // Bridge Mode: use stored rect from proxy
            rect = element.rect;
        } else {
            return { top: 0, left: 0, width: 0, height: 0 };
        }

        const containerRect = previewContainer.getBoundingClientRect();
        return {
            top: rect.top - containerRect.top + previewContainer.scrollTop,
            left: rect.left - containerRect.left + previewContainer.scrollLeft,
            width: rect.width,
            height: rect.height,
        };
    }

    function getElementPath(element) {
        if (element.path) return element.path; // Proxy object from bridge
        if (!element || !element.tagName) return ''; // Invalid element

        const path = [];
        let current = element;
        while (current && current !== targetDocument.body) {
            let selector = current.tagName.toLowerCase();
            if (current.id) {
                path.unshift('#' + current.id);
                break;
            }
            const siblings = current.parentElement?.children;
            if (siblings && siblings.length > 1) {
                const idx = Array.from(siblings).indexOf(current) + 1;
                selector += ':nth-child(' + idx + ')';
            }
            path.unshift(selector);
            current = current.parentElement;
        }
        return path.join(' > ');
    }

    function getElementIndex(element) {
        return Array.from(element.parentElement?.children || []).indexOf(element);
    }

    /**
     * Get the unique element ID from the data-ag-id attribute.
     * This is the reliable way to track elements back to source code.
     */
    function getElementId(element) {
        if (!element) return null;

        // Handle Proxy Object (msg.data.agId)
        if (element.dataset && element.dataset.agId) {
            return element.dataset.agId;
        }

        // Handle DOM Element
        if (element instanceof Element) {
            const closest = element.closest('[data-ag-id]');
            if (closest && closest.dataset.agId) {
                return closest.dataset.agId;
            }
        }

        return null;
    }

    function getComputedStyles(element) {
        const computed = window.getComputedStyle(element);
        const props = ['color', 'backgroundColor', 'fontSize', 'fontWeight', 'padding', 'margin', 'display', 'position', 'left', 'top'];
        const styles = {};
        props.forEach(p => styles[p] = computed[p]);
        return styles;
    }

    function sendElementSelected(element) {
        const rect = element.getBoundingClientRect();
        const elementId = getElementId(element);

        const messageData = {
            tagName: element.tagName,
            id: element.id || undefined,
            className: element.className || undefined,
            path: getElementPath(element),
            agId: elementId, // NEW: AST-based element ID for reliable tracking
            textContent: element.textContent?.substring(0, 100),
            styles: getComputedStyles(element),
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            sourceLocation: null,
        };

        // console.log('[Preview] sendElementSelected:', {
        //     tagName: messageData.tagName,
        //     id: messageData.id,
        //     path: messageData.path,
        //     agId: messageData.agId
        // });

        vscode.postMessage({
            type: 'elementSelected',
            data: messageData
        });
    }

    function rgbToHex(rgb) {
        if (!rgb || rgb === 'transparent') return '#000000';
        if (rgb.startsWith('#')) return rgb;

        const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!match) return '#000000';

        return '#' + [match[1], match[2], match[3]]
            .map(x => parseInt(x).toString(16).padStart(2, '0'))
            .join('');
    }

    function camelToKebab(str) {
        return str.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
    }

    function kebabToCamel(str) {
        return str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
    }

    function handleMessage(event) {
        const msg = event.data;

        // --- Bridge Messages (from React App) ---
        if (msg.type === 'bridgeAction') {
            console.log('[Preview] Received bridgeAction:', msg.action);
            if (msg.action === 'duplicate') {
                duplicateElement();
            } else if (msg.action === 'delete') {
                deleteElement();
            }
            return;
        }

        if (msg.type === 'bridgeElementSelected') {
            console.log('[Preview] Bridge Selected:', msg.data.tagName);

            // Reconstruct the "selected element" state using the data from bridge
            // We can't hold a reference to the DOM element (it's in the iframe),
            // but we can fake it for the purpose of the UI or just pass the data through.

            // Update UI overlays using the rect provided by the bridge
            // Note: The rect is relative to the iframe's viewport. 
            // We might need to offset it by the iframe's position if not full screen.
            // But here the iframe is full screen #preview-frame.

            const rect = msg.data.rect;

            // Mock a selected element for the UI state
            // We create a proxy object to store the data
            selectedElement = {
                tagName: msg.data.tagName,
                id: msg.data.id,
                className: msg.data.className,
                textContent: msg.data.textContent,
                style: msg.data.styles, // Read-only view of styles
                dataset: { agId: msg.data.agId },
                path: msg.data.path,
                parentPath: msg.data.parentPath,
                rect: msg.data.rect, // Store the rect for positioning
                getAttribute: (name) => {
                    if (name === 'data-ag-id') return msg.data.agId;
                    return null;
                }
            };

            // Update Overlay manually - NO, bridge does this now internally for zero latency
            // updateSelectionOverlayFromRect(rect, msg.data.tagName);

            // Send to extension
            vscode.postMessage({
                type: 'elementSelected',
                data: msg.data
            });

            // Show toolbar - we still show this externally for now
            showContextToolbarFromRect(rect);
            return;
        }

        if (msg.type === 'bridgeElementHovered') {
            // Handle hover from bridge - bridge handles overlay internally
            return;
        }

        if (msg.type === 'bridgeAction') {
            // Handle bridge results
            if (msg.action === 'selectParent') {
                // The bridge already sent bridgeElementSelected, so we just log
                console.log('[Preview] Bridge Parent Selected');
            } else if (msg.action === 'rearrangeUpdate') {
                // Update local tracking during interactive drag
                if (selectedElement && !(selectedElement instanceof Element)) {
                    selectedElement.path = msg.data.path;
                    selectedElement.newIndex = msg.data.newIndex;
                    hasMovedFromOriginal = true;
                    // Update visuals for the dummy dragged element
                    updateSelectionOverlayFromRect(selectedElement.rect, selectedElement.tagName);
                    showContextToolbarFromRect(selectedElement.rect);
                }
            }
            return;
        }

        // --- Extension Messages ---
        if (msg.type === 'contentUpdate' && !isIframe) {
            const content = document.getElementById('preview-content');
            if (content) content.innerHTML = msg.content;
        } else if (msg.type === 'highlightElement') {
            const el = targetDocument.querySelector(msg.path);
            if (el) selectElement(el);
        } else if (msg.type === 'optimisticDuplicate' || msg.type === 'optimisticDelete') {
            // Forward optimistic updates to bridge
            if (isIframe) {
                const iframe = document.getElementById('preview-frame');
                iframe?.contentWindow?.postMessage(msg, '*');
            }
        } else if (msg.type === 'bridgeDragEnd') {
            // Handle drag end from bridge
            console.log('[Preview] bridgeDragEnd received:', msg.data);
            if (selectedElement && !(selectedElement instanceof Element)) {
                // Update local state
                selectedElement.path = msg.data.path;
                selectedElement.newIndex = msg.data.newIndex;
                hasMovedFromOriginal = true;

                // Finalize rearrangement - send to extension
                vscode.postMessage({
                    type: 'elementMoved',
                    data: {
                        path: msg.data.path,
                        agId: selectedElement.dataset?.agId,
                        newParentPath: selectedElement.parentPath,
                        newIndex: msg.data.newIndex,
                        moveType: 'rearrange'
                    }
                });

                showModeToast('✓ Element repositioned');
            }

            // Reset drag state
            isDragging = false;
            currentDragMode = null;
            draggedElement = null;
            document.getElementById('ctx-rearrange')?.classList.remove('active');
        } else if (msg.type === 'forceReload') {
            // Force reload the iframe to sync with source code
            console.log('[Preview] Force reload triggered');
            const iframe = document.getElementById('preview-frame');
            if (iframe && iframe.src) {
                iframe.src = iframe.src;
            }
        }
    }

    function updateSelectionOverlayFromRect(rect, tagName) {
        const scrollTop = previewContainer.scrollTop;
        const scrollLeft = previewContainer.scrollLeft;

        selectionOverlay.style.display = 'block';
        selectionOverlay.style.top = (rect.top + scrollTop) + 'px';
        selectionOverlay.style.left = (rect.left + scrollLeft) + 'px';
        selectionOverlay.style.width = rect.width + 'px';
        selectionOverlay.style.height = rect.height + 'px';
        selectionOverlay.setAttribute('data-tag', tagName.toLowerCase());
    }

    function updateHoverOverlayFromRect(rect) {
        const scrollTop = previewContainer.scrollTop;
        const scrollLeft = previewContainer.scrollLeft;

        hoverOverlay.style.display = 'block';
        hoverOverlay.style.top = (rect.top + scrollTop) + 'px';
        hoverOverlay.style.left = (rect.left + scrollLeft) + 'px';
        hoverOverlay.style.width = rect.width + 'px';
        hoverOverlay.style.height = rect.height + 'px';
    }

    function showContextToolbarFromRect(rect) {
        const scrollTop = previewContainer.scrollTop;
        const scrollLeft = previewContainer.scrollLeft;

        // Position above the element, centered
        const toolbarHeight = 36;
        const gap = 8;

        let top = rect.top + scrollTop - toolbarHeight - gap;
        let left = rect.left + scrollLeft + rect.width / 2;

        if (top < 10) {
            top = rect.top + scrollTop + rect.height + gap;
        }

        contextToolbar.style.top = top + 'px';
        contextToolbar.style.left = left + 'px';
        contextToolbar.classList.add('visible');
    }

    init();
})();
