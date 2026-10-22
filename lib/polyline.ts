// FILE: lib/polyline.ts
export type LatLon = readonly [number, number];

export function decodePolyline(str: string, precision = 5): LatLon[] {
  const factor = 10 ** precision;
  const out: LatLon[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < str.length) {
    for (let axis = 0; axis < 2; axis++) {
      let result = 0;
      let shift = 0;
      let b: number;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta; else lon += delta;
    }
    out.push([lat / factor, lon / factor]);
  }
  return out;
}

function encodeValue(v: number): string {
  let n = v < 0 ? ~(v << 1) : v << 1;
  let s = '';
  while (n >= 0x20) {
    s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>= 5;
  }
  return s + String.fromCharCode(n + 63);
}

export function encodePolyline(points: readonly LatLon[], precision = 5): string {
  const factor = 10 ** precision;
  let prevLat = 0;
  let prevLon = 0;
  let out = '';
  for (const [la, lo] of points) {
    const a = Math.round(la * factor);
    const o = Math.round(lo * factor);
    out += encodeValue(a - prevLat) + encodeValue(o - prevLon);
    prevLat = a;
    prevLon = o;
  }
  return out;
}
