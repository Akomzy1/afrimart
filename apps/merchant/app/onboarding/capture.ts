/** ONB-3. These are image-quality estimates, never product or price readings. */
export const coaching = {
  seek: ["Point at the first shelf tag", "Line up the label and its price in the middle of the frame."],
  dark: ["Find a little more light", "Face the shelf toward the light and try again."],
  glare: ["Tilt the phone a little", "Move a step to the side so the light falls off the label."],
  far: ["Come a little closer", "Fill the middle of the frame with the product and its tag."],
  blur: ["Hold still a moment", "Rest your elbow and let the camera focus."],
  good: ["Pan slowly to the right", "A clear frame is ready. Keep the next tag in view."],
} as const;
export type Guidance = keyof typeof coaching;

export function assessFrame(rgba: Uint8ClampedArray, width: number, height: number) {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (rgba[4*i] * 77 + rgba[4*i+1] * 150 + rgba[4*i+2] * 29) / 256;
  }
  let sum = 0, bright = 0, edges = 0, lapSum = 0, lapSquares = 0, n = 0;
  const cells = new Uint32Array(16);
  const x0 = Math.floor(width / 5), y0 = Math.floor(height / 5);
  const w = width - 2*x0, h = height - 2*y0;
  for (let y = y0; y < y0+h; y++) {
    for (let x = x0; x < x0+w; x++) {
      const i = y*width + x, v = gray[i];
      sum += v;
      if (v > 245) bright++;
      const lap = gray[i-1] + gray[i+1] + gray[i-width] + gray[i+width] - 4*v;
      lapSum += lap;
      lapSquares += lap*lap;
      if (Math.abs(gray[i+1]-gray[i-1]) + Math.abs(gray[i+width]-gray[i-width]) > 40) {
        edges++;
        cells[Math.floor((y-y0)*4/h)*4 + Math.floor((x-x0)*4/w)]++;
      }
      n++;
    }
  }
  const mean = sum/n;
  const sharpness = lapSquares/n - (lapSum/n)**2;
  const coverage = cells.filter(count => count >= n/800).length;
  let guidance: Guidance = "good";
  if (mean < 36) guidance = "dark";
  else if (bright/n > 0.65) guidance = "glare";
  else if (sharpness < 85) guidance = "blur";
  else if (coverage < 4 || edges/n < 0.025) guidance = "far";

  // Difference hash of area averages (9 by 8), independent of camera resolution.
  const blocks = new Float64Array(72), counts = new Uint32Array(72);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const block = Math.floor(y*8/height)*9 + Math.floor(x*9/width);
      blocks[block] += gray[y*width+x];
      counts[block]++;
    }
  }
  let hash = "";
  for (let i = 0; i < 72; i++) {
    if (i % 9 !== 8) hash += blocks[i]/counts[i] > blocks[i+1]/counts[i+1] ? "1" : "0";
  }
  return { guidance, hash, score: sharpness * (1 - bright/n), mean };
}

export function sameStretch(a: {hash: string; mean: number}, b: {hash: string; mean: number}) {
  if (Math.abs(a.mean - b.mean) > 25) return false;
  let bits = 0;
  for (let i = 0; i < a.hash.length && bits <= 10; i++) if (a.hash[i] !== b.hash[i]) bits++;
  return bits <= 10;
}
