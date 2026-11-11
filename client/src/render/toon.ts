import * as THREE from "three";

/**
 * The look of the game in one place: soft cel shading, rounded primitives,
 * pastel colours. Every model is built from these helpers so the style stays
 * consistent.
 */

export const PALETTE = {
  sky: 0xbfe8ff,
  fog: 0xdaf3ff,
  grass: 0xa9e08f,
  grassLight: 0xc4ec9f,
  grassDark: 0x86cf7b,
  path: 0xf3e2b8,
  trunk: 0xc39a6b,
  leaf: 0x7fcf8a,
  leafDeep: 0x5fbf7f,
  blossom: 0xffb3c6,
  cream: 0xfff3dc,
  skin: 0xffe0c4,
  ink: 0x4a3b57,
  blush: 0xff9eb5,
  wood: 0xd9a066,
  malletHead: 0xfff1c9,
  monster: 0xffab9e,
  monsterAngry: 0xff6f6f,
  danger: 0xff66a8,
  dangerHot: 0xff3d7d,
  dangerEdge: 0xffffff,
  dust: 0xfff6e4,
  star: 0xffd84d,
} as const;

let gradient: THREE.DataTexture | undefined;

function gradientMap(): THREE.DataTexture {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([150, 205, 240, 255]), 4, 1, THREE.RedFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}

const cache = new Map<number, THREE.MeshToonMaterial>();

/** Shared cel-shaded material for a colour. Pass `unique` to get one you may recolour. */
export function toon(color: number, unique = false): THREE.MeshToonMaterial {
  if (!unique) {
    const hit = cache.get(color);
    if (hit) return hit;
  }
  const mat = new THREE.MeshToonMaterial({ color, gradientMap: gradientMap() });
  if (!unique) cache.set(color, mat);
  return mat;
}

const sphereGeo = new THREE.SphereGeometry(1, 24, 18);

interface PartOpts {
  pos?: [number, number, number];
  scale?: [number, number, number] | number;
  rot?: [number, number, number];
  shadow?: boolean;
}

function place<T extends THREE.Object3D>(obj: T, o: PartOpts): T {
  if (o.pos) obj.position.set(...o.pos);
  if (o.rot) obj.rotation.set(...o.rot);
  if (typeof o.scale === "number") obj.scale.setScalar(o.scale);
  else if (o.scale) obj.scale.set(...o.scale);
  if (obj instanceof THREE.Mesh && o.shadow !== false) obj.castShadow = true;
  return obj;
}

/** A unit sphere, scaled. The workhorse of every cute thing. */
export function blob(mat: THREE.Material, o: PartOpts = {}): THREE.Mesh {
  return place(new THREE.Mesh(sphereGeo, mat), o);
}

export function part(geo: THREE.BufferGeometry, mat: THREE.Material, o: PartOpts = {}): THREE.Mesh {
  return place(new THREE.Mesh(geo, mat), o);
}

/** Text or emoji drawn to a sprite; textures are cached per text+colour. */
const textCache = new Map<string, THREE.Texture>();

export function textTexture(text: string, color = "#ffffff", stroke = "#4a3b57"): THREE.Texture {
  const key = `${text}|${color}|${stroke}`;
  const hit = textCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const g = canvas.getContext("2d")!;
  g.font = "900 44px Nunito, 'Trebuchet MS', system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.lineWidth = 9;
  g.strokeStyle = stroke;
  g.strokeText(text, 128, 34);
  g.fillStyle = color;
  g.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  textCache.set(key, tex);
  return tex;
}

export function textSprite(text: string, color?: string, height = 0.6): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({ map: textTexture(text, color), transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(height * 4, height, 1);
  return sprite;
}

export const ease = {
  out: (k: number) => 1 - (1 - k) ** 3,
  inOut: (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
  back: (k: number) => 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2,
};

/** Progress of `t` through [a, b], clamped to 0..1. */
export function seg(t: number, a: number, b: number): number {
  return Math.min(1, Math.max(0, (t - a) / (b - a)));
}

/** Frame-rate independent smoothing factor. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}
