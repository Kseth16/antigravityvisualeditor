# Antigravity Visual Editor - Agent Guidelines

This directory contains instructions and workflows for AI assistants (like me!) working on the Antigravity Visual Editor codebase.

## 📋 Files Overview

### `DEVELOPMENT.md` - **READ THIS FIRST**
**Critical architectural patterns and coding rules** for the extension. This file documents:
- How element paths MUST be generated (with nth-child selectors)
- Auto-save requirements for HMR
- Common pitfalls and how to avoid them
- AST structure patterns
- Testing checklists

**⚠️ IMPORTANT**: Any AI assistant making code changes should read this file first to avoid introducing bugs.

### `workflows/` Directory
Contains specific task workflows and instructions for common operations.

## 🤖 For AI Assistants

When working on this codebase:

1. **Always read** [`DEVELOPMENT.md`](./DEVELOPMENT.md) before making code changes
2. **Check workflows** in `.agent/workflows/` for task-specific instructions
3. **Follow the patterns** documented in DEVELOPMENT.md
4. **Test thoroughly** using the checklist in DEVELOPMENT.md
5. **Update DEVELOPMENT.md** if you discover new patterns or pitfalls

## 🔄 Keeping Guidelines Updated

When you encounter a new bug or pattern:
1. Document it in `DEVELOPMENT.md` under "Common Pitfalls" or "Code Patterns"
2. Add specific rules if it's a critical architectural requirement
3. Update the testing checklist if needed

## 📝 Example Usage

**Scenario**: User asks to add a new feature for duplicating elements

**Steps**:
1. Read `DEVELOPMENT.md` to understand path matching requirements
2. Check that your implementation includes nth-child in paths
3. Ensure auto-save is called after edits
4. Test using the checklist
5. Document any new patterns you discover

---

This system ensures consistent, high-quality code and prevents recurring bugs!
