import sharp from "sharp";

// Difference hash (dHash): grayscale → 9x8 → compare each pixel to its right neighbour
// → 64 bits. Native decode via sharp (fast, no CPU limit). Returns null if undecodable.
export async function dHash(buf) {
  try {
    const { data } = await sharp(buf)
      .removeAlpha()
      .grayscale()
      .resize(9, 8, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    // 1 channel, length 72
    let hash = 0n;
    let bit = 0n;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (data[y * 9 + x] > data[y * 9 + x + 1]) hash |= 1n << bit;
        bit++;
      }
    }
    return hash;
  } catch {
    return null;
  }
}

export function hamming(a, b) {
  let x = a ^ b;
  let count = 0;
  while (x) {
    x &= x - 1n;
    count++;
  }
  return count;
}

export const toHex = (h) => h.toString(16).padStart(16, "0");
export const fromHex = (s) => BigInt("0x" + s);
