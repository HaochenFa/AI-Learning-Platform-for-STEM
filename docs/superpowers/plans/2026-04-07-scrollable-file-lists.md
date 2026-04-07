# Scrollable File Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Constrain the candidate-file list inside the upload widget and the material library list to a fixed max-height with internal scroll, so neither panel grows unboundedly when many items are present.

**Architecture:** Pure CSS change — add `max-h-*` + `overflow-y-auto` + `pr-1` (scrollbar breathing room) to the two list containers. No JS, no new components. The header row of the upload widget stays outside the scroll container so "Files (N)" and "Clear all" are always visible.

**Tech Stack:** Next.js 16, Tailwind CSS 4 utility classes

---

## File Map

| File | Change |
|------|--------|
| `web/src/app/components/FileUploadZone.tsx` | Constrain `<ul>` at line 220 |
| `web/src/app/classes/[classId]/page.tsx` | Constrain material list `<div>` at line 707 |

---

### Task 1: Constrain the candidate-file list in FileUploadZone

**Files:**
- Modify: `web/src/app/components/FileUploadZone.tsx:220`

**Context:** The `<ul className="space-y-2">` at line 220 is the list of files staged for upload. It currently grows indefinitely. The header row (lines 208-219) must remain outside the scroll zone so the file count and "Clear all" button are always visible.

- [ ] **Step 1: Apply the scroll constraint**

In `web/src/app/components/FileUploadZone.tsx`, change line 220 from:

```tsx
          <ul className="space-y-2">
```

to:

```tsx
          <ul className="max-h-60 space-y-2 overflow-y-auto pr-1">
```

`max-h-60` = 240 px ≈ 4 file cards. `pr-1` (4 px) prevents the native scrollbar from overlapping card content.

- [ ] **Step 2: Verify visually in dev server**

Start the dev server if not already running:

```bash
pnpm dev
```

Navigate to a class page → upload widget. Add 5+ files. Confirm:
- The widget height stops growing after ~4 items
- The list scrolls smoothly inside the widget
- "Files (N)" and "Clear all" remain visible above the scrollable area
- Individual file cards are not clipped by the scrollbar

- [ ] **Step 3: Commit**

```bash
git add web/src/app/components/FileUploadZone.tsx
git commit -m "fix: constrain upload candidate list to scrollable fixed height"
git push origin HEAD
git push org HEAD
```

---

### Task 2: Constrain the material library list in the class page

**Files:**
- Modify: `web/src/app/classes/[classId]/page.tsx:707`

**Context:** The `<div className="mt-4 space-y-2">` at line 707 wraps the entire material list (or the empty-state placeholder). It grows without bound when a class has many materials.

- [ ] **Step 1: Apply the scroll constraint**

In `web/src/app/classes/[classId]/page.tsx`, change line 707 from:

```tsx
            <div className="mt-4 space-y-2">
```

to:

```tsx
            <div className="mt-4 max-h-[22rem] space-y-2 overflow-y-auto pr-1">
```

`max-h-[22rem]` = 352 px ≈ 4–5 material cards (each card is taller due to `p-4` + optional processing bar). Arbitrary value is preferred over a Tailwind step here because the card height doesn't align to a clean step.

- [ ] **Step 2: Verify visually in dev server**

Navigate to a class with 5+ materials. Confirm:
- The Materials library card height stays fixed once the list exceeds `22rem`
- The list scrolls inside the card
- The card header ("Materials library" + item count) stays visible above the scrollable area
- Processing-state animation bars still render correctly inside scrolled items
- Empty-state ("No materials yet") renders normally with no excessive whitespace

- [ ] **Step 3: Commit**

```bash
git add web/src/app/classes/[classId]/page.tsx
git commit -m "fix: constrain material library list to scrollable fixed height"
git push origin HEAD
git push org HEAD
```

---

## Self-Review

**Spec coverage:**
- Upload candidate file area → scrollable: ✅ Task 1
- Upload widget overall height stable: ✅ header stays outside `<ul>`
- Material library → scrollable: ✅ Task 2
- Widget grows without limitation: ✅ both addressed

**Placeholder scan:** No TBD/TODO/similar items present.

**Type consistency:** No type changes — CSS only.
