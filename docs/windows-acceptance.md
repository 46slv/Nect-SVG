# Native Windows acceptance checklist

## What already has evidence

GitHub-hosted Windows 2022 has built the Tauri 2 executable and unsigned current-user NSIS installer. Actual Chrome on the runner has exercised the web editor. These are separate facts: a successful Rust/NSIS build and Chrome run do **not** prove WebView2 app behavior or file-dialog durability.

The development installer is retained in a short-lived CI artifact, not a release. Keep the tested commit, run URL, artifact SHA256, Windows version and WebView2 version beside future results. Do not label an unsigned installer trusted/signed or bypass a Windows security warning as part of this checklist.

## Preconditions

Use an authorized, available Windows test environment and a new temporary test directory. Preserve existing work. Use only disposable copies for overwrite tests. Do not change system security, permissions, authentication or billing. Stop at an unexpected OS permission/security prompt and obtain the required approval. No automatic update or public distribution is configured.

## Main native flow

1. Start the built app and record the commit/version, window size and screenshot. Verify the bundled font and geometry load without dev-server access. Check the default 1600×900 and minimum supported window size; record Windows display scaling.
2. Draw a Curve with corner/handle points, close it, feed Boolean → Remap → Output, and change the original generator. Confirm the result and node values agree. Use Ctrl+Z / Ctrl+Shift+Z.
3. Save JSON through the native dialog to a new path with spaces and non-ASCII characters. Inspect that a complete UTF-8 JSON file exists, then close/reopen it and continue editing a source node. The saved file contains the model; the prior session's undo stack is not expected to persist.
4. Cancel both native Open and Save dialogs. Confirm the current document is unchanged and Save cancellation does not clear the unsaved state. Open malformed/unsupported JSON and a file over 10 MB; confirm visible failure and preservation of the current model.
5. Save over a **disposable copy** after an edit. Verify the result is complete/reloadable and no staging file is left. With a destination deliberately unavailable/read-only in the temporary test directory, confirm a visible error and preservation of the prior file. Do not change system-wide filesystem permissions.
6. Export SVG via the native dialog and open the output in an independent SVG viewer. Confirm holes, text outlines, composition order and dimensions. Export must not include the editor UI or hidden layers.
7. Make unsaved changes, try New/Open/Import SVG, and cancel the warning. Verify preservation. Separately test the native title-bar Close action with unsaved work and while a save is pending. **Native close warning/interruption behavior remains unverified and is a desktop-readiness gate.** Never use a real project for this test.
8. Open `examples/vr-converters.json`, edit the V source Curve and an R Boolean operand, save/reopen, and export. This is an editable practice fixture, not a final approved logo.

## Report format

For each step record PASS / FAIL / NOT RUN, exact commit/run, observable result, screenshot/file evidence and any recovery action. Distinguish app startup, native interaction, packaging, install/uninstall and signing. Do not mark unexecuted checks passed based on Chrome or unit tests.

## Remaining release gates

- Native WebView2/dialog/close acceptance above.
- Cancelled dev-dependency patch update must receive authorization before retry; see [dependency-security.md](dependency-security.md).
- Further SVG fidelity, font import/shaping, large-document performance and cloud CPU/isolation limits are outside this first usable acceptance. Their absence must remain explicit.
- Protected-main merge, signing, release publication, deployment and security/account changes need their own authority. This checklist does not authorize them.
