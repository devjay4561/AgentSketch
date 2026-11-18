/**
 * Rendering quality profile. The GPU flag is fixed when WebView2 starts, so the
 * profile is chosen once at launch from the native setting (see settings.go).
 * The dev server and tests have no native side and use the high profile.
 */
export interface GraphicsProfile {
  /** True when the WebView runs with GPU acceleration. */
  gpu: boolean;
  /** Total decoded image pixels kept for the visible canvas. */
  imagePixels: number;
  /** Longest decoded side for one on-screen image. */
  imageMaxSide: number;
  /** Upper bound for devicePixelRatio used by the canvas backing store. */
  maxPixelRatio: number;
  /** Re-decode an image once the wanted size exceeds the cached size by this factor. */
  redecodeFactor: number;
  smoothing: ImageSmoothingQuality;
  /** Soft shadows, gradients and other blur-based effects on the live canvas. */
  richEffects: boolean;
}

export const HIGH_PROFILE: GraphicsProfile = { gpu: true, imagePixels: 24_000_000, imageMaxSide: 4096, maxPixelRatio: 3, redecodeFactor: 1.15, smoothing: 'high', richEffects: true };
export const LOW_PROFILE: GraphicsProfile = { gpu: false, imagePixels: 8_000_000, imageMaxSide: 2048, maxPixelRatio: 2, redecodeFactor: 1.4, smoothing: 'medium', richEffects: false };

let current: GraphicsProfile = HIGH_PROFILE;
export function graphicsProfile(): GraphicsProfile { return current; }
export function setGraphicsProfile(gpu: boolean): void { current = gpu ? HIGH_PROFILE : LOW_PROFILE; }
