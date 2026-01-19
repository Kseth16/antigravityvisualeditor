import * as vscode from 'vscode';

/**
 * DiffPreviewProvider - Shows code changes with inline highlighting
 * 
 * For ADDITIONS: Green highlight on added lines
 * For DELETIONS: Red ghost text showing what was deleted
 * 
 * Changes are applied immediately, user can Accept (save) or Reject (revert)
 */
export class DiffPreviewProvider implements vscode.CodeLensProvider, vscode.HoverProvider {
    private static instance: DiffPreviewProvider;

    // CodeLens event emitter
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    // Decoration types
    private addedLineDecoration: vscode.TextEditorDecorationType;
    private modifiedLineDecoration: vscode.TextEditorDecorationType;

    // Dynamic decoration for deleted content (recreated each time with specific content)
    private deletedContentDecorations: vscode.TextEditorDecorationType[] = [];

    // Pending change info
    private pendingChange: {
        document: vscode.TextDocument;
        oldContent: string;
        newContent: string;
        description: string;
        addedLines: number[];
        deletedLines: { afterLine: number; content: string }[];
        deletedLineNumbers: number[]; // Track which lines contain deletion comments
        changeCount: number;
    } | null = null;

    // Track the editor with decorations
    private decoratedEditor: vscode.TextEditor | null = null;

    // Disposables
    private disposables: vscode.Disposable[] = [];

    private constructor() {
        console.log('[DiffPreview] Creating decoration types');

        // Green background for added lines
        this.addedLineDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(46, 160, 67, 0.25)',
            isWholeLine: true,
            overviewRulerColor: 'rgba(46, 160, 67, 0.8)',
            overviewRulerLane: vscode.OverviewRulerLane.Full,
            before: {
                contentText: '+',
                color: 'rgba(46, 160, 67, 1)',
                fontWeight: 'bold',
                width: '15px',
                margin: '0 5px 0 0'
            }
        });

        // Yellow/orange for modified lines
        this.modifiedLineDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(227, 179, 65, 0.20)',
            isWholeLine: true,
            overviewRulerColor: 'rgba(227, 179, 65, 0.8)',
            overviewRulerLane: vscode.OverviewRulerLane.Full,
            before: {
                contentText: '~',
                color: 'rgba(227, 179, 65, 1)',
                fontWeight: 'bold',
                width: '15px',
                margin: '0 5px 0 0'
            }
        });

        console.log('[DiffPreview] Decoration types created');
    }

    public static getInstance(): DiffPreviewProvider {
        if (!DiffPreviewProvider.instance) {
            DiffPreviewProvider.instance = new DiffPreviewProvider();
        }
        return DiffPreviewProvider.instance;
    }

    /**
     * Register the provider and commands with VS Code
     */
    public static register(context: vscode.ExtensionContext): DiffPreviewProvider {
        const provider = DiffPreviewProvider.getInstance();

        console.log('[DiffPreview] Registering provider...');

        // Register CodeLens provider for all languages
        const codeLensReg = vscode.languages.registerCodeLensProvider(
            { scheme: 'file' },
            provider
        );

        // Register Hover provider
        const hoverReg = vscode.languages.registerHoverProvider(
            { scheme: 'file' },
            provider
        );

        // Register accept/reject commands
        const acceptCmd = vscode.commands.registerCommand(
            'antigravity.acceptChanges',
            () => provider.acceptPendingChange()
        );

        const rejectCmd = vscode.commands.registerCommand(
            'antigravity.rejectChanges',
            () => provider.rejectPendingChange()
        );

        context.subscriptions.push(codeLensReg, hoverReg, acceptCmd, rejectCmd);
        provider.disposables.push(codeLensReg, hoverReg, acceptCmd, rejectCmd);

        console.log('[DiffPreview] Provider registered successfully');
        return provider;
    }

    /**
     * Provide CodeLens items at the top of files with pending changes
     */
    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        if (!this.pendingChange || this.pendingChange.document.uri.toString() !== document.uri.toString()) {
            return [];
        }

        console.log('[DiffPreview] Providing CodeLens');

        const lenses: vscode.CodeLens[] = [];
        const topOfFile = new vscode.Range(0, 0, 0, 0);
        const addCount = this.pendingChange.addedLines.length;
        const delCount = this.pendingChange.deletedLines.length;

        // Top-of-file CodeLens
        lenses.push(
            new vscode.CodeLens(topOfFile, {
                title: '✓ Accept Changes',
                command: 'antigravity.acceptChanges',
                tooltip: 'Save all changes'
            }),
            new vscode.CodeLens(topOfFile, {
                title: '✗ Reject Changes',
                command: 'antigravity.rejectChanges',
                tooltip: 'Discard all changes and revert'
            }),
            new vscode.CodeLens(topOfFile, {
                title: `${this.pendingChange.description} (+${addCount} -${delCount})`,
                command: '',
                tooltip: `${this.pendingChange.changeCount} change(s) pending`
            })
        );

        // Add CodeLens for each added line
        for (const lineNum of this.pendingChange.addedLines) {
            if (lineNum < document.lineCount) {
                const range = new vscode.Range(lineNum, 0, lineNum, 0);
                lenses.push(
                    new vscode.CodeLens(range, {
                        title: 'Added Line',
                        command: '',
                        tooltip: 'This line was added'
                    })
                );
            }
        }

        // Add CodeLens for each deleted line
        for (const lineNum of this.pendingChange.deletedLineNumbers) {
            if (lineNum < document.lineCount) {
                const range = new vscode.Range(lineNum, 0, lineNum, 0);
                lenses.push(
                    new vscode.CodeLens(range, {
                        title: 'Deleted Line',
                        command: '',
                        tooltip: 'This line was deleted'
                    })
                );
            }
        }

        return lenses;
    }

    /**
     * Provide hover info on highlighted lines
     */
    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | null {
        if (!this.pendingChange || this.pendingChange.document.uri.toString() !== document.uri.toString()) {
            return null;
        }

        const lineNum = position.line;
        const isAddedLine = this.pendingChange.addedLines.includes(lineNum);
        const isDeletedLine = this.pendingChange.deletedLineNumbers.includes(lineNum);

        if (isAddedLine) {
            const markdown = new vscode.MarkdownString();
            markdown.isTrusted = true;
            markdown.appendMarkdown(`**Added Line**\n\n`);
            markdown.appendMarkdown(`[Accept ✓](command:antigravity.acceptChanges) | `);
            markdown.appendMarkdown(`[Reject ✗](command:antigravity.rejectChanges)`);
            return new vscode.Hover(markdown);
        }

        if (isDeletedLine) {
            const markdown = new vscode.MarkdownString();
            markdown.isTrusted = true;
            markdown.appendMarkdown(`**Deleted Line**\n\n`);
            markdown.appendMarkdown(`[Accept ✓](command:antigravity.acceptChanges) | `);
            markdown.appendMarkdown(`[Reject ✗](command:antigravity.rejectChanges)`);
            return new vscode.Hover(markdown);
        }

        return null;
    }

    /**
     * Record a change - this is called by CodeSync
     */
    public async recordChange(
        document: vscode.TextDocument,
        newContent: string,
        description: string = 'Visual Editor Change'
    ): Promise<boolean> {
        console.log('[DiffPreview] ========== RECORD CHANGE ==========');
        console.log('[DiffPreview] File:', document.fileName);
        console.log('[DiffPreview] Description:', description);

        const currentContent = document.getText();

        if (currentContent === newContent) {
            console.log('[DiffPreview] No changes detected');
            return false;
        }

        // Calculate diff
        const diff = this.calculateDiff(currentContent, newContent);
        console.log('[DiffPreview] Added lines:', diff.addedLines.length);
        console.log('[DiffPreview] Deleted lines:', diff.deletedLines.length);

        if (!this.pendingChange) {
            // First change - start a new session
            console.log('[DiffPreview] Starting new diff session');
            this.pendingChange = {
                document,
                oldContent: currentContent,
                newContent,
                description,
                addedLines: diff.addedLines,
                deletedLines: diff.deletedLines,
                deletedLineNumbers: [], // Will be populated below
                changeCount: 1
            };
        } else {
            // Subsequent change - accumulate
            console.log('[DiffPreview] Accumulating change');
            this.pendingChange.newContent = newContent;
            this.pendingChange.description = `${this.pendingChange.description} + ${description}`;
            this.pendingChange.addedLines = diff.addedLines;
            this.pendingChange.deletedLines = diff.deletedLines;
            this.pendingChange.changeCount++;

            // Recalculate diff from original
            const newDiff = this.calculateDiff(this.pendingChange.oldContent, newContent);
            this.pendingChange.addedLines = newDiff.addedLines;
            this.pendingChange.deletedLines = newDiff.deletedLines;
        }

        // For deletions, insert content back as commented lines to avoid overlap
        let contentToApply = newContent;
        let deletedLineNumbers: number[] = [];

        // If accumulating, we need to account for existing deletion comments
        if (this.pendingChange && this.pendingChange.changeCount > 1) {
            // Start with existing deleted line numbers
            deletedLineNumbers = [...this.pendingChange.deletedLineNumbers];
        }

        if (diff.deletedLines.length > 0) {
            const lines = newContent.split('\n');
            const oldLines = currentContent.split('\n');

            // Insert deleted lines as comments at their positions
            let insertOffset = 0;
            for (const deleted of diff.deletedLines.sort((a, b) => a.afterLine - b.afterLine)) {
                const insertAt = deleted.afterLine + 1 + insertOffset;
                const commentedLine = `<!-- DELETED: ${deleted.content.trim()} -->`;
                lines.splice(insertAt, 0, commentedLine);
                deletedLineNumbers.push(insertAt);
                insertOffset++;
            }

            contentToApply = lines.join('\n');
        }

        // Update pending change with current deleted line numbers
        if (this.pendingChange) {
            this.pendingChange.deletedLineNumbers = deletedLineNumbers;

            // Filter out deletion comment lines from addedLines
            // Deletion comments should NEVER be marked as additions
            this.pendingChange.addedLines = this.pendingChange.addedLines.filter(
                lineNum => !deletedLineNumbers.includes(lineNum)
            );
        }

        // Apply the change to the document (unsaved)
        await this.applyToDocument(document, contentToApply);

        // Find an existing editor that already has this document open
        let editor = vscode.window.visibleTextEditors.find(
            e => e.document.uri.toString() === document.uri.toString()
        );

        // If no existing editor found, show the document in the same column as active editor
        if (!editor) {
            const activeColumn = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;
            editor = await vscode.window.showTextDocument(document, {
                preview: false,
                preserveFocus: false,
                viewColumn: activeColumn
            });
        }

        // Apply decorations (pass deleted line numbers for red highlighting)
        await this.applyDecorations(editor, deletedLineNumbers);

        // Refresh CodeLens
        this._onDidChangeCodeLenses.fire();

        // Show notification
        vscode.window.showInformationMessage(
            `${description}: +${diff.addedLines.length} -${diff.deletedLines.length}`,
            'Accept ✓',
            'Reject ✗'
        ).then(result => {
            if (result === 'Accept ✓') {
                this.acceptPendingChange();
            } else if (result === 'Reject ✗') {
                this.rejectPendingChange();
            }
        });

        return true;
    }

    /**
     * Calculate diff between old and new content
     * Uses a forward-pass algorithm that correctly handles insertions and deletions
     * without falsely detecting shifted content as new.
     * 
     * Returns added line numbers (in new content) and deleted lines (content + position)
     */
    private calculateDiff(oldContent: string, newContent: string): {
        addedLines: number[];
        deletedLines: { afterLine: number; content: string }[];
    } {
        const oldLines = oldContent.split('\n');
        const newLines = newContent.split('\n');

        const addedLines: number[] = [];
        const deletedLines: { afterLine: number; content: string }[] = [];

        // Track which lines are matched
        const matchedOld = new Set<number>();
        const matchedNew = new Set<number>();

        // Build a map of old line content -> indices (for quick lookup)
        const oldLineMap = new Map<string, number[]>();
        for (let i = 0; i < oldLines.length; i++) {
            const line = oldLines[i];
            if (!oldLineMap.has(line)) {
                oldLineMap.set(line, []);
            }
            oldLineMap.get(line)!.push(i);
        }

        // Forward pass: try to match each new line to an old line
        // Prioritize same-position matches, then nearby matches
        let expectedOldIdx = 0;

        for (let newIdx = 0; newIdx < newLines.length; newIdx++) {
            const newLine = newLines[newIdx];

            // Skip empty/whitespace-only lines for matching purposes
            const isWhitespaceOnly = newLine.trim() === '';

            // Check if there's a match at the expected old position
            if (expectedOldIdx < oldLines.length &&
                !matchedOld.has(expectedOldIdx) &&
                oldLines[expectedOldIdx] === newLine) {
                matchedOld.add(expectedOldIdx);
                matchedNew.add(newIdx);
                expectedOldIdx++;
                continue;
            }

            // Look for the nearest unmatched old line with same content
            const candidateOldIndices = oldLineMap.get(newLine) || [];
            let bestMatch = -1;
            let bestDistance = Infinity;

            for (const oldIdx of candidateOldIndices) {
                if (!matchedOld.has(oldIdx)) {
                    const distance = Math.abs(oldIdx - expectedOldIdx);
                    if (distance < bestDistance) {
                        bestDistance = distance;
                        bestMatch = oldIdx;
                    }
                }
            }

            if (bestMatch !== -1) {
                matchedOld.add(bestMatch);
                matchedNew.add(newIdx);
                // Update expected based on where we found the match
                if (bestMatch >= expectedOldIdx) {
                    expectedOldIdx = bestMatch + 1;
                }
            }
            // If no match found and it's not just whitespace, it's a new line
            // (we'll collect these after this loop)
        }

        // Lines in new that aren't matched = added (but filter out empty lines)
        for (let lineNum = 0; lineNum < newLines.length; lineNum++) {
            if (!matchedNew.has(lineNum)) {
                // Only count non-empty lines as additions
                if (newLines[lineNum].trim() !== '') {
                    addedLines.push(lineNum);
                }
            }
        }

        // Lines in old that aren't matched = deleted (but filter out empty lines)
        let deletionOffset = 0; // Track cumulative effect of additions/deletions

        for (let lineNum = 0; lineNum < oldLines.length; lineNum++) {
            if (!matchedOld.has(lineNum)) {
                // Only count non-empty lines as deletions
                if (oldLines[lineNum].trim() !== '') {
                    // The position to show this deletion is approximately the same line number
                    // in the new content, adjusted for any lines added/deleted before this point
                    // Start with the original line number
                    let afterLine = lineNum + deletionOffset;

                    // Clamp to valid range in new content
                    afterLine = Math.max(0, Math.min(afterLine, newLines.length - 1));

                    deletedLines.push({
                        afterLine,
                        content: oldLines[lineNum]
                    });

                    // This deletion will shift subsequent positions up by 1
                    deletionOffset--;
                }
            } else {
                // This line matched, so check if there are new lines inserted after it
                // Find the corresponding new line number
                for (let ni = 0; ni < newLines.length; ni++) {
                    if (matchedNew.has(ni) && oldLines[lineNum] === newLines[ni]) {
                        // If the new line is further down than expected, lines were inserted
                        const expectedNewLine = lineNum + deletionOffset;
                        if (ni > expectedNewLine) {
                            deletionOffset += (ni - expectedNewLine);
                        }
                        break;
                    }
                }
            }
        }

        return { addedLines, deletedLines };
    }





    /**
     * Apply content to document without saving
     */
    private async applyToDocument(document: vscode.TextDocument, content: string): Promise<boolean> {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );
        edit.replace(document.uri, fullRange, content);
        return await vscode.workspace.applyEdit(edit);
    }

    /**
     * Apply decorations to show diff
     */
    private async applyDecorations(editor: vscode.TextEditor, deletedLineNumbers: number[] = []): Promise<void> {
        if (!this.pendingChange) return;

        // Clear previous decorations
        this.clearDecorations();
        this.decoratedEditor = editor;

        // Apply green highlights for added lines
        const addedRanges: vscode.Range[] = [];
        for (const lineNum of this.pendingChange.addedLines) {
            if (lineNum < editor.document.lineCount) {
                const line = editor.document.lineAt(lineNum);
                addedRanges.push(new vscode.Range(lineNum, 0, lineNum, line.text.length));
            }
        }
        editor.setDecorations(this.addedLineDecoration, addedRanges);

        // Apply red highlights with strikethrough for deleted comment lines
        const deletedRanges: vscode.Range[] = [];
        for (const lineNum of deletedLineNumbers) {
            if (lineNum < editor.document.lineCount) {
                const line = editor.document.lineAt(lineNum);
                deletedRanges.push(new vscode.Range(lineNum, 0, lineNum, line.text.length));
            }
        }

        // Create red decoration for deleted lines
        const deletedLineDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(248, 81, 73, 0.25)',
            isWholeLine: true,
            textDecoration: 'line-through',
            color: 'rgba(203, 213, 225, 0.6)',
            fontStyle: 'italic',
            overviewRulerColor: 'rgba(248, 81, 73, 0.8)',
            overviewRulerLane: vscode.OverviewRulerLane.Full
        });
        this.deletedContentDecorations.push(deletedLineDecoration);
        editor.setDecorations(deletedLineDecoration, deletedRanges);

        // Scroll to first change
        const firstChange = this.pendingChange.addedLines[0] ?? deletedLineNumbers[0];
        if (firstChange !== undefined && firstChange < editor.document.lineCount) {
            editor.revealRange(
                new vscode.Range(firstChange, 0, firstChange, 0),
                vscode.TextEditorRevealType.InCenter
            );
        }

        console.log('[DiffPreview] Decorations applied');
    }

    /**
     * Accept pending change and save
     */
    public async acceptPendingChange(): Promise<boolean> {
        console.log('[DiffPreview] ========== ACCEPT CHANGE ==========');

        if (!this.pendingChange) {
            console.log('[DiffPreview] No pending change');
            return false;
        }

        try {
            // Remove all <!-- DELETED: ... --> comment lines before saving
            const doc = this.pendingChange.document;
            const currentText = doc.getText();
            const lines = currentText.split('\n');
            const cleanedLines = lines.filter(line => !line.trim().match(/^<!--\s*DELETED:/));
            const cleanedContent = cleanedLines.join('\n');

            // Apply the cleaned content
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
                doc.positionAt(0),
                doc.positionAt(currentText.length)
            );
            edit.replace(doc.uri, fullRange, cleanedContent);
            await vscode.workspace.applyEdit(edit);

            // Save the document
            await this.pendingChange.document.save();

            console.log('[DiffPreview] Changes saved');
            vscode.window.showInformationMessage(
                `✓ ${this.pendingChange.changeCount} change(s) saved!`
            );

            // Cleanup
            this.cleanup();

            return true;

        } catch (error) {
            console.error('[DiffPreview] Error accepting changes:', error);
            vscode.window.showErrorMessage(`Error saving: ${error}`);
            return false;
        }
    }

    /**
     * Reject pending change and revert
     */
    public async rejectPendingChange(): Promise<void> {
        console.log('[DiffPreview] ========== REJECT CHANGE ==========');

        if (!this.pendingChange) {
            console.log('[DiffPreview] No pending change');
            return;
        }

        try {
            // Revert to original content
            await this.applyToDocument(this.pendingChange.document, this.pendingChange.oldContent);

            console.log('[DiffPreview] Changes reverted');
            vscode.window.showInformationMessage(
                `✗ ${this.pendingChange.changeCount} change(s) discarded`
            );

            // Cleanup
            this.cleanup();

        } catch (error) {
            console.error('[DiffPreview] Error rejecting changes:', error);
        }
    }

    /**
     * Clear all decorations
     */
    private clearDecorations(): void {
        if (this.decoratedEditor) {
            this.decoratedEditor.setDecorations(this.addedLineDecoration, []);
            this.decoratedEditor.setDecorations(this.modifiedLineDecoration, []);

            // Dispose and clear dynamic deleted content decorations
            for (const dec of this.deletedContentDecorations) {
                dec.dispose();
            }
            this.deletedContentDecorations = [];

            this.decoratedEditor = null;
        }
    }

    /**
     * Cleanup pending state
     */
    private cleanup(): void {
        this.pendingChange = null;
        this.clearDecorations();
        this._onDidChangeCodeLenses.fire();
        console.log('[DiffPreview] Cleanup complete');
    }

    /**
     * Check if there are pending changes
     */
    public hasPendingChanges(): boolean {
        return this.pendingChange !== null;
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        this.cleanup();
        this.addedLineDecoration.dispose();
        this.modifiedLineDecoration.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
