import { cloneDocument } from './core.js';

// Core snapshots/validation freeze asset records. Keep that side effect on
// candidate-only wrappers, including when an unvalidated input is rejected.
export function candidateDocument(doc) {
  const input = { ...doc };
  for (const key of ['fontAssets', 'imageAssets']) {
    const assets = input[key];
    if (assets === undefined) continue;
    if (!assets || typeof assets !== 'object' || Array.isArray(assets))
      throw Error('Invalid artwork assets');
    input[key] = Object.fromEntries(
      Object.entries(assets).map(([id, asset]) => {
        if (!asset || typeof asset !== 'object' || Array.isArray(asset))
          throw Error('Invalid artwork asset record');
        return [id, Object.isFrozen(asset) ? asset : { ...asset }];
      }),
    );
  }
  return cloneDocument(input);
}
