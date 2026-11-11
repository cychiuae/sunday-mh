import * as THREE from "three";
import { MONSTER, MState, monsterDur, type MonsterView } from "@pufflings/shared";
import { PALETTE, blob, damp, ease, part, seg, textSprite, toon } from "./toon";

const R = MONSTER.radius;

/**
 * Grumblepuff: a grumpy peach puffball with stubby horns and a leaf sprout.
 * Built facing +Z. Animation is driven by the synced state plus the time the
 * client has seen the monster in that state.
 */
export class MonsterModel {
  readonly group = new THREE.Group();
  private readonly spinner = new THREE.Group();
  private readonly tilt = new THREE.Group();
  private readonly inner = new THREE.Group();
  private readonly bodyMat = toon(PALETTE.monster, true);
  private readonly eyes: THREE.Mesh[] = [];
  private readonly brows: THREE.Mesh[] = [];
  private readonly feet: THREE.Mesh[] = [];
  private readonly mouth: THREE.Mesh;
  private readonly stars = new THREE.Group();
  private readonly zzz: THREE.Sprite[] = [];
  private readonly calm = new THREE.Color(PALETTE.monster);
  private readonly angry = new THREE.Color(PALETTE.monsterAngry);
  private rollAngle = 0;
  private time = 0;
  /** Height of the body centre above its resting place (for effects). */
  lift = 0;

  constructor() {
    const cream = toon(PALETTE.cream);
    const ink = toon(PALETTE.ink);

    // `tilt` pivots at the body's centre so rolling and toppling look right.
    this.tilt.position.y = R;
    this.inner.position.y = -R;
    this.tilt.add(this.inner);
    this.spinner.add(this.tilt);
    this.group.add(this.spinner);

    this.inner.add(blob(this.bodyMat, { pos: [0, R, 0], scale: [R, R * 0.93, R] }));
    this.inner.add(blob(cream, { pos: [0, R * 0.82, 0.62], scale: [R * 0.8, R * 0.74, R * 0.78] }));
    // Fluffy cheeks and a tuft of fur.
    for (const side of [1, -1]) {
      this.inner.add(blob(this.bodyMat, { pos: [1.75 * side, 2.0, 1.0], scale: 0.62 }));
      this.inner.add(blob(this.bodyMat, { pos: [1.5 * side, 3.95, 0.2], scale: [0.6, 0.6, 0.35] }));
      this.inner.add(blob(toon(PALETTE.blush), { pos: [1.5 * side, 3.95, 0.4], scale: [0.36, 0.36, 0.2], shadow: false }));
      this.inner.add(
        part(new THREE.ConeGeometry(0.3, 0.9, 10), cream, { pos: [0.75 * side, 4.4, 0.75], rot: [0.25, 0, -0.35 * side] }),
      );
      const eye = blob(ink, { pos: [0.78 * side, 2.95, 2.0], scale: [0.3, 0.34, 0.16], shadow: false });
      this.eyes.push(eye);
      this.inner.add(eye);
      this.inner.add(blob(toon(0xffffff), { pos: [0.86 * side, 3.08, 2.14], scale: 0.09, shadow: false }));
      const brow = part(new THREE.BoxGeometry(0.75, 0.16, 0.14), ink, { pos: [0.78 * side, 3.5, 2.02], shadow: false });
      this.brows.push(brow);
      this.inner.add(brow);
      this.inner.add(blob(toon(PALETTE.blush), { pos: [1.35 * side, 2.45, 1.82], scale: [0.3, 0.17, 0.1], shadow: false }));
      for (const fz of [1, -1]) {
        const foot = blob(cream, { pos: [1.15 * side, 0.26, 1.05 * fz], scale: [0.55, 0.3, 0.7] });
        this.feet.push(foot);
        this.inner.add(foot);
      }
    }
    this.inner.add(blob(toon(0xff8fa3), { pos: [0, 2.62, 2.26], scale: [0.2, 0.14, 0.12], shadow: false }));
    this.mouth = blob(toon(0x8a3b52), { pos: [0, 2.2, 2.2], scale: [0.3, 0.06, 0.12], shadow: false });
    this.inner.add(this.mouth);
    this.inner.add(blob(cream, { pos: [0, 1.9, -2.3], scale: 0.75 }));
    // Leaf sprout on top.
    this.inner.add(part(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 6), toon(PALETTE.leafDeep), { pos: [0, 4.7, 0] }));
    this.inner.add(blob(toon(PALETTE.leaf), { pos: [0.3, 5.05, 0], scale: [0.4, 0.1, 0.22], rot: [0, 0, 0.5] }));
    this.inner.add(blob(toon(PALETTE.leaf), { pos: [-0.3, 5.05, 0], scale: [0.4, 0.1, 0.22], rot: [0, 0, -0.5] }));

    const star = new THREE.OctahedronGeometry(0.3);
    for (let i = 0; i < 4; i++) {
      const s = part(star, new THREE.MeshBasicMaterial({ color: PALETTE.star }), { shadow: false });
      s.position.set(Math.cos((i * Math.PI) / 2) * 1.7, 0, Math.sin((i * Math.PI) / 2) * 1.7);
      this.stars.add(s);
    }
    this.stars.visible = false;
    this.group.add(this.stars);

    for (let i = 0; i < 3; i++) {
      const z = textSprite("Z", "#ffffff", 0.9 + i * 0.25);
      z.visible = false;
      this.zzz.push(z);
      this.group.add(z);
    }
    this.group.visible = false;
  }

  /** `st` is how long the monster has been in `m.state`, in seconds. */
  update(dt: number, m: MonsterView, st: number): void {
    this.time += dt;
    const t = this.time;
    const s = m.state;
    this.group.visible = s !== MState.Absent;
    if (!this.group.visible) return;

    const dur = monsterDur(s, m.enraged);
    const k = dur > 0 ? Math.min(1, st / dur) : 0;

    let sy = 1 + Math.sin(t * (m.enraged ? 5 : 2.6)) * 0.025;
    let sxz = 1;
    let tiltX = 0;
    let tiltZ = 0;
    let spinY = 0;
    let lift = 0;
    let scale = 1;
    let mouth = 0.06;
    let eyeY = 1;
    let jitter = 0;
    let rolling = false;

    switch (s) {
      case MState.Enter:
        scale = ease.back(seg(st, 0, 0.8));
        lift = Math.sin(seg(st, 0, 0.8) * Math.PI) * 2.5;
        if (st > 0.9) {
          tiltX = -0.3;
          mouth = 0.4;
          jitter = 0.05;
        }
        break;
      case MState.Roar:
        tiltX = -0.3;
        mouth = 0.45;
        jitter = 0.07;
        sy = 1.08;
        break;
      case MState.Chase:
        tiltZ = Math.sin(t * 9) * 0.13;
        lift = Math.abs(Math.sin(t * 9)) * 0.3;
        break;
      case MState.FlopWindup:
        sy = 1 - 0.32 * ease.out(k);
        sxz = 1 + 0.18 * ease.out(k);
        jitter = 0.04 * k;
        break;
      case MState.FlopAir:
        lift = Math.sin(k * Math.PI) * 7;
        sy = 1.12;
        sxz = 0.95;
        tiltX = ease.inOut(k) * 1.25;
        break;
      case MState.FlopLand: {
        const squish = 1 - seg(st, 0, 0.35);
        sy = 1 - 0.45 * squish * Math.cos(st * 18) ** 2 - 0.12 * (1 - seg(st, 0.6, dur));
        sxz = 1 + 0.3 * squish;
        tiltX = 1.25 * (1 - ease.inOut(seg(st, dur * 0.55, dur)));
        break;
      }
      case MState.RollWindup:
        tiltX = -0.4 * ease.out(k);
        jitter = 0.05;
        sy = 0.94;
        break;
      case MState.Roll:
        rolling = true;
        this.rollAngle += 15 * dt;
        lift = 0.1;
        break;
      case MState.RollRecover:
        tiltZ = Math.sin(st * 9) * 0.25 * (1 - k);
        break;
      case MState.SpinWindup:
        spinY = -1.3 * ease.out(k);
        sy = 0.9;
        sxz = 1.06;
        break;
      case MState.Spin:
        spinY = -1.3 + ease.out(k) * (Math.PI * 4 + 1.3);
        sxz = 1.08;
        break;
      case MState.SpinRecover:
        tiltZ = Math.sin(st * 10) * 0.2 * (1 - k);
        break;
      case MState.Stunned:
        tiltZ = 1.2 * ease.out(seg(st, 0, 0.35)) * (1 - ease.inOut(seg(st, dur - 0.6, dur)));
        break;
      case MState.Asleep:
        sy = 0.8 + Math.sin(t * 1.6) * 0.04;
        sxz = 1.1;
        eyeY = 0.08;
        tiltX = 0.12;
        break;
    }

    const a = damp(16, dt);
    const snap = s === MState.Spin || s === MState.SpinWindup || s === MState.FlopAir;
    const b = snap ? 1 : a;

    if (!rolling) {
      // Settle a finished roll to the nearest upright pose.
      this.rollAngle %= Math.PI * 2;
      const rest = this.rollAngle > Math.PI ? Math.PI * 2 : 0;
      this.rollAngle += (rest - this.rollAngle) * a;
    }
    this.tilt.rotation.x = rolling ? this.rollAngle : this.rollAngle + this.blend("tx", tiltX, b);
    this.tilt.rotation.z = this.blend("tz", tiltZ, a);
    this.spinner.rotation.y = snap ? spinY : this.blend("sp", s === MState.SpinRecover ? 0 : spinY, a);
    if (s === MState.SpinRecover || s === MState.Idle) this.vals.set("sp", 0);

    const ssy = this.blend("sy", sy, a);
    const ssxz = this.blend("sxz", sxz, a);
    this.tilt.scale.set(ssxz, ssy, ssxz);
    this.lift = snap || s === MState.Enter ? lift : this.blend("lift", lift, a);
    this.vals.set("lift", this.lift);
    this.tilt.position.set(jitter ? (Math.random() - 0.5) * jitter * 2 : 0, R * ssy + this.lift, jitter ? (Math.random() - 0.5) * jitter * 2 : 0);
    this.group.scale.setScalar(scale);

    this.mouth.scale.y = this.blend("mouth", mouth, a);
    const eye = this.blend("eye", eyeY, a);
    for (const e of this.eyes) e.scale.y = 0.34 * eye;

    // Grumpy brows tilt inward once enraged; body flushes red.
    const fury = this.blend("fury", m.enraged && s !== MState.Asleep ? 1 : 0, damp(3, dt));
    this.brows[0].rotation.z = 0.12 + fury * 0.4;
    this.brows[1].rotation.z = -0.12 - fury * 0.4;
    this.brows[0].position.y = this.brows[1].position.y = 3.5 - fury * 0.14;
    this.bodyMat.color.copy(this.calm).lerp(this.angry, fury * 0.75);

    const kick = s === MState.Stunned ? Math.sin(t * 16) * 0.25 : 0;
    this.feet.forEach((f, i) => (f.position.y = 0.26 + (i % 2 ? kick : -kick)));

    const dizzy = s === MState.Stunned || s === MState.RollRecover || s === MState.SpinRecover;
    this.stars.visible = dizzy;
    if (dizzy) {
      this.stars.position.set(0, s === MState.Stunned ? 3.6 : 5.6, s === MState.Stunned ? 0 : 0.6);
      this.stars.rotation.y = t * 3.5;
    }

    const asleep = s === MState.Asleep;
    this.zzz.forEach((z, i) => {
      z.visible = asleep;
      if (!asleep) return;
      const p = (t * 0.45 + i / 3) % 1;
      z.position.set(1.2 + p * 1.6, 4.4 + p * 3, 1);
      z.material.opacity = Math.sin(p * Math.PI);
    });
  }

  private readonly vals = new Map<string, number>();

  /** Smoothly follow a target value, remembered per key. */
  private blend(key: string, target: number, k: number): number {
    const cur = this.vals.get(key) ?? target;
    const next = cur + (target - cur) * k;
    this.vals.set(key, next);
    return next;
  }
}
