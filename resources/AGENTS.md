# AI Code Generation Rules

**IMPORTANT**: When generating or modifying HTML, JSX, or TSX code in this project, ALWAYS follow these rules for compatibility with the Antigravity Visual Editor.

## Required Structure

1. **Use proper tag structure** - Opening/closing tags on separate lines, properly indented
2. **Add identifiers** - Give key sections `id` or `class`/`className` attributes
3. **No fragments for editable elements** - Avoid `<>...</>` for elements that need visual editing
4. **Wrap logical groups** - Cards, list items, etc. should be wrapped in container elements
5. **Direct text content** - Use `<p>Text here</p>` not `<p>{textVariable}</p>` for editable text
6. **Inline styles in JSX** - Use `style={{ camelCase: 'value' }}` format

## Quick Examples

**DO:**
```jsx
<section id="features" className="features-section">
  <div className="feature-card">
    <h3>Feature Title</h3>
    <p>Feature description text here.</p>
  </div>
</section>
```

**DON'T:**
```jsx
<>
  <h3>{title}</h3>
  <p>{description}</p>
</>
```

## Full Guidelines

See `.agent/workflows/code-generation.md` for complete rules.
