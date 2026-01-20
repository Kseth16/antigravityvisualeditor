---
description: How to handle visual editing requests with element context
---

# Visual Editor Context Workflow

When the user mentions visual editing, changing styles, or refers to "this element", "the selected element", "make this", etc., ALWAYS:

1. First, read the context file to see what element is selected:
   ```
   Read file: .antigravity-context.json
   ```

2. Parse the JSON to understand:
   - `selectedElement.tagName` - The HTML tag (h1, div, button, etc.)
   - `selectedElement.className` - CSS classes
   - `selectedElement.id` - Element ID if present
   - `selectedElement.path` - Full CSS selector path
   - `selectedElement.textContent` - Text inside the element
   - `selectedElement.styles` - Current CSS styles
   - `selectedElement.sourceLocation.file` - Which file contains this element
   - `selectedElement.sourceLocation.line` - Line number

3. When applying changes:
   - Open the file from `sourceLocation.file`
   - Find the element using the tag, id, or class
   - Apply the requested style/text change directly

## Example Commands

| User Says | What To Do |
|-----------|------------|
| "Make this blue" | Read context → find element → add `style="color: blue;"` |
| "Add more padding" | Read context → find element → add/update `padding` style |
| "Change text to Hello" | Read context → replace text content |
| "Make this bigger" | Read context → increase `font-size` |
| "Center this" | Read context → add `text-align: center` |

## Quick Reference

To apply a style change:
1. Read `.antigravity-context.json`
2. Get `selectedElement.sourceLocation.file` and `selectedElement.sourceLocation.line`
3. Open that file
4. Find the element (use tagName + id/class)
5. Add/modify the `style` attribute

## Context File Location

The file `.antigravity-context.json` is in the workspace root. It's updated every time the user selects a new element in the Visual Editor.

## Code Generation Rules

When generating or modifying HTML/JSX/TSX code in this workspace, **automatically apply the rules from `.agent/workflows/code-generation.md`** to ensure compatibility with the Visual Editor. Key rules include:

- Use proper element structure with opening/closing tags on separate lines
- Give key sections `id` or `class`/`className` attributes
- Avoid fragments (`<>...</>`) for elements that need to be editable
- Wrap logical groups in container elements
- Use direct text content, not variables
- Use inline `style` objects with camelCase properties for JSX
