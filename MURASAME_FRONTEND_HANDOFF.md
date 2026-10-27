# Murasame Studio frontend implementation handoff

## Task for Codex on Debian

Finish and verify the frontend modernization of `murasame-code`. Implement the requirements below; do not stop at a proposal. Preserve the existing kawaii anime identity and Senren Banka / 千恋＊万花 Murasame theme while making the desktop app feel like a coherent modern coding and working interface.

The user approved this direction and authorized implementation. This document is the implementation brief and acceptance contract. Read any applicable `AGENTS.md` files before editing. Inspect the actual checkout before assuming that the partial changes described here are present.

## Product and architecture

- Electron desktop app, with plain HTML/CSS/JavaScript renderer; no frontend framework migration is needed.
- `desktop/desktop.html`: workbench markup, chat, file editor, terminal, settings and dialogs.
- `desktop/desktop.css`: base workbench styles and theme variables.
- `desktop/workbench.css`: workbench components and responsive rules.
- `desktop/desktop.js`: renderer interactions and Electron IPC calls.
- `desktop/workbench-i18n.cjs`: Chinese-keyed English and Japanese interface translations.
- `desktop/main.cjs`: window lifecycle, desktop pet, tray and backend IPC handlers.
- `desktop/index.html`, `desktop/renderer.js`, `desktop/styles/animations.css`, and `desktop/fgimages/`: existing pet experience. Inspect actual responsibilities before changing these.
- `desktop/assets/icon.png` and `desktop/assets/backgrounds/`: existing character and background assets to reuse.
- `src/ui.tsx`: terminal CLI UI, outside the main redesign scope.

The main workbench currently requests 1180 × 800 with a minimum of 780 × 560 in `desktop/main.cjs`. These are the primary desktop verification sizes. Smaller browser previews are useful stress tests but are not the current native window minimum.

## Current partial implementation: verify before continuing

As of this handoff, the following local changes were applied, without visual or functional verification:

1. `desktop/desktop.html` loads a new `studio.css` after the existing two stylesheets.
2. The header includes a STUDIO wordmark and an accessible character image.
3. Chat, Files and Terminal navigation buttons contain separate icon and label spans; Chat initially has `aria-current="page"`.
4. A navigation footer contains a decorative blossom, 千恋＊万花 text, and a new `#studio-settings` button with `aria-controls` and `aria-expanded`.
5. The welcome panel includes the existing avatar and greeting, a small workspace kicker, and a decorative flower.
6. The new, initially untracked `desktop/studio.css` supplies the sidebar layout, palette, dark theme, welcome card, chat/composer/editor/terminal refinements, responsive rules and reduced-motion support.

**The renderer integration was interrupted before being applied.** `desktop/desktop.js` was not modified. In particular, the new settings button is not wired, navigation ARIA state is not updated dynamically, and selected-file styling is not wired. A proposed patch for these tasks was rejected during interruption; do not assume it ran.

No frontend screenshots, build, typecheck, lint or tests were completed for these changes. Do not report the current partial implementation as finished.

If transferring from Windows, copy or commit both the modified HTML and the untracked `desktop/studio.css`; a clone of the remote repository may not contain them. If only this document reaches Debian, implement the same direction from the available checkout. Do not copy `node_modules` from Windows.

## Design direction: Murasame Studio

Create a focused, comfortable workspace with the warmth of an anime companion.

### Identity and visual language

- Preserve Murasame artwork, avatar customization, backgrounds, Japanese greeting, 千恋＊万花 references and desktop pet behavior.
- Use warm ivory and sage green for the light theme, lavender for selected/chat accents, and restrained sakura pink details where useful.
- Use deep charcoal green surfaces with readable sage/lavender accents for the dark theme.
- Keep backgrounds subtle behind work surfaces. Character art must remain recognizable without obscuring content.
- Concentrate decorative elements in branding and the welcome state. Avoid excessive floating particles, glowing effects, ornamental borders or large empty promotional sections.
- Use consistent spacing, borders, corner radii, icons and interaction states. Replace provisional Unicode icons with a coherent local SVG set if font rendering is inconsistent; decorative icons must not replace accessible labels.
- Use readable UI fonts with Chinese/Japanese fallbacks and proper monospace fonts for code. Do not rely on downloaded fonts or remote assets to render the app correctly.

### Layout

- Compact header containing brand and existing new-session, pet and tray actions.
- Slim left sidebar containing Chat, Files, Terminal, current workspace and Settings.
- A clear active navigation state and a main panel that uses the remaining width and height.
- Collapse sidebar labels at compact widths while retaining accessible names and useful tooltips.
- Long workspace paths must truncate visually and remain available through a tooltip.
- Settings must remain usable above the main content without clipping or being hidden by stacking contexts.
- Preserve existing view switching. A split editor/chat layout or new session-history backend is not required.

### Chat and composer

- Refined welcome panel with existing portrait, greeting and short explanation.
- Useful project-summary and issue-check suggestions that still populate the composer correctly.
- Readable messages, code blocks, tables, links, error states and distinct tool activity cards.
- Composer anchored at the bottom with clear send/stop actions, working state and slash-command suggestions.
- Long conversations scroll within their region; the composer remains reachable.
- Long code lines and tables scroll horizontally without stretching the whole application.

### Files and terminal

- Clear file list, directory navigation, selected-file styling, path header and saved/unsaved state.
- Comfortable editor typography, spacing and Markdown preview.
- Terminal with strong contrast, readable output, command input and working stop/clear controls.
- Preserve current editor and terminal capabilities. A new syntax-highlighting editor, PTY terminal or language server is not required.

## Implementation tasks

1. Inspect Git status and existing instructions; preserve unrelated local changes.
2. Review the partial HTML and `studio.css` in the actual checkout. Consolidate redundant CSS where practical; avoid an endless cascade of conflicting overrides.
3. Wire `#studio-settings` to open/close the existing `#app-menu`. Keep `aria-expanded` synchronized for sidebar clicks, outside clicks, Escape and the native menu action. Focus a meaningful control when opening; return focus to the trigger on Escape. Ensure keyboard navigation remains usable. Use appropriate dialog/menu semantics for the actual mixed controls.
4. Update `setPage()` so only the active navigation button has `aria-current="page"`. Give collapsed buttons translated accessible names and titles without destroying icon spans.
5. Update `translateWorkbench()` carefully. It currently walks static text nodes. Keep dynamic workspace paths out of translation, translate added labels, and preserve names across repeated Chinese/English/Japanese switches.
6. Add file selection state using the actual file path returned by the backend. Synchronize selection after file loading, refreshing, workspace changes and directory navigation. Set an appropriate accessible state. Do not alter file contents while selecting files.
7. Confirm new colors are legible in both themes, including enabled buttons, placeholders, disabled controls, error states and terminal controls. Use explicit foreground/background pairs for dark-theme action buttons.
8. Check empty, loading, running, stopped, error, long-content and narrow-window states. Decorative content must not compress the conversation into an unusable strip at minimum height.
9. Preserve model/provider configuration, language preferences, avatar/background persistence, permission prompts, pet/tray actions and existing IPC contracts.
10. Perform the verification below, fix defects and deliver the final files with evidence.

Keep this primarily a frontend change. Avoid adding new runtime dependencies unless there is a concrete need. Never embed real API keys, credentials or user-specific paths in examples or screenshots.

## Debian setup and execution

Use the repository's actual package scripts and lockfile. Its declared Node requirement is at least 18.18; CI currently covers Node 18, 20 and 22. Prefer an installed compatible Node release and record the version used.

```bash
git status --short
node --version
npm --version
npm ci
npm run typecheck
npm test
npm run lint
npm run build
node --check desktop/desktop.js
node --check desktop/workbench-i18n.cjs
git diff --check
```

For a Debian desktop session:

```bash
npm run desktop
```

For a headless Debian environment, use Xvfb or a suitable display-backed Electron harness. Example, after confirming Xvfb is installed:

```bash
xvfb-run -a npm run desktop
```

An interactive app command will keep running; capture screenshots and run bounded interaction checks through available automation. Check Electron startup errors for missing Debian shared libraries and install the needed packages using the environment's normal permission flow. Prefer running Electron as a regular user with its sandbox enabled; do not make disabling sandboxing a product change.

A browser-only preview can help inspect CSS but cannot verify Electron IPC, file operations, model configuration or pet/tray behavior. Do not treat it as a complete integration check.

`npm run build:linux` is available for an optional AppImage packaging smoke check if the environment supports it. Packaging is not required to demonstrate the frontend update; report separately whether it was attempted.

## Verification and acceptance criteria

### Visual checks

- Inspect actual rendered screenshots, not only source code.
- Capture light and dark chat views at 1180 × 800.
- Inspect the workbench at its 780 × 560 native minimum: navigation, welcome panel, composer and action controls must remain usable.
- Inspect Files and Terminal in both themes, plus Settings and the model configuration dialog.
- Check a long workspace path, long messages, fenced code, a wide Markdown table, long filenames and long terminal output.
- No unintended viewport scrolling, clipped action buttons, unreadable overlays or overlapping panels.
- Normal text should meet WCAG AA contrast targets (4.5:1); large text and meaningful UI boundaries should meet applicable 3:1 targets. Check real computed colors and backgrounds rather than palette swatches alone.
- Focus states are visible and decorative icons are hidden from assistive technology. Honor reduced-motion preferences.

### Functional checks

| Area | Action | Expected result |
| --- | --- | --- |
| Navigation | Switch Chat → Files → Terminal → Chat | Correct view and active/ARIA state; existing view content remains coherent |
| Settings | Open from sidebar and native menu; close by trigger, outside click and Escape | Correct visibility, synchronized expanded state and predictable focus |
| Themes | Toggle light/dark, restart | All surfaces update; existing preference persistence works |
| Languages | Cycle Chinese → English → Japanese → Chinese | Labels, placeholders, accessible names and tooltips update without breaking icons or dynamic paths |
| Suggestions | Activate each suggestion | Correct task fills the composer and receives focus |
| Composer | Enter, Shift+Enter, slash command keyboard selection | Existing send/newline/command behavior works |
| Chat | Send a task and stop a running task using a configured model or deterministic IPC harness | Correct messages, working controls and recovery; no duplicate submission |
| New session | Create/clear a session through existing controls | Expected session reset; welcome/suggestions and composer remain usable |
| Files | Open a directory/file, refresh, switch directories | Correct content and selection; no unintended file modification |
| Save | Edit a disposable fixture, save, reopen | Unsaved/saved state correct; exact content persists |
| Markdown | Toggle source/preview on a fixture | Correct view and button state without losing content |
| Terminal | Submit a harmless command, clear output, stop a long-running fixture command | Correct workspace/output and control state; input remains accessible |
| Customization | Select/upload/reset avatar and backgrounds | Existing persistence and readable surfaces remain intact |
| Lifecycle | Switch to pet, reopen workbench, hide/reopen from tray | Existing behavior works on supported desktop environment |
| Dialogs | Open, navigate and dismiss configuration/choice/permission dialogs | Readable controls, working keyboard interaction and unchanged actions |

Use a temporary fixture workspace for edits and commands. A real model call is optional if credentials are unavailable; a deterministic harness can exercise renderer states, but clearly distinguish mocked behavior from live backend validation. Do not claim an unperformed test passed. Tray and pet behavior may require a real desktop session; record any limitation explicitly.

### Automated checks

Run all commands listed in setup. The existing lint script covers `src` and `test`, so a passing lint result does not by itself validate the plain renderer JavaScript. Use syntax checks and actual renderer console inspection as well.

Add focused regression coverage where it is valuable for new interaction/state behavior, using existing project conventions or a lightweight harness. Do not add tests that merely assert CSS text or mirror implementation details. Record pre-existing failures separately from regressions caused by this update.

## Final deliverables

1. Completed frontend implementation in the repository, including any new stylesheet/assets in the transferable change set.
2. A short change summary explaining layout, theme, interaction and accessibility improvements.
3. Screenshots of light/dark Chat, Files, Terminal and compact layout, with local artifact paths in the completion report.
4. Verification results: commands run, pass/fail status, functional checks performed, environment versions and any mocked checks.
5. Explicit remaining limitations, if any. Do not label the task complete while required interactions are broken or the UI has not been visually inspected.
6. A concise changed-file list and instructions to launch the updated app on Debian.

The finished result should feel recognizably like Murasame's workspace, with the clarity and reliability needed for everyday coding. Preserve character identity while making the work itself easy to read and operate.
