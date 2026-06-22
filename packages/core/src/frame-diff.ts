// frameChanged — pure, dependency-free "did the screen change?" decision for the filmstrip
// collector. CDP Page.startScreencast is already compositor-change-driven (it only emits a frame
// when the screen changes), so this primarily suppresses byte-identical / near-identical
// consecutive frames. It compares the base64 JPEG payloads via a length delta + a sampled-byte
// mismatch ratio against epsilon — no image decode, so no native dependency.
//
// Note (documented limitation): this is a byte-level approximation, not a true pixel-percentage
// diff. It reliably distinguishes "identical" (ratio 0) from "changed", which is what the
// change-driven screencast needs. A true Speed-Index pixel diff would require decoding frames
// (e.g. via sharp) and is deferred.

const MAX_SAMPLES = 512;

export function frameChanged(prev: string | null, curr: string, epsilon: number): boolean {
  if (prev === null) return true; // first frame is always a change
  if (prev === curr) return false; // byte-identical → no change
  const maxLen = Math.max(prev.length, curr.length, 1);
  const lenDelta = Math.abs(prev.length - curr.length) / maxLen;

  const minLen = Math.min(prev.length, curr.length);
  const stride = Math.max(1, Math.floor(minLen / MAX_SAMPLES));
  let samples = 0;
  let mismatches = 0;
  for (let i = 0; i < minLen; i += stride) {
    samples++;
    if (prev.charCodeAt(i) !== curr.charCodeAt(i)) mismatches++;
  }
  const sampleRatio = samples > 0 ? mismatches / samples : 0;
  const ratio = Math.max(lenDelta, sampleRatio);
  return ratio > epsilon;
}
