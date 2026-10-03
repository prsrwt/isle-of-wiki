/**
 * GNME chunk maths. The world is cut into square cells aligned to the origin at two sizes:
 *   chunk  (256 m)  — close-up detail: cave rocks, signs, boards, paintings, text
 *   region (1024 m) — big shapes seen from afar: terrain, cliffs, arches, spires, cave glows
 * Big regions keep the number of draw calls low for the far view; small chunks keep detail
 * tight around the player. Every object belongs to the cell containing its centre.
 * Shared so the client (drawing) and the server (physics, network interest) agree.
 */
export const CHUNK_SIZE = 256;
export const REGION_SIZE = 1024;

export const chunkCoord = (v: number, size: number = CHUNK_SIZE): number => Math.floor(v / size);

export const chunkKey = (cx: number, cz: number): string => `${cx},${cz}`;

/** Groups items by the cell (of `size`) containing the (x, z) that `pos` returns. */
export function bucketByChunk<T>(items: Iterable<T>, pos: (item: T) => [number, number], size: number = CHUNK_SIZE): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const [x, z] = pos(item);
    const key = chunkKey(chunkCoord(x, size), chunkCoord(z, size));
    const list = out.get(key);
    if (list) list.push(item);
    else out.set(key, [item]);
  }
  return out;
}

/** Inclusive cell coordinate range covering an axis-aligned area. */
export function chunkRange(minX: number, maxX: number, minZ: number, maxZ: number, size: number = CHUNK_SIZE) {
  return { cx0: chunkCoord(minX, size), cx1: chunkCoord(maxX, size), cz0: chunkCoord(minZ, size), cz1: chunkCoord(maxZ, size) };
}
