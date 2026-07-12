/**
 * Shared master-bus limiter configuration.
 *
 * Used by both the live engine and the offline export so the exported mix
 * matches what you hear: a soft limiter that protects headroom when many tracks
 * sum together, rather than letting the mix hard-clip.
 */

export function createLimiter(ctx: BaseAudioContext): DynamicsCompressorNode {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.1;
  return limiter;
}
