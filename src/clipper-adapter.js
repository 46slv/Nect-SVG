import { ClipperOffset, JoinType } from 'clipper2-ts';

// Deliberately tied to clipper2-ts 2.0.1-18. These runtime methods are private in
// its TypeScript declarations. The dependency pin and source-integrity test are
// mandatory: upgrading requires reviewing this adapter and rerunning all tests.
// Clipper's clipping/cleanup engine remains unchanged. This adapter only makes
// joins match Nect: true bevel after exceeding the miter limit, including limits
// from 1 to 2, and no almost-straight miter optimization for a requested bevel.
export class NectClipperOffset extends ClipperOffset {
  doSquare(path, j, k) {
    const cosine = this.normals[j].x * this.normals[k].x + this.normals[j].y * this.normals[k].y;
    this.doMiter(path, j, k, cosine);
  }

  doMiter(path, j, k, cosine) {
    // Squared ratio |tip - vertex|² / delta² = 2 / (1 + cos(turn)).
    const withinLimit = 1 + cosine > 0 && 2 / (1 + cosine) <= this.miterLimit * this.miterLimit;
    if (this.joinType === JoinType.Bevel || !withinLimit) {
      super.doBevel(path, j, k);
    } else {
      super.doMiter(path, j, k, cosine);
    }
  }
}
