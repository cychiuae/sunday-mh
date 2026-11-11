import * as THREE from "three";
import { ARENA_RADIUS, CAMP } from "@pufflings/shared";
import { PALETTE, blob, part, toon } from "./toon";

/** Deterministic scatter so every client sees the same meadow. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function tree(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const h = 2.2 + rand() * 1.6;
  const leaf = toon(rand() < 0.22 ? PALETTE.blossom : rand() < 0.5 ? PALETTE.leaf : PALETTE.leafDeep);
  g.add(part(new THREE.CylinderGeometry(0.35, 0.5, h, 8), toon(PALETTE.trunk), { pos: [0, h / 2, 0] }));
  g.add(blob(leaf, { pos: [0, h + 1.2, 0], scale: [2.2, 2, 2.2] }));
  g.add(blob(leaf, { pos: [1.2, h + 0.5, 0.4], scale: 1.3 }));
  g.add(blob(leaf, { pos: [-1.1, h + 0.7, -0.5], scale: 1.4 }));
  g.scale.setScalar(0.9 + rand() * 0.7);
  return g;
}

function bush(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const leaf = toon(rand() < 0.5 ? PALETTE.leaf : PALETTE.grassDark);
  g.add(blob(leaf, { pos: [0, 0.7, 0], scale: [1.4, 1, 1.4] }));
  g.add(blob(leaf, { pos: [1, 0.5, 0.2], scale: 0.8 }));
  g.add(blob(leaf, { pos: [-0.9, 0.5, -0.3], scale: 0.9 }));
  if (rand() < 0.5) g.add(blob(toon(PALETTE.blossom), { pos: [0.4, 1.3, 0.6], scale: 0.22 }));
  return g;
}

function cloud(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  for (let i = 0; i < 4; i++) {
    g.add(blob(mat, { pos: [i * 2.4 - 3.6, rand() * 0.8, rand() * 1.5], scale: [2.4, 1.5 + rand(), 2], shadow: false }));
  }
  return g;
}

function camp(): { group: THREE.Group; flame: THREE.Mesh } {
  const g = new THREE.Group();
  g.position.set(CAMP.x, 0, CAMP.z);

  const tent = new THREE.Group();
  tent.add(part(new THREE.ConeGeometry(2.6, 3.2, 6), toon(0xffd6a5), { pos: [0, 1.6, 0] }));
  tent.add(part(new THREE.ConeGeometry(1.0, 1.9, 6), toon(PALETTE.ink), { pos: [0, 0.95, -1.75], scale: [1, 1, 0.3] }));
  tent.add(blob(toon(PALETTE.blossom), { pos: [0, 3.3, 0], scale: 0.3 }));
  tent.position.set(-11, 0, 0.5);
  tent.rotation.y = 1.1;
  g.add(tent);

  const logs = toon(PALETTE.trunk);
  for (let i = 0; i < 3; i++) {
    g.add(part(new THREE.CylinderGeometry(0.16, 0.16, 1.5, 8), logs, { pos: [5.5, 0.18, -1], rot: [Math.PI / 2, 0, (i * Math.PI) / 3] }));
  }
  const flame = part(
    new THREE.ConeGeometry(0.45, 1.1, 8),
    new THREE.MeshBasicMaterial({ color: 0xffb347 }),
    { pos: [5.5, 0.8, -1], shadow: false },
  );
  g.add(flame);

  const pole = part(new THREE.CylinderGeometry(0.08, 0.08, 4, 6), toon(PALETTE.wood), { pos: [9, 2, 3] });
  const flag = part(new THREE.PlaneGeometry(1.6, 0.9), new THREE.MeshToonMaterial({ color: 0xff8fab, side: THREE.DoubleSide }), {
    pos: [9.85, 3.4, 3],
  });
  g.add(pole, flag);

  g.add(part(new THREE.BoxGeometry(1.1, 0.9, 1.1), toon(PALETTE.wood), { pos: [8, 0.45, 0.6], rot: [0, 0.4, 0] }));
  g.add(blob(toon(0xff6b8b), { pos: [8, 1.05, 0.6], scale: 0.28 }));
  g.add(blob(toon(0xff6b8b), { pos: [8.3, 1.0, 0.4], scale: 0.24 }));
  return { group: g, flame };
}

export interface World {
  update(t: number): void;
}

export function buildWorld(scene: THREE.Scene): World {
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 55, 130);

  scene.add(new THREE.HemisphereLight(0xfff6e5, 0xa5d98f, 1.15));
  const sun = new THREE.DirectionalLight(0xfff0d0, 1.9);
  sun.position.set(22, 40, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -46;
  cam.right = 46;
  cam.top = 46;
  cam.bottom = -46;
  cam.near = 1;
  cam.far = 110;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);

  const ground = part(new THREE.CircleGeometry(140, 64), toon(PALETTE.grassDark), { rot: [-Math.PI / 2, 0, 0], shadow: false });
  ground.receiveShadow = true;
  scene.add(ground);
  const meadow = part(new THREE.CircleGeometry(ARENA_RADIUS + 1, 64), toon(PALETTE.grass), {
    rot: [-Math.PI / 2, 0, 0],
    pos: [0, 0.01, 0],
    shadow: false,
  });
  meadow.receiveShadow = true;
  scene.add(meadow);
  const clearing = part(new THREE.CircleGeometry(10, 40), toon(PALETTE.path), {
    rot: [-Math.PI / 2, 0, 0],
    pos: [CAMP.x, 0.02, CAMP.z + 1],
    shadow: false,
  });
  clearing.receiveShadow = true;
  scene.add(clearing);

  const rand = seeded(20261110);

  // Lighter grass patches break up the flat meadow.
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * (ARENA_RADIUS - 3);
    const patch = part(new THREE.CircleGeometry(1.5 + rand() * 3, 20), toon(PALETTE.grassLight), {
      rot: [-Math.PI / 2, 0, 0],
      pos: [Math.cos(a) * r, 0.015, Math.sin(a) * r],
      shadow: false,
    });
    patch.receiveShadow = true;
    scene.add(patch);
  }

  // Flowers and grass tufts: instanced, purely decorative, never collide.
  const flowerColors = [0xffffff, 0xffb3c6, 0xffe066, 0xcdb4ff];
  const dummy = new THREE.Object3D();
  for (const color of flowerColors) {
    const count = 70;
    const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), toon(color), count);
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * (ARENA_RADIUS + 8);
      dummy.position.set(Math.cos(a) * r, 0.14, Math.sin(a) * r);
      dummy.scale.set(1, 0.55, 1);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    scene.add(inst);
  }
  const tufts = new THREE.InstancedMesh(new THREE.ConeGeometry(0.16, 0.5, 5), toon(PALETTE.grassDark), 260);
  for (let i = 0; i < 260; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * (ARENA_RADIUS + 6);
    dummy.position.set(Math.cos(a) * r, 0.25, Math.sin(a) * r);
    dummy.scale.setScalar(0.7 + rand() * 0.8);
    dummy.updateMatrix();
    tufts.setMatrixAt(i, dummy.matrix);
  }
  scene.add(tufts);

  // The bramble wall: a ring of bushes right on the arena edge, trees behind.
  const ring = 64;
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2;
    const b = bush(rand);
    const r = ARENA_RADIUS + 1.6 + rand() * 0.8;
    b.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    b.scale.setScalar(1.1 + rand() * 0.5);
    scene.add(b);
  }
  for (let i = 0; i < 60; i++) {
    const a = rand() * Math.PI * 2;
    const r = ARENA_RADIUS + 6 + rand() * 30;
    const t = tree(rand);
    t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    scene.add(t);
  }

  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 9; i++) {
    const c = cloud(rand);
    c.position.set((rand() - 0.5) * 220, 38 + rand() * 18, (rand() - 0.5) * 220);
    c.scale.setScalar(1.5 + rand() * 2);
    clouds.push(c);
    scene.add(c);
  }

  const { group: campGroup, flame } = camp();
  scene.add(campGroup);

  return {
    update(t: number) {
      flame.scale.set(1 + Math.sin(t * 13) * 0.12, 1 + Math.sin(t * 9) * 0.2, 1 + Math.cos(t * 11) * 0.12);
      for (let i = 0; i < clouds.length; i++) {
        clouds[i].position.x += 0.004 * (1 + (i % 3));
        if (clouds[i].position.x > 120) clouds[i].position.x = -120;
      }
    },
  };
}
