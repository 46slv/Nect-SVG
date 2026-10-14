import { invoke, isTauri } from '@tauri-apps/api/core';
export const desktop = isTauri();
export async function saveFile(contents, name, kind) {
  if (desktop && kind === 'png')
    return invoke('save_png', {
      bytes: Array.from(new Uint8Array(await contents.arrayBuffer())),
      suggestedName: name,
    });
  if (desktop) return invoke('save_document', { contents, suggestedName: name, kind });
  const a = document.createElement('a'),
    url = URL.createObjectURL(
      new Blob([contents], {
        type: kind === 'svg' ? 'image/svg+xml' : kind === 'png' ? 'image/png' : 'application/json',
      }),
    );
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
export async function openFile() {
  return desktop ? invoke('open_document') : null;
}
