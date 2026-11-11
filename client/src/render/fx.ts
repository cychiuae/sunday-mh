import * as THREE from "three";
import { MONSTER, MState, monsterDur, type MonsterView } from "@pufflings/shared";
import { PALETTE, textTexture } from "./toon";

interface Particle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  gravity: number;
  grow: number;
  /** Opacity at birth; the particle fades out from it. */
  alpha: number;
}

interface Floater {
  sprite: THREE.Sprite;
  life: number;
  max: number;
}

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  radius: number;
}

function flatMat(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
}

/** Danger zones ignore fog so they keep their colour across the meadow. */
function zoneMat(color: number, opacity: number): THREE.MeshBasicMaterial {
  const mat = flatMat(color, opacity);
  mat.fog = false;
  return mat;
}

// Danger zones are drawn in three flat layers: the whole strike area in soft pink, a hot pink fill that grows
// until the strike lands, and a white rim on the area's outer edge. Opacities are high and the pinks lean
// magenta on purpose: thin or warm pink over grass green mixes to brown.
const ZONE_OPACITY = 0.72;
const FILL_OPACITY = 0.9;
const RIM_OPACITY = 0.95;
/** Rim thickness in world units. The rim lies inside the strike area, so the area's outline stays exact. */
const RIM_WIDTH = 0.24;

/**
 * Everything short-lived on screen: attack telegraphs, particles, damage
 * numbers, shock rings and camera shake.
 */
export class Effects {
  /** Current shake strength; the camera reads and decays it. */
  shake = 0;

  private readonly particles: Particle[] = [];
  private readonly floaters: Floater[] = [];
  private readonly rings: Ring[] = [];
  private readonly particleGeo = new THREE.IcosahedronGeometry(1, 0);
  private readonly puffGeo = new THREE.IcosahedronGeometry(1, 1);
  private readonly ringGeo = new THREE.RingGeometry(0.86, 1, 48);
  private time = 0;

  private readonly zoneMat = zoneMat(PALETTE.danger, ZONE_OPACITY);
  private readonly fillMat = zoneMat(PALETTE.dangerHot, FILL_OPACITY);
  private readonly rimMat = zoneMat(PALETTE.dangerEdge, RIM_OPACITY);

  private readonly flopZone: THREE.Mesh;
  private readonly flopFill: THREE.Mesh;
  private readonly flopRim: THREE.Mesh;
  private readonly lane = new THREE.Group();
  private readonly laneFill: THREE.Mesh;
  private readonly spinZone: THREE.Mesh;
  private readonly spinFill: THREE.Mesh;
  private readonly spinRim: THREE.Mesh;

  constructor(private readonly scene: THREE.Scene) {
    const circle = new THREE.CircleGeometry(1, 64);
    // Layers are stacked a hair apart and drawn bottom-up: area, fill, rim.
    const flat = (geo: THREE.BufferGeometry, mat: THREE.Material, layer: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.06 + layer * 0.01;
      m.visible = false;
      m.renderOrder = 2 + layer;
      return m;
    };
    const rim = (radius: number) => {
      const m = flat(new THREE.RingGeometry(1 - RIM_WIDTH / radius, 1, 64), this.rimMat, 2);
      m.scale.setScalar(radius);
      return m;
    };
    this.flopZone = flat(circle, this.zoneMat, 0);
    this.flopFill = flat(circle, this.fillMat, 1);
    this.flopRim = rim(MONSTER.flopRadius);
    this.spinZone = flat(circle, this.zoneMat, 0);
    this.spinFill = flat(circle, this.fillMat, 1);
    this.spinRim = rim(MONSTER.spinRadius);
    scene.add(this.flopZone, this.flopFill, this.flopRim, this.spinZone, this.spinFill, this.spinRim);

    // The roll lane is a strip starting at the monster, pointing along +Z.
    const strip = new THREE.PlaneGeometry(1, 1);
    strip.translate(0, 0.5, 0);
    const laneBase = flat(strip, this.zoneMat, 0);
    this.laneFill = flat(strip, this.fillMat, 1);
    const width = (MONSTER.radius + 0.7) * 2;
    const length = MONSTER.rollSpeed * monsterDur(MState.Roll, false) + MONSTER.radius;
    laneBase.scale.set(width, length, 1);
    this.laneFill.scale.set(width, length, 1);
    // The lane's rim is a frame just inside the strip's edges.
    const outline = new THREE.Shape()
      .moveTo(-width / 2, 0)
      .lineTo(width / 2, 0)
      .lineTo(width / 2, length)
      .lineTo(-width / 2, length)
      .closePath();
    outline.holes.push(
      new THREE.Path()
        .moveTo(-width / 2 + RIM_WIDTH, RIM_WIDTH)
        .lineTo(-width / 2 + RIM_WIDTH, length - RIM_WIDTH)
        .lineTo(width / 2 - RIM_WIDTH, length - RIM_WIDTH)
        .lineTo(width / 2 - RIM_WIDTH, RIM_WIDTH)
        .closePath(),
    );
    const laneRim = flat(new THREE.ShapeGeometry(outline), this.rimMat, 2);
    for (const m of [laneBase, this.laneFill, laneRim]) {
      m.visible = true;
      // +90° about X lays the strip on the ground with its length along +Z (the monster's forward).
      m.rotation.x = Math.PI / 2;
    }
    this.lane.add(laneBase, this.laneFill, laneRim);
    this.lane.visible = false;
    scene.add(this.lane);
  }

  /** Show the danger zone of whatever the monster is winding up. */
  telegraph(m: MonsterView, st: number): void {
    const dur = monsterDur(m.state, m.enraged);
    const k = dur > 0 ? Math.min(1, st / dur) : 0;

    // A gentle heartbeat on the whole zone keeps it from reading as a ground decoration.
    const beat = 0.5 + 0.5 * Math.sin(this.time * 9);
    this.zoneMat.opacity = ZONE_OPACITY - 0.1 * beat;
    this.rimMat.opacity = RIM_OPACITY - 0.25 * beat;

    const flop = m.state === MState.FlopWindup || m.state === MState.FlopAir;
    this.flopZone.visible = this.flopFill.visible = this.flopRim.visible = flop;
    if (flop) {
      const total = monsterDur(MState.FlopWindup, m.enraged) + monsterDur(MState.FlopAir, m.enraged);
      const done = m.state === MState.FlopWindup ? st : monsterDur(MState.FlopWindup, m.enraged) + st;
      this.flopZone.position.set(m.tx, 0.06, m.tz);
      this.flopZone.scale.setScalar(MONSTER.flopRadius);
      this.flopFill.position.set(m.tx, 0.07, m.tz);
      this.flopFill.scale.setScalar(MONSTER.flopRadius * Math.min(1, done / total));
      this.flopRim.position.set(m.tx, 0.08, m.tz);
    }

    const spin = m.state === MState.SpinWindup;
    this.spinZone.visible = this.spinFill.visible = this.spinRim.visible = spin;
    if (spin) {
      this.spinZone.position.set(m.x, 0.06, m.z);
      this.spinZone.scale.setScalar(MONSTER.spinRadius);
      this.spinFill.position.set(m.x, 0.07, m.z);
      this.spinFill.scale.setScalar(MONSTER.spinRadius * k);
      this.spinRim.position.set(m.x, 0.08, m.z);
    }

    const roll = m.state === MState.RollWindup;
    this.lane.visible = roll;
    if (roll) {
      this.lane.position.set(m.x, 0, m.z);
      this.lane.rotation.y = m.yaw;
      this.laneFill.scale.y = (MONSTER.rollSpeed * monsterDur(MState.Roll, false) + MONSTER.radius) * k;
    }
  }

  burst(x: number, y: number, z: number, color: number, count: number, speed = 6, size = 0.16): void {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.particleGeo, flatMat(color, 1));
      mesh.position.set(x, y, z);
      mesh.scale.setScalar(size * (0.6 + Math.random() * 0.8));
      this.scene.add(mesh);
      const a = Math.random() * Math.PI * 2;
      const up = 0.3 + Math.random() * 0.9;
      const life = 0.35 + Math.random() * 0.35;
      this.particles.push({
        mesh,
        vx: Math.cos(a) * speed * (0.4 + Math.random() * 0.6),
        vy: up * speed * 0.8,
        vz: Math.sin(a) * speed * (0.4 + Math.random() * 0.6),
        life,
        max: life,
        gravity: 16,
        grow: 0,
        alpha: 1,
      });
    }
  }

  /** Small soft puffs that drift outward along the ground and melt away. */
  dust(x: number, z: number, count: number, spread: number): void {
    for (let i = 0; i < count; i++) {
      const alpha = 0.5;
      const mesh = new THREE.Mesh(this.puffGeo, flatMat(PALETTE.dust, alpha));
      const a = ((i + Math.random()) / count) * Math.PI * 2;
      mesh.position.set(x + Math.cos(a) * spread * 0.4, 0.22, z + Math.sin(a) * spread * 0.4);
      mesh.scale.setScalar(0.22 + Math.random() * 0.12);
      this.scene.add(mesh);
      const life = 0.4 + Math.random() * 0.25;
      this.particles.push({
        mesh,
        vx: Math.cos(a) * spread * 0.8,
        vy: 0.5,
        vz: Math.sin(a) * spread * 0.8,
        life,
        max: life,
        gravity: 0,
        grow: 0.55,
        alpha,
      });
    }
  }

  ring(x: number, z: number, radius: number, color: number = 0xffffff): void {
    const mesh = new THREE.Mesh(this.ringGeo, flatMat(color, 0.9));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.1, z);
    mesh.scale.setScalar(0.5);
    this.scene.add(mesh);
    this.rings.push({ mesh, life: 0.45, max: 0.45, radius });
  }

  floatText(x: number, y: number, z: number, text: string, color: string, height = 0.9): void {
    const mat = new THREE.SpriteMaterial({ map: textTexture(text, color), transparent: true, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x + (Math.random() - 0.5) * 0.8, y, z + (Math.random() - 0.5) * 0.8);
    sprite.scale.set(height * 4, height, 1);
    sprite.renderOrder = 10;
    this.scene.add(sprite);
    this.floaters.push({ sprite, life: 0.9, max: 0.9 });
  }

  update(dt: number): void {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 2.2);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.vy -= p.gravity * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y = Math.max(0.1, p.mesh.position.y + p.vy * dt);
      p.mesh.position.z += p.vz * dt;
      if (p.grow) p.mesh.scale.addScalar(p.grow * dt);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.alpha * Math.min(1, (p.life / p.max) * 1.6);
      p.mesh.rotation.x += dt * 6;
      p.mesh.rotation.y += dt * 5;
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        this.scene.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const k = 1 - r.life / r.max;
      r.mesh.scale.setScalar(0.5 + (r.radius - 0.5) * (1 - (1 - k) ** 2));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
    }

    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.scene.remove(f.sprite);
        f.sprite.material.dispose();
        this.floaters.splice(i, 1);
        continue;
      }
      const k = 1 - f.life / f.max;
      f.sprite.position.y += dt * (2.6 - k * 2);
      f.sprite.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    }
  }
}
