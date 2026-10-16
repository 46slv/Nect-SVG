# Native Windows acceptance checklist

## What already has evidence

GitHub-hosted Windows 2022 has built the Tauri 2 executable and unsigned current-user NSIS installer. Actual Chrome on the runner has exercised the web editor. These are separate facts: a successful Rust/NSIS build and Chrome run do **not** prove WebView2 app behavior or file-dialog durability.

The development installer is retained in a short-lived CI artifact, not a release. Keep the tested commit, run URL, artifact SHA256, Windows version and WebView2 version beside future results. Do not label an unsigned installer trusted/signed or bypass a Windows security warning as part of this checklist.

## Preconditions

For a disposable standalone run, first follow the process-local storage contract in
[Isolated native acceptance build](native-acceptance-build.md). Its unit/build evidence does not
establish native app acceptance.

Use an authorized, available Windows test environment and a new temporary test directory. Preserve existing work. Use only disposable copies for overwrite tests. Do not change system security, permissions, authentication or billing. Stop at an unexpected OS permission/security prompt and obtain the required approval. No automatic update or public distribution is configured.

## Main native flow

1. Start the built app and record the commit/version, window size and screenshot. Verify the bundled font and geometry load without dev-server access. Check the default 1600×900 and minimum supported window size; record Windows display scaling.
2. Draw a Curve with corner/handle points, close it, feed Boolean → Remap → Output, and change the original generator. Confirm the result and node values agree. Use Ctrl+Z / Ctrl+Shift+Z.
3. Save JSON through the native dialog to a new path with spaces and non-ASCII characters. Inspect that a complete UTF-8 JSON file exists, then close/reopen it and continue editing a source node. The saved file contains the model; the prior session's undo stack is not expected to persist.
4. Cancel both native Open and Save dialogs. Confirm the current document is unchanged and Save cancellation does not clear the unsaved state. Open malformed/unsupported JSON and a project over 50 MB; confirm visible failure and preservation of the current model.
5. Save over a **disposable copy** after an edit. Verify the result is complete/reloadable and no staging file is left. With a destination deliberately unavailable/read-only in the temporary test directory, confirm a visible error and preservation of the prior file. Do not change system-wide filesystem permissions.
6. Export SVG via the native dialog and open the output in an independent SVG viewer. Confirm holes, text outlines, composition order and dimensions. Export must not include the editor UI or hidden layers.
7. Make unsaved changes, try New/Open/Import SVG, and cancel the warning. Verify preservation. Separately test the native title-bar Close action with unsaved work and while a save is pending. **Native close warning/interruption behavior remains unverified and is a desktop-readiness gate.** Never use a real project for this test.
8. Open `examples/vr-converters.json`, edit the V source Curve and an R Boolean operand, save/reopen, and export. This is an editable practice fixture, not a final approved logo.

9. Load a licensed Japanese static TTF/OTF through the Text picker, set Vertical, edit punctuation/long marks/Latin and line spacing. Save JSON, restart the native app, reopen and enter previously unused characters. Confirm its embedded font is available without the original file. Cancel font selection, load a malformed/oversized font, and edit while a font read is pending; confirm preservation. Repeat at normal and high DPI. The Chrome equivalent has passed, but this native step is NOT RUN.

## Report format

For each step record PASS / FAIL / NOT RUN, exact commit/run, observable result, screenshot/file evidence and any recovery action. Distinguish app startup, native interaction, packaging, install/uninstall and signing. Do not mark unexecuted checks passed based on Chrome or unit tests.

## Remaining release gates

- Native WebView2/dialog/close acceptance above.
- Cancelled dev-dependency patch update must receive authorization before retry; see [dependency-security.md](dependency-security.md).
- Further SVG fidelity, advanced text shaping, large-document performance and cloud CPU/isolation limits are outside this first usable acceptance. Their absence must remain explicit.
- Protected-main merge, signing, release publication, deployment and security/account changes need their own authority. This checklist does not authorize them.

### Installed-font native acceptance

In the packaged Windows app, verify automatic system and per-user face lists, choose a static Latin font and both faces of an installed Japanese TTC (for example Meiryo), then edit Japanese vertical text. Confirm selected face names, punctuation, undo/redo, save/reopen with newly typed characters and identical SVG output. Verify unsupported variable/color faces are disabled; restricted embedding is rejected without changing the document. Confirm cancellation/manual picker, removed font file, concurrent document edits and locked layers remain safe. Test a standard per-user installation after restart. This actual WebView2/installed-Japanese-font acceptance is NOT RUN by synthetic DOM tests or NSIS packaging alone.

### Installed-font CI evidence (2026-10-14)

Commit `f2e924df7045013ce784c1ebe9f34daec846e9f8`, [Windows run 38566656095](https://github.com/46slv/Nect-SVG/actions/runs/38566656095), passed 83 JavaScript tests, actual Chrome interaction tests, 7 Rust tests and NSIS packaging. On that runner, native extraction of `msgothic.ttc` produced the MS Gothic face; the existing JavaScript parser, editable-embedding checks, Japanese horizontal/vertical outline evaluation and JSON reload all passed. Extracted installed-font bytes were deleted and were not uploaded as artifacts.

This verifies native font-file extraction and headless layout on Windows. The packaged WebView2 font list, native IPC/UI integration, dialogs, install/uninstall and high-DPI acceptance above remain NOT RUN. The checked-in Cargo.lock preserves the matched Tauri 2.9 native crate baseline; CI tests and builds with `--locked`.

## Character position prototype

Open `examples/character-position-prototype.json`, select either Text and choose Character position. Verify final-output character boxes follow the rotated/scaled artwork, a drag changes only selected glyphs, nearby ΔXY stays usable inside the canvas, and Undo/Reset work. Select overlapping glyphs/branches through the explicit choice, then drag the chosen instance. Text Position and Position OUT must remain unchanged. Inspect the horizontal/vertical screenshots from `character-position.e2e.js` on the exact packaged commit.

Native Japanese IME remains a separate manual check: with an existing adjusted character, insert and convert Japanese before it, cancel another composition, replace one character, then commit and Undo. Unchanged IDs/offsets must remain attached to the correct characters, composition must not commit intermediate fragments, and app Undo must restore the completed transaction in one step. Synthetic DOM composition events and headless Chrome are not evidence of native WebView2 IME acceptance.

### Same-layer Reference acceptance

`tests/vector-reference.e2e.js` is included in the full real-Chrome suite. Its sample checks typed selection, source Jump/edit, cycle rollback, group duplicate, collapsed visibility, delete/Undo/Redo/reload, stable rename, lock behavior, ordinary-wire SVG equivalence and PNG export. Evidence: `workflow-vector-reference.json`, `workflow-vector-reference.svg`, `workflow-vector-reference.png`, `vector-reference-ui.png`. Local unit/DOM/build results alone do not establish Chrome or NSIS acceptance; verify the exact published commit. Native WebView2 interactions remain separate.

## Character rotation and uniform scale

Open `examples/character-transform.json`. In Character position, adjust Rotate ° / Scale × in both Inspector and floating controls, then select several characters with different values. Verify absolute property changes preserve other values and use independent cell pivots. Reset XY must retain shape; Reset shape must retain XY; Undo restores either in one step. Save/restart/reload schema4, drag a shaped character through the downstream Transform, and compare SVG/PNG with the canvas without any overlay. Inspect `workflow-character-transform-horizontal.png`, `-vertical.png`, `-japanese.png` and JSON/SVG/PNG from the exact-commit Windows artifact. Native IME: retain shape-only adjustments while inserting/converting Japanese before the adjusted character, cancel a composition, replace one character, commit and Undo. This native acceptance is NOT RUN by DOM tests, real Chrome or NSIS packaging alone.

## Wrap width native acceptance

Open `examples/text-wrap-width.json` in the packaged WebView2 app. Change width narrow → wide → narrow, style a selected range across a soft boundary, and verify unchanged source text/IDs/Position. Exercise Japanese IME composition, cancellation, selection restoration, one-step Undo/Redo and numeric Escape at normal/high DPI. Confirm an overlong span remains visible with an overflow warning; SVG/PNG and saved/reopened JSON retain the same artwork. Verify vertical/Type on Path conflicts reject without discarding settings, and locked layers reject edits. Actual native UI/IME acceptance is NOT RUN by synthetic DOM, Chrome or NSIS packaging alone.
