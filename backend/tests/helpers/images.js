import sharp from "sharp";

/** Generates real image fixtures in memory (no binary files checked in). */
export const solid = (width, height, background = { r: 40, g: 120, b: 200 }) =>
  sharp({ create: { width, height, channels: 3, background } });

export const pngFixture = (w = 600, h = 400) => solid(w, h).png().toBuffer();
export const webpFixture = (w = 300, h = 300) => solid(w, h).webp().toBuffer();

/** JPEG carrying EXIF (incl. orientation=6 and a fake GPS-like comment) that must be stripped. */
export const jpegWithExifFixture = () =>
  solid(400, 200)
    .jpeg()
    .withMetadata({
      orientation: 6,
      exif: { IFD0: { Copyright: "SECRET-EXIF-MARKER", ImageDescription: "home at 51.5N 0.12W" } },
    })
    .toBuffer();

export const gifFixture = () => solid(20, 20).gif().toBuffer();
