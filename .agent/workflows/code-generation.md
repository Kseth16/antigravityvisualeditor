---
description: Rules for generating code compatible with Antigravity Visual Editor
---

# Code Generation Guidelines for Antigravity Visual Editor

When generating or modifying HTML/JSX/TSX code, **ALWAYS** follow these rules to ensure the code is compatible with the Antigravity Visual Editor's element tracking, duplication, deletion, rearranging, and styling features.

## Core Principles

The Antigravity Visual Editor uses **AST-based parsing** (Abstract Syntax Tree) to:
- Track element positions in source code
- Inject `data-ag-id` attributes for element identification
- Perform operations like duplicate, delete, move, and style changes

Code must be structured so the AST parser (`htmlparser2` for HTML, `@babel/parser` for JSX/TSX) can accurately identify and manipulate elements.

---

## HTML Code Rules

### 1. Use Proper Tag Structure
**DO:**
```html
<div class="card">
  <h2>Title</h2>
  <p>Description</p>
</div>
```

**DON'T:**
```html
<div class="card"><h2>Title</h2><p>Description</p></div>
```
> Inline elements on a single line make duplication and rearranging harder to read.

### 2. Give Semantic Elements Unique Identifiers
**DO:**
```html
<section id="features">
  <div class="feature-card">...</div>
  <div class="feature-card">...</div>
</section>
```

**DON'T:**
```html
<div>
  <div>...</div>
  <div>...</div>
</div>
```
> Without IDs or classes, elements are harder to target and identify.

### 3. Avoid Fragment-like Structures
**DO:**
```html
<div class="container">
  <header>...</header>
  <main>...</main>
</div>
```

**DON'T:**
```html
<>
  <header>...</header>
  <main>...</main>
</>
```
> The parser skips fragments (`<>...</>`) as they can't have attributes.

### 4. Keep Elements Self-Contained
Each element that should be duplicatable/deletable must be a complete, self-contained block:

**DO:**
```html
<article class="blog-post">
  <h3>Post Title</h3>
  <p>Post content here...</p>
  <button>Read More</button>
</article>
```

**DON'T:**
```html
<h3>Post Title</h3>
<p>Post content here...</p>
<button>Read More</button>
<!-- These are separate elements, not a logical group -->
```

---

## React/JSX/TSX Code Rules

### 1. Use Standard JSX Elements
**DO:**
```jsx
<div className="card">
  <h2>Title</h2>
</div>
```

**DON'T:**
```jsx
<React.Fragment>
  <h2>Title</h2>
</React.Fragment>
```
> Fragments cannot receive `data-ag-id` attributes and are skipped.

### 2. Wrap Logical Groups in Container Elements
**DO:**
```jsx
<section className="services">
  <div className="service-item">
    <h3>Service 1</h3>
    <p>Description</p>
  </div>
  <div className="service-item">
    <h3>Service 2</h3>
    <p>Description</p>
  </div>
</section>
```

**DON'T:**
```jsx
<>
  <h3>Service 1</h3>
  <p>Description</p>
  <h3>Service 2</h3>
  <p>Description</p>
</>
```

### 3. Prefer Direct Style Objects
**DO:**
```jsx
<div style={{ backgroundColor: '#1a1a2e', padding: '20px' }}>
  Content
</div>
```

**DON'T:**
```jsx
<div style={computedStyleObject}>
  Content
</div>
```
> The editor can modify inline style objects directly but not computed/referenced styles.

### 4. Use Static className Strings
**DO:**
```jsx
<button className="btn btn-primary">Click</button>
```

**ACCEPTABLE:**
```jsx
<button className={`btn ${isActive ? 'active' : ''}`}>Click</button>
```

**DON'T (when possible):**
```jsx
<button className={getButtonClasses()}>Click</button>
```
> Static strings are easier to parse and modify.

### 5. Keep Components Flat When Possible
**DO:**
```jsx
function Card() {
  return (
    <div className="card">
      <h2 className="card-title">Title</h2>
      <p className="card-body">Description</p>
    </div>
  );
}
```

**AVOID (for visual editing):**
```jsx
function Card() {
  const title = <h2>Title</h2>;
  const body = <p>Description</p>;
  return <div>{title}{body}</div>;
}
```
> JSX assigned to variables is harder to track positionally.

### 6. Avoid Inline Conditional Rendering for Editable Content
**DO:**
```jsx
<div className="hero">
  <h1>Welcome</h1>
  <p>Subtitle text here</p>
</div>
```

**AVOID:**
```jsx
<div className="hero">
  {showTitle && <h1>Welcome</h1>}
  {showSubtitle && <p>Subtitle</p>}
</div>
```
> Conditional elements may not be visible for editing and their positions shift.

---

## Structure for Rearrangeable Elements

When creating lists or repeating elements that should be rearrangeable:

### 1. Use Consistent Sibling Structure
**DO:**
```jsx
<ul className="feature-list">
  <li className="feature-item">Feature 1</li>
  <li className="feature-item">Feature 2</li>
  <li className="feature-item">Feature 3</li>
</ul>
```

### 2. Each Item Should Be a Direct Child
**DO:**
```html
<div class="grid">
  <div class="grid-item">Item 1</div>
  <div class="grid-item">Item 2</div>
  <div class="grid-item">Item 3</div>
</div>
```

**DON'T:**
```html
<div class="grid">
  <div class="row">
    <div class="grid-item">Item 1</div>
    <div class="grid-item">Item 2</div>
  </div>
  <div class="grid-item">Item 3</div>
</div>
```
> Mixed nesting makes rearranging unpredictable.

---

## Style Editing Compatibility

### 1. Use Standard CSS Properties
**DO:**
```jsx
style={{ backgroundColor: '#ff6b6b', fontSize: '16px' }}
```

**DON'T:**
```jsx
style={{ '--custom-color': '#ff6b6b' }}
```
> CSS variables are harder to parse and modify.

### 2. Use camelCase for JSX Styles
**DO:**
```jsx
style={{ marginTop: '20px', borderRadius: '8px' }}
```

**DON'T:**
```jsx
style={{ 'margin-top': '20px' }}
```
> The parser expects camelCase property names.

---

## Text Content Editing

### 1. Direct Text Content is Preferred
**DO:**
```jsx
<p>This is the paragraph content</p>
```

**DON'T:**
```jsx
<p>{paragraphContent}</p>
```
> Direct text can be edited; variable references cannot.

### 2. Avoid Mixed Text Content
**DO:**
```jsx
<p>Welcome to our website</p>
```

**ACCEPTABLE:**
```jsx
<p>Welcome, <strong>friend</strong>!</p>
```

**DON'T:**
```jsx
<p>{greeting} {userName}!</p>
```

---

## Summary Checklist

Before generating code, verify:

- [ ] Elements have proper opening and closing tags
- [ ] Key sections have `id` or `class`/`className` attributes
- [ ] No fragments (`<>`) for elements that need to be editable
- [ ] Logical groups are wrapped in container elements
- [ ] Sibling elements have consistent structure for rearranging
- [ ] Styles use inline objects with camelCase properties
- [ ] Text content is direct, not from variables
- [ ] Code is properly indented for readability
- [ ] No computed or dynamic classNames for primary styling
- [ ] Each duplicatable item is self-contained

---

## Quick Reference

| Operation | Requirement |
|-----------|-------------|
| **Duplicate** | Element must be a complete tag with content |
| **Delete** | Element must have clear start/end positions |
| **Move/Rearrange** | Elements must be direct siblings at same level |
| **Style Edit** | Use inline `style` objects or `className` strings |
| **Text Edit** | Use direct text content, not variables |
