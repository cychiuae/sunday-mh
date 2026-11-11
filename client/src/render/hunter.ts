import * as THREE from "three";
import { ATTACKS, Act, HUNTER_COLORS, PLAYER } from "@pufflings/shared";
import { PALETTE, blob, damp, ease, part, seg, textSprite, toon } from "./toon";

const TURN = Math.PI * 2;

// Mallet rig, in the hunter's own frame. The hand is the pivot; the head sits at the end of the handle.
const PIVOT_Y = 0.8;
const HAND = { x: -0.4, y: 0.78, z: 0.05 };
const HANDLE = 1.5;
/** Bounding cylinder of the mallet head (its axis lies across the handle, along the swing). */
const HEAD_RADIUS = 0.38;
const HEAD_HALF = 0.4;
/** Gap kept between the mallet head and the ground. */
const GROUND_GAP = 0.02;

const REST_PITCH = -0.55;
/** A pitch far past the ground in front; `groundPitch` turns it into "resting on the ground". */
const SLAM_PITCH = 2.2;

// Side swing: the head sweeps from SWING_BACK behind centre, through straight ahead, to SWING_THROUGH past it.
const SWING_PITCH = 1.4;
const SWING_BACK = 1.7;
const SWING_THROUGH = 1.4;
/** Follow-through time as a multiple of hitAt, chosen so the head keeps its speed through the hit. */
const SWING_COAST = (3 * SWING_THROUGH) / (2 * SWING_BACK);
/** The hand is off-centre, so this much yaw points the mallet head straight ahead. */
const SWING_AIM = Math.atan2(-HAND.x, HAND.z + HANDLE * Math.sin(SWING_PITCH));

export interface HunterPose {
  act: number;
  actT: number;
  /** 0..1 how fast the hunter is walking. */
  moving: number;
}

/**
 * A chibi hunter: big hooded head with bear ears, tiny body, oversized
 * mallet. Built facing +Z. All animation is procedural, driven by `HunterPose`.
 */
export class HunterModel {
  readonly group = new THREE.Group();
  private readonly roll = new THREE.Group();
  private readonly inner = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly malletYaw = new THREE.Group();
  private readonly malletPitch = new THREE.Group();
  private readonly legL: THREE.Mesh;
  private readonly legR: THREE.Mesh;
  private readonly armL: THREE.Mesh;
  private readonly berry: THREE.Mesh;
  private readonly stars = new THREE.Group();
  private readonly label: THREE.Sprite;
  private walkPhase = 0;
  private time = 0;
  /** Smoothed body tilt (lean forward/back, lying down). */
  private lean = 0;
  /** Dodge somersault angle. Kept apart from `lean` so a finished turn is dropped, never unwound. */
  private spin = 0;
  /** Mallet pitch relative to the un-rolled body. */
  private pitch = REST_PITCH;

  constructor(colorIndex: number, name: string) {
    const color = HUNTER_COLORS[colorIndex % HUNTER_COLORS.length];
    const hood = toon(color);
    const skin = toon(PALETTE.skin);
    const ink = toon(PALETTE.ink);

    // `roll` pivots around the hunter's middle so dodge rolls spin in place.
    this.roll.position.y = PIVOT_Y;
    this.inner.position.y = -PIVOT_Y;
    this.roll.add(this.inner);
    this.group.add(this.roll);

    this.inner.add(blob(hood, { pos: [0, 0.62, 0], scale: [0.4, 0.42, 0.36] }));
    this.inner.add(blob(toon(PALETTE.cream), { pos: [0, 0.6, 0.2], scale: [0.26, 0.28, 0.2] }));

    this.head.position.set(0, 1.3, 0);
    this.head.add(blob(hood, { scale: [0.56, 0.52, 0.54] }));
    this.head.add(blob(skin, { pos: [0, -0.04, 0.2], scale: [0.43, 0.38, 0.4] }));
    this.head.add(blob(hood, { pos: [0.36, 0.42, 0], scale: 0.17 }));
    this.head.add(blob(hood, { pos: [-0.36, 0.42, 0], scale: 0.17 }));
    this.head.add(blob(toon(PALETTE.blush), { pos: [0.36, 0.42, 0.07], scale: 0.09 }));
    this.head.add(blob(toon(PALETTE.blush), { pos: [-0.36, 0.42, 0.07], scale: 0.09 }));
    for (const side of [1, -1]) {
      this.head.add(blob(ink, { pos: [0.17 * side, 0, 0.56], scale: [0.06, 0.085, 0.04], shadow: false }));
      this.head.add(blob(toon(0xffffff), { pos: [0.185 * side, 0.03, 0.59], scale: 0.022, shadow: false }));
      this.head.add(blob(toon(PALETTE.blush), { pos: [0.29 * side, -0.11, 0.48], scale: [0.08, 0.045, 0.04], shadow: false }));
    }
    this.inner.add(this.head);

    this.armL = blob(hood, { pos: [0.42, 0.72, 0.05], scale: 0.13 });
    this.inner.add(this.armL);
    this.legL = blob(ink, { pos: [0.17, 0.14, 0], scale: [0.15, 0.14, 0.2] });
    this.legR = blob(ink, { pos: [-0.17, 0.14, 0], scale: [0.15, 0.14, 0.2] });
    this.inner.add(this.legL, this.legR);

    // Mallet: handle runs up local +Y from the right hand; pitch tips it forward.
    this.malletYaw.position.set(0, HAND.y, 0);
    this.malletPitch.position.set(HAND.x, 0, HAND.z);
    this.malletPitch.add(blob(hood, { scale: 0.14 }));
    this.malletPitch.add(part(new THREE.CylinderGeometry(0.055, 0.055, HANDLE, 8), toon(PALETTE.wood), { pos: [0, HANDLE / 2, 0] }));
    const headGeo = new THREE.CylinderGeometry(0.36, 0.36, HEAD_HALF * 2, 14);
    this.malletPitch.add(part(headGeo, toon(PALETTE.malletHead), { pos: [0, HANDLE, 0], rot: [Math.PI / 2, 0, 0] }));
    const band = new THREE.CylinderGeometry(HEAD_RADIUS, HEAD_RADIUS, 0.14, 14);
    this.malletPitch.add(part(band, hood, { pos: [0, HANDLE, 0.3], rot: [Math.PI / 2, 0, 0] }));
    this.malletPitch.add(part(band, hood, { pos: [0, HANDLE, -0.3], rot: [Math.PI / 2, 0, 0] }));
    this.malletYaw.add(this.malletPitch);
    this.inner.add(this.malletYaw);

    this.berry = blob(toon(0xff6b8b), { pos: [0.1, 1.12, 0.6], scale: 0.11 });
    this.berry.visible = false;
    this.inner.add(this.berry);

    // Dizzy stars: big enough to pick out a fainted friend from across the meadow.
    const star = new THREE.OctahedronGeometry(0.24);
    const starMat = new THREE.MeshBasicMaterial({ color: PALETTE.star });
    for (let i = 0; i < 3; i++) {
      const s = part(star, starMat, { shadow: false, scale: [1, 1.25, 1] });
      s.position.set(Math.cos((i * TURN) / 3) * 0.7, 0, Math.sin((i * TURN) / 3) * 0.7);
      this.stars.add(s);
    }
    this.stars.visible = false;
    this.group.add(this.stars);

    this.label = textSprite(name, "#ffffff", 0.42);
    this.label.position.y = 2.35;
    this.group.add(this.label);
  }

  update(dt: number, pose: HunterPose): void {
    this.time += dt;
    const t = this.time;
    const k = damp(18, dt);

    // Targets for this frame; applied with smoothing below.
    let yaw = 0;
    let pitch = REST_PITCH;
    /** 0..1: how far the mallet has come down from `pitch` to resting on the ground in front. */
    let slam = 0;
    let hop = 0;
    let squash = 1;
    let lean = 0;
    let snap = false;

    this.walkPhase += dt * 13 * pose.moving;
    const stride = Math.sin(this.walkPhase) * pose.moving;
    const bob = Math.abs(Math.sin(this.walkPhase)) * 0.07 * pose.moving + Math.sin(t * 3) * 0.015;

    const a = pose.act;
    const at = pose.actT;
    const def = ATTACKS[a];

    if (a === Act.Light1 || a === Act.Light2) {
      // Wind up slowly, pass straight ahead exactly at hitAt at full speed, then coast out the far side.
      const dir = a === Act.Light1 ? 1 : -1;
      const before = seg(at, 0, def.hitAt);
      const after = ease.out(seg(at, def.hitAt, def.hitAt * (1 + SWING_COAST)));
      yaw = dir * (-SWING_BACK * (1 - before * before) + SWING_THROUGH * after) + SWING_AIM;
      pitch = SWING_PITCH;
      lean = 0.12;
      snap = true;
    } else if (a === Act.Light3) {
      const up = ease.out(seg(at, 0, def.hitAt * 0.55));
      const down = seg(at, def.hitAt * 0.55, def.hitAt) ** 2;
      pitch = REST_PITCH - up * 0.9;
      slam = down - bounce(at - def.hitAt);
      hop = Math.sin(seg(at, 0, def.hitAt) * Math.PI) * 0.45;
      lean = down * 0.3;
      snap = true;
    } else if (a === Act.Heavy) {
      const wind = ease.out(seg(at, 0, def.hitAt * 0.7));
      const down = seg(at, def.hitAt * 0.7, def.hitAt) ** 2;
      pitch = REST_PITCH - wind * 1.5;
      slam = down - bounce(at - def.hitAt);
      squash = 1 - wind * 0.22 + down * 0.22;
      hop = Math.sin(seg(at, def.hitAt * 0.6, def.hitAt) * Math.PI) * 0.8;
      lean = -wind * 0.25 + down * 0.6;
      snap = true;
    } else if (a === Act.Dodge) {
      squash = 0.82;
      snap = true;
    } else if (a === Act.Hit) {
      lean = -0.6;
      hop = Math.sin(seg(at, 0, 0.4) * Math.PI) * 0.4;
    } else if (a === Act.Faint) {
      lean = -Math.PI / 2;
      hop = -0.45;
    } else if (a === Act.Eat) {
      pitch = -0.2;
    }

    // Body first: where the mallet meets the ground depends on it.
    if (a === Act.Dodge) {
      this.spin = ease.out(seg(at, 0, PLAYER.dodgeDur)) * TURN;
    } else {
      // A whole turn is the same pose as none, so a finished roll just stops. One cut short (interrupted, or
      // its last frames never arrived) finishes forwards; only a roll that had barely begun tips back.
      if (this.spin > Math.PI / 2) this.spin -= TURN;
      this.spin -= this.spin * k;
    }
    this.lean += (lean - this.lean) * k;
    this.roll.rotation.x = this.lean + this.spin;
    this.roll.position.y = PIVOT_Y + hop + bob;
    this.roll.scale.set(1 + (1 - squash) * 0.6, squash, 1 + (1 - squash) * 0.6);

    const kk = snap ? 1 : k;
    this.malletYaw.rotation.y += (yaw - this.malletYaw.rotation.y) * kk;
    this.pitch += (pitch - this.pitch) * kk;
    // The mallet does not somersault with the body: it stays held up beside the roll.
    const swing = this.malletYaw.rotation.y;
    let applied = this.groundPitch(this.pitch - this.spin, swing);
    if (slam > 0) applied += (this.groundPitch(SLAM_PITCH, swing) - applied) * slam;
    this.malletPitch.rotation.x = applied;
    this.pitch = applied + this.spin;

    this.legL.position.z = stride * 0.22;
    this.legR.position.z = -stride * 0.22;
    this.armL.position.z = 0.05 - stride * 0.16;
    this.head.rotation.z = Math.sin(this.walkPhase * 0.5) * 0.05 * pose.moving;

    const eating = a === Act.Eat;
    this.berry.visible = eating;
    if (eating) this.head.rotation.x = Math.sin(t * 22) * 0.08;
    else this.head.rotation.x = 0;

    const dizzy = a === Act.Faint;
    this.stars.visible = dizzy;
    if (dizzy) {
      // Circle above the head of the hunter lying on its back.
      this.stars.position.set(0, 1.55 + Math.sin(t * 3) * 0.08, -0.5);
      this.stars.rotation.y = t * 4;
      for (const s of this.stars.children) s.rotation.y = -t * 7;
    }
  }

  /**
   * Height of the lowest point of the mallet head above `GROUND_GAP`, for a mallet pitch and yaw under the
   * body's current tilt, squash and hop.
   */
  private headClearance(pitch: number, yaw: number): number {
    const r = this.roll;
    // World height of a point q in the roll group's frame is r.position.y + wy * q.y + wz * q.z.
    const wy = r.scale.y * Math.cos(r.rotation.x);
    const wz = -r.scale.z * Math.sin(r.rotation.x);
    const sp = Math.sin(pitch);
    const cp = Math.cos(pitch);
    const cy = Math.cos(yaw);
    const centreY = HAND.y - PIVOT_Y + HANDLE * cp;
    const centreZ = -HAND.x * Math.sin(yaw) + (HAND.z + HANDLE * sp) * cy;
    // The head cylinder reaches HEAD_HALF along its axis and HEAD_RADIUS across it.
    const along = wy * -sp + wz * cp * cy;
    const across = Math.sqrt(Math.max(0, wy * wy + wz * wz - along * along));
    const low = r.position.y + wy * centreY + wz * centreZ - HEAD_HALF * Math.abs(along) - HEAD_RADIUS * across;
    return low - GROUND_GAP;
  }

  /** `pitch`, or if that would sink the mallet head into the ground, the nearest pitch that rests it on the ground. */
  private groundPitch(pitch: number, yaw: number): number {
    if (this.headClearance(pitch, yaw) >= 0) return pitch;
    const dir = this.headClearance(pitch + 0.02, yaw) > this.headClearance(pitch - 0.02, yaw) ? 1 : -1;
    let under = pitch;
    let clear = pitch;
    let found = false;
    for (let i = 0; i < 40 && !found; i++) {
      clear += dir * 0.1;
      if (this.headClearance(clear, yaw) >= 0) found = true;
      else under = clear;
    }
    if (!found) return pitch;
    for (let i = 0; i < 10; i++) {
      const mid = (under + clear) / 2;
      if (this.headClearance(mid, yaw) >= 0) clear = mid;
      else under = mid;
    }
    return clear;
  }
}

/** A small rebound off the ground, `since` seconds after a slam lands. */
function bounce(since: number): number {
  return Math.sin(seg(since, 0, 0.2) * Math.PI) * 0.05;
}
