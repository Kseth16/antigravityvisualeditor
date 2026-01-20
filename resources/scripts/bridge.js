/**
 * Antigravity Bridge Script
 * Injected into the user's React app to communicate with the VS Code extension.
 */
(function () {
    console.log('[Antigravity Bridge] Initializing...');

    let hoveredElement = null;
    let selectedElement = null;
    let isDragging = false; // Flag to prevent selection during drag

    // --- Internal Overlay Elements ---
    let selectionOverlay, hoverOverlay;

    function createOverlays() {
        // Inject Styles
        const style = document.createElement('style');
        style.textContent = `
            #antigravity-selection-overlay {
                position: fixed;
                pointer-events: none;
                border: 2px solid #0e639c;
                background: rgba(14, 99, 156, 0.1);
                transition: all 0.05s ease;
                display: none;
                z-index: 2147483647; /* Max z-index */
            }
            #antigravity-selection-overlay::before {
                content: attr(data-tag);
                position: absolute;
                top: -22px;
                left: -2px;
                padding: 2px 6px;
                background: #0e639c;
                color: white;
                font-size: 11px;
                font-weight: 500;
                border-radius: 3px 3px 0 0;
            }
            #antigravity-hover-overlay {
                position: fixed;
                pointer-events: none;
                border: 1px dashed #888;
                background: rgba(136, 136, 136, 0.05);
                display: none;
                z-index: 2147483646;
            }
        `;
        document.head.appendChild(style);

        // Create Elements
        selectionOverlay = document.createElement('div');
        selectionOverlay.id = 'antigravity-selection-overlay';
        document.body.appendChild(selectionOverlay);

        hoverOverlay = document.createElement('div');
        hoverOverlay.id = 'antigravity-hover-overlay';
        document.body.appendChild(hoverOverlay);
    }

    function updateOverlay(overlay, target) {
        if (!target) {
            overlay.style.display = 'none';
            return;
        }
        const rect = target.getBoundingClientRect();
        overlay.style.display = 'block';
        overlay.style.top = rect.top + 'px';
        overlay.style.left = rect.left + 'px';
        overlay.style.width = rect.width + 'px';
        overlay.style.height = rect.height + 'px';

        if (overlay === selectionOverlay) {
            overlay.setAttribute('data-tag', target.tagName.toLowerCase());
        }
    }

    // Send a handshake message to confirm we are alive
    window.parent.postMessage({ type: 'bridgeReady', url: window.location.href }, '*');

    // Create overlays on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createOverlays);
    } else {
        createOverlays();
    }

    // Helper: Build element path
    function getElementPath(element) {
        const path = [];
        let current = element;
        while (current && current !== document.body) {
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

    // Helper: Get element index among siblings
    function getElementIndex(element) {
        if (!element || !element.parentElement) return 0;
        return Array.from(element.parentElement.children).indexOf(element);
    }

    // Helper: Get element ID (from data attribute)
    function getElementId(element) {
        if (element.dataset && element.dataset.agId) return element.dataset.agId;
        const closest = element.closest('[data-ag-id]');
        return closest ? closest.dataset.agId : null;
    }

    // LISTENER: Mouse Over
    document.addEventListener('mouseover', (e) => {
        e.stopPropagation();
        const target = e.target;

        if (target === document.body || target === document.documentElement) return;
        if (target.id.startsWith('antigravity-')) return; // Ignore our overlays
        if (target === hoveredElement) return;

        hoveredElement = target;
        updateOverlay(hoverOverlay, target);
        sendUpdate('bridgeElementHovered', target);
    }, true);

    // LISTENER: Click
    document.addEventListener('click', (e) => {
        // Ignore clicks during drag mode
        if (isDragging) return;

        e.preventDefault();
        e.stopPropagation();

        const target = e.target;
        if (target.id.startsWith('antigravity-')) return;

        selectedElement = target;
        updateOverlay(selectionOverlay, target);
        sendUpdate('bridgeElementSelected', target);

        console.log('[Antigravity Bridge] Element Selected:', target.tagName);
    }, true);

    // LISTENER: MouseDown - Start drag if in drag mode
    document.addEventListener('mousedown', (e) => {
        if (!isDragging || !selectedElement) return;
        e.preventDefault();
        e.stopPropagation();

        // Notify parent that the drag has started
        window.parent.postMessage({
            type: 'bridgeDragStart',
            data: {
                clientX: e.clientX,
                clientY: e.clientY
            }
        }, '*');
    }, true);

    // LISTENER: MouseMove - Forward position during drag
    document.addEventListener('mousemove', (e) => {
        if (!isDragging || !selectedElement) return;

        // Live rearrange
        handleLiveRearrange(e.clientY);
    }, true);

    // LISTENER: MouseUp - End drag
    document.addEventListener('mouseup', (e) => {
        if (!isDragging || !selectedElement) return;
        e.preventDefault();

        // Notify parent that drag has ended and finalize
        window.parent.postMessage({
            type: 'bridgeDragEnd',
            data: {
                clientX: e.clientX,
                clientY: e.clientY,
                newIndex: getElementIndex(selectedElement),
                path: getElementPath(selectedElement)
            }
        }, '*');

        // Reset visual state
        isDragging = false;
        if (selectedElement) {
            selectedElement.style.opacity = '';
            selectedElement.style.outline = '';
        }
    }, true);


    // LISTENER: Scroll & Resize
    // Only update overlays locally - do NOT send messages to parent on every frame
    // This prevents spamming hundreds of selection events during scrolling
    window.addEventListener('scroll', () => {
        if (hoveredElement) updateOverlay(hoverOverlay, hoveredElement);
        if (selectedElement) updateOverlay(selectionOverlay, selectedElement);
        // NOTE: We intentionally do NOT call sendUpdate here to avoid performance issues
    }, { passive: true });

    window.addEventListener('resize', () => {
        if (hoveredElement) updateOverlay(hoverOverlay, hoveredElement);
        if (selectedElement) updateOverlay(selectionOverlay, selectedElement);
        // NOTE: We intentionally do NOT call sendUpdate here to avoid performance issues
    }, { passive: true });

    function sendUpdate(type, target) {
        if (!target) return;
        const rect = target.getBoundingClientRect();

        const data = {
            tagName: target.tagName,
            id: target.id,
            className: target.className,
            path: getElementPath(target),
            agId: getElementId(target),
            rect: {
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height
            }
        };

        if (type === 'bridgeElementSelected') {
            const computed = window.getComputedStyle(target);
            data.styles = {
                fontSize: computed.fontSize,
                fontWeight: computed.fontWeight,
                fontStyle: computed.fontStyle,
                textDecoration: computed.textDecoration,
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
                borderRadius: computed.borderRadius
            };
            data.textContent = target.textContent?.substring(0, 500);

            // Helpful for parent selection
            const parent = target.parentElement;
            if (parent && parent !== document.documentElement && parent !== document.body) {
                data.parentPath = getElementPath(parent);
            }
        }

        window.parent.postMessage({ type, data }, '*');
    }

    // LISTENER: Messages from Parent (PreviewPanel/VS Code)
    window.addEventListener('message', (event) => {
        const message = event.data;
        console.log('[Antigravity Bridge] Received message:', message.type);

        if (message.type === 'optimisticDuplicate') {
            handleOptimisticDuplicate(message.data);
        } else if (message.type === 'optimisticDelete') {
            handleOptimisticDelete(message.data);
        } else if (message.type === 'bridgeAction') {
            if (message.action === 'selectParent') {
                const parent = findElementByPath(message.path);
                if (parent) {
                    selectedElement = parent;
                    updateOverlay(selectionOverlay, parent);
                    sendUpdate('bridgeElementSelected', parent);
                }
            } else if (message.action === 'applyStyle') {
                const element = findElementByAgId(message.agId) || findElementByPath(message.path);
                if (element) {
                    element.style[message.property] = message.value;
                    updateOverlay(selectionOverlay, element);
                }
            } else if (message.action === 'applyText') {
                const element = findElementByAgId(message.agId) || findElementByPath(message.path);
                if (element) {
                    element.textContent = message.value;
                    updateOverlay(selectionOverlay, element);
                }
            } else if (message.action === 'liveRearrange') {
                handleLiveRearrange(message.mouseY);
            } else if (message.action === 'enterDragMode') {
                // User clicked the rearrange button - enter drag mode
                isDragging = true;
                console.log('[Antigravity Bridge] Entered drag mode');
                if (selectedElement) {
                    selectedElement.style.opacity = '0.5';
                    selectedElement.style.outline = '2px dashed #0e639c';
                }
            } else if (message.action === 'exitDragMode') {
                // User cancelled drag mode
                isDragging = false;
                console.log('[Antigravity Bridge] Exited drag mode');
                if (selectedElement) {
                    selectedElement.style.opacity = '';
                    selectedElement.style.outline = '';
                }
            } else if (message.action === 'startDrag') {
                // Apply visual drag feedback to the selected element
                isDragging = true;
                if (selectedElement) {
                    selectedElement.style.opacity = '0.5';
                    selectedElement.style.outline = '2px dashed #0e639c';
                }
            } else if (message.action === 'endDrag') {
                // Remove visual drag feedback
                isDragging = false;
                if (selectedElement) {
                    selectedElement.style.opacity = '';
                    selectedElement.style.outline = '';
                }
            }
        }
    });

    function handleLiveRearrange(mouseY) {
        if (!selectedElement || !selectedElement.parentElement) return;

        const parent = selectedElement.parentElement;
        const siblings = Array.from(parent.children).filter(child =>
            child !== selectedElement && !child.id.startsWith('antigravity-')
        );

        if (siblings.length === 0) return;

        let bestTarget = null;
        let insertBefore = true;

        for (const sibling of siblings) {
            const rect = sibling.getBoundingClientRect();
            const centerY = rect.top + rect.height / 2;

            if (mouseY < centerY) {
                bestTarget = sibling;
                insertBefore = true;
                break;
            } else {
                bestTarget = sibling;
                insertBefore = false;
            }
        }

        if (bestTarget) {
            if (insertBefore) {
                if (bestTarget.previousElementSibling !== selectedElement) {
                    parent.insertBefore(selectedElement, bestTarget);
                }
            } else {
                if (bestTarget.nextElementSibling !== selectedElement) {
                    parent.insertBefore(selectedElement, bestTarget.nextElementSibling);
                }
            }
            updateOverlay(selectionOverlay, selectedElement);

            // Notify parent of new index
            const newIndex = getElementIndex(selectedElement);
            window.parent.postMessage({
                type: 'bridgeAction',
                action: 'rearrangeUpdate',
                data: {
                    newIndex: newIndex,
                    path: getElementPath(selectedElement)
                }
            }, '*');
        }
    }

    function handleOptimisticDuplicate(data) {
        console.log('[Antigravity Bridge] Optimistic Duplicate:', data);
        const element = findElementByAgId(data.agId) || findElementByPath(data.path);

        if (element && element.parentNode) {
            const clone = element.cloneNode(true);
            // Remove AgId from clone to avoid duplicates until re-indexed
            if (clone.dataset) delete clone.dataset.agId;

            element.parentNode.insertBefore(clone, element.nextSibling);
            console.log('[Antigravity Bridge] Element cloned in DOM');

            // Highlight the new element
            setTimeout(() => {
                const rect = clone.getBoundingClientRect();
                window.scrollTo({ top: rect.top - 100, behavior: 'smooth' });
                // We could also select it, but let's just show it first
            }, 100);
        } else {
            console.warn('[Antigravity Bridge] Could not find element to duplicate');
        }
    }

    function handleOptimisticDelete(data) {
        console.log('[Antigravity Bridge] Optimistic Delete:', data);
        const element = findElementByAgId(data.agId) || findElementByPath(data.path);

        if (element && element.parentNode) {
            element.style.display = 'none'; // Hide instead of remove to be safe? Or remove.
            // visual edits usually just remove.
            element.parentNode.removeChild(element);
            console.log('[Antigravity Bridge] Element removed from DOM');

            // Hide selection overlay if it was on this element
            if (selectedElement === element) {
                selectedElement = null;
                updateOverlay(selectionOverlay, null);
                updateOverlay(hoverOverlay, null);
            }
        } else {
            console.warn('[Antigravity Bridge] Could not find element to delete');
        }
    }

    function findElementByAgId(agId) {
        if (!agId) return null;
        return document.querySelector(`[data-ag-id="${agId}"]`);
    }

    function findElementByPath(pathStr) {
        if (!pathStr) return null;
        // This is tricky because pathStr is just a selector string
        // We can try querySelector
        try {
            return document.querySelector(pathStr);
        } catch (e) {
            console.warn('Invalid selector path:', pathStr);
            return null;
        }
    }

    console.log('[Antigravity Bridge] Ready and listening events');
})();
