import pngjs from "pngjs";

const { PNG } = pngjs;

/**
 * Cuts a tall PNG into horizontal tiles `tileHeight` px high so each can be read at full resolution.
 * Returns no tiles when the image is less than 1.25× the tile height.
 */
export function tilePng(buffer: Buffer, tileHeight: number): Buffer[] {
  const png = PNG.sync.read(buffer);
  if (png.height <= tileHeight * 1.25) return [];
  const tiles: Buffer[] = [];
  for (let y = 0; y < png.height; y += tileHeight) {
    const height = Math.min(tileHeight, png.height - y);
    const tile = new PNG({ width: png.width, height });
    PNG.bitblt(png, tile, 0, y, png.width, height, 0, 0);
    tiles.push(PNG.sync.write(tile));
  }
  return tiles;
}
