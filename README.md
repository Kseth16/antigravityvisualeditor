# Antigravity Visual Editor

**A powerful visual editing extension for VS Code that brings Lovable-like WYSIWYG editing to your workflow.**

Focus on design without losing control of your code. Antigravity bridges the gap between visual design and source code, allowing you to edit HTML and React components visually while keeping your code clean and sync-able.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## ✨ Key Features

- **🖼️ Real-Time Preview**: precise WYSIWYG editing synchronized with your code.
- **🎨 Advanced Style Panel**: visually edit CSS (Typography, Spacing, Backgrounds, Borders) without memorizing syntax.
- **🖱️ Drag & Drop**: move elements around or rearrange lists naturally.
- **🤖 AI Agent Integration**: seamless context sharing allows you to tell your AI agent "Make this blue" or "Duplicate this", and it just works.
- **🛡️ Safe Diff Preview**: review changes in a visual diff before they are applied to your source files.
- **⚡ Batched Editing**: make multiple changes and apply them all at once.

---

## 📥 Installation

### From VSIX (Manual)
1.  Obtain the `.vsix` file package.
2.  Open VS Code and go to the **Extensions** view (`Ctrl+Shift+X`).
3.  Click the `...` menu in the top-right corner.
4.  Select **Install from VSIX...**.
5.  Choose the `antigravity-visual-editor-0.1.0.vsix` file.

---

## 🚀 Getting Started

1.  **Open a File**: Open an HTML file or a React component (`.jsx`/`.tsx`).
2.  **Launch Editor**: 
    *   Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
    *   Run **"Antigravity: Open Visual Editor"**.
    *   *Shortcut*: `Ctrl+Shift+V` (Windows/Linux) or `Cmd+Shift+V` (Mac).
3.  **Start Editing**: The editor will open side-by-side with your code.

---

## 🎨 Using the Visual Editor

### 1. Selection & Context
*   **Click** any element in the preview to select it.
*   The breadcrumb bar at the bottom shows the element's hierarchy (e.g., `BODY > DIV > CARD > H3`).
*   **Context File**: Selecting an element automatically updates the `.antigravity-context.json` file in your workspace, allowing other tools (like AI agents) to know exactly what you are looking at.

### 2. Styling (The Style Panel)
When an element is selected, the **Style Panel** opens on the right.
*   **Visual Controls**: Adjust font size, colors, padding, margins, borders, and shadows using simple inputs.
*   **Safety**: Changes are **buffered**. You see them in the preview immediately, but your code isn't touched until you save.
*   **Save/Cancel**: 
    *   Click **Save Changes** (green check) to apply edits to your source code.
    *   Click **Cancel** (red X) to revert the preview to its original state.

### 3. Text Editing
*   **Select** the text element you want to change.
*   In the Style Panel, look for the **Content** section.
*   Edit the text in the text area.
*   Click **Save Changes** to update the text in your source file.

### 4. Drag & Drop
*   **Rearrange**: Drag an element within its list to reorder it (e.g., reorder list items or cards).
*   **Drop Zones**: elements move to show where they will be placed.
*   *Note: Moving elements between different containers is not yet supported in this version.*

---

## 🤖 AI Agent Integration

Antigravity is designed to be the "eyes" for your AI coding assistant.

### The "Click-and-Chat" Workflow
1.  **Select** an element in the Visual Editor.
2.  Switch to your AI Agent (e.g., in the terminal or sidebar).
3.  **Command It**: Tell the agent what to do with the element using "/visual-editor".
    *   *The agent checks `.antigravity-context.json` to identify the target element.*

### Example Commands
*   *"/visual-editor Make this button have a red background and white text."*
*   *"/visual-editor Duplicate this card three times."*
*   *"/visual-editor Add 20px padding to this container."*
*   *"/visual-editor Change this text to 'Welcome Home'."*

---

## ⚙️ Available Commands

| Command ID | Title | Description |
| :--- | :--- | :--- |
| `antigravity.testContext` | **Test Context Provider** | Verifies that context sharing is working. |

---

## ⌨️ Shortcuts

| Action | Windows/Linux | Mac |
| :--- | :--- | :--- |
| Open Visual Editor | `Ctrl+Shift+V` | `Cmd+Shift+V` |

---

## 🛡️ Trust & Safety

*   **Diff Preview**: Antigravity never modifies your code silently. All complex changes (like moves or large edits) present a Diff Preview where you can verify the exact lines changing before accepting.
*   **Non-Destructive**: The extension works by parsing your code's AST, ensuring that structure and formatting are preserved where possible.

---

**Happy Building! 🚀**


TEST TEST