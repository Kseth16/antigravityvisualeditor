---
description: Development guidelines and architectural patterns for Antigravity Visual Editor
---

# Antigravity Visual Editor - Development Guidelines

This document provides critical architectural patterns, coding standards, and common pitfalls for developing the Antigravity Visual Editor VS Code extension.

## 🏗️ Architecture Overview

### Core Components

1. **PreviewPanel** (`src/preview/PreviewPanel.ts`)
   - Manages the webview preview (HTML or React dev server iframe)
   - Handles messages from webview (element selection, edits)
   - Delegates edit operations to CodeSync

2. **CodeSync** (`src/sync/CodeSync.ts`)
   - Central coordinator for applying visual edits to source code
   - Sanitizes DOM paths from browser to AST paths
   - Delegates to HtmlParser or ReactParser based on file type
   - Auto-saves after edits to trigger HMR

3. **ReactParser** (`src/parser/ReactParser.ts`)
   - AST-based parsing for React/JSX/TSX files
   - **CRITICAL**: Must generate paths with nth-child selectors
   - Uses exact string matching: `el.path === path`

4. **DiffPreviewProvider** (`src/diff/DiffPreviewProvider.ts`)
   - Shows inline diffs with green/red decorations
   - Provides Accept/Reject CodeLens actions
   - Auto-saves on reject to revert changes

## ⚠️ Critical Rules

### 1. Path Generation & Matching

**RULE**: All element paths MUST include nth-child selectors for elements without IDs.

**Why**: The browser sends paths like `#services > div:nth-child(1) > h2:nth-child(1)`, and ReactParser uses exact string matching (`el.path === path`).

**Implementation**:
```typescript
// ✅ CORRECT - Include nth-child
buildPath(..., childIndex) {
  if (!attribs.id && childIndex !== undefined) {
    current += `:nth-child(${childIndex + 1})`; // +1 because nth-child is 1-indexed
  }
}

// ❌ WRONG - Missing nth-child
buildPath(...) {
  return tagName; // Will never match browser paths!
}
```

**When to include nth-child**:
- ✅ All elements WITHOUT an `id` attribute
- ❌ Elements WITH an `id` attribute (IDs are unique)
- ✅ Calculate at parse time using sibling count

### 2. Path Sanitization

**RULE**: Remove preview-specific prefixes before passing to parsers.

**Implementation** (`CodeSync.sanitizePath`):
```typescript
private static sanitizePath(path: string): string {
  const prefixesToRemove = [
    '#preview-content > ',
    '#root > ',
    'html > body > #root > '
  ];
  // Remove these prefixes...
}
```

**Always call** `sanitizePath()` before passing paths to `ReactParser.findElementByPath()`.

### 3. Auto-Save for HMR

**RULE**: Always auto-save after applying edits to trigger Hot Module Replacement.

```typescript
// In CodeSync.applyEdit
const success = await diffProvider.recordChange(document, newContent, description);
if (success) {
  console.log('[CodeSync] Auto-saving to trigger HMR');
  await document.save(); // ✅ CRITICAL for HMR
}
```

**Why**: React dev servers (Vite, etc.) watch the filesystem. Changes only reload when saved.

### 4. React Parser - Child Index Calculation

**RULE**: Calculate child index BEFORE creating the element.

```typescript
// ✅ CORRECT
let childIndex = 0;
if (elementStack.length > 0) {
  const parent = elementStack[elementStack.length - 1];
  childIndex = parent.children.length; // Current count = this child's index
}

const element = {
  path: this.buildPath(elementStack, tagName, attributes, childIndex)
};

// Add element to parent AFTER building path
parent.children.push(element);
```

**Why**: The child index represents the position BEFORE the element is added to its parent.

### 5. AST Location Structure

**RULE**: Always use the correct AST location structure.

```typescript
// ✅ CORRECT - Babel AST structure
location: {
  startLine: node.loc?.start.line || 0,
  startColumn: node.loc?.start.column || 0,
  endLine: node.loc?.end.line || 0,
  endColumn: node.loc?.end.column || 0
}

// ❌ WRONG - Don't access .line directly on location
console.log(element.location.line); // WILL CRASH
```

## 🎯 Common Pitfalls

### Pitfall 1: Path Mismatch
**Symptom**: "Element not found" errors during duplication/deletion
**Cause**: Paths don't include nth-child or have wrong format
**Fix**: Ensure `buildPath()` includes nth-child for non-ID elements

### Pitfall 2: Auto-Save Missing
**Symptom**: Preview doesn't update after edits
**Cause**: Forgot `await document.save()` after applying change
**Fix**: Add auto-save in both `applyEdit` and `rejectPendingChange`

### Pitfall 3: Accessing Undefined Properties
**Symptom**: "Cannot read properties of undefined" errors
**Cause**: Trying to access nested properties without checking existence
**Fix**: Use optional chaining `?.` or check for undefined

### Pitfall 4: Duplicate Element IDs
**Symptom**: `data-ag-id` collisions or tracking failures
**Cause**: Global `lastIdMap` not cleared between parses
**Fix**: Clear or scope ID maps appropriately

## 📝 Code Patterns

### Pattern 1: Handling React vs HTML Files

```typescript
const isReact = document.languageId === 'javascriptreact' || 
                document.languageId === 'typescriptreact';

if (isReact) {
  const parser = new ReactParser(content, document.languageId === 'typescriptreact');
  const cleanPath = this.sanitizePath(elementPath);
  const element = parser.findElementByPath(cleanPath);
  // ...
} else {
  // HTML handling
}
```

### Pattern 2: Element Path Building

```typescript
// Calculate child index from parent's current children count
const childIndex = parent ? parent.children.length : 0;

// Build path with nth-child
let selector = tagName;
if (attributes.id) {
  selector = '#' + attributes.id; // IDs are unique, no nth-child needed
} else {
  if (attributes.className) {
    selector += '.' + attributes.className.split(' ')[0];
  }
  selector += `:nth-child(${childIndex + 1})`; // +1 for 1-indexed
}
```

### Pattern 3: Safe Property Access

```typescript
// ✅ CORRECT
const startLine = element.location?.startLine ?? 0;
const tagName = element?.tagName || 'unknown';

// ❌ WRONG
const startLine = element.location.startLine; // May crash
```

## 🧪 Testing Checklist

When making changes, always verify:

- [ ] Paths are generated with nth-child selectors
- [ ] Auto-save is triggered after edits
- [ ] Preview updates via HMR (no manual refresh)
- [ ] Duplication works for elements with/without IDs
- [ ] Deletion works for all element types
- [ ] No console errors or crashes
- [ ] Works for both React and HTML files

## 🔍 Debug Logging Best Practices

```typescript
// ✅ GOOD - Simple, safe logging
console.log('[ComponentName] Action:', value);
console.log('[ReactParser] Built path:', path);

// ❌ BAD - Accessing potentially undefined properties
console.log('[ReactParser] Line:', element.location.start.line); // May crash

// ✅ BETTER - Safe property access
console.log('[ReactParser] Line:', element.location?.startLine ?? 'unknown');
```

## 📚 Key Files Reference

- [`ReactParser.ts`](../src/parser/ReactParser.ts) - AST parsing for React files
- [`CodeSync.ts`](../src/sync/CodeSync.ts) - Edit coordination and path sanitization  
- [`PreviewPanel.ts`](../src/preview/PreviewPanel.ts) - Webview management
- [`DiffPreviewProvider.ts`](../src/diff/DiffPreviewProvider.ts) - Inline diff display

## 🚀 Before Committing

1. Run `npm run build` - Ensure TypeScript compiles
2. Test in Extension Development Host (F5)
3. Try duplicate, delete, and style edits on both React and HTML
4. Verify HMR works (no manual refresh needed)
5. Check console for errors

---

**Last Updated**: 2026-01-20  
**Version**: 1.0.0
