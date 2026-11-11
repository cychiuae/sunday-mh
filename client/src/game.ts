import * as THREE from "three";
import {
  Act,
  C2S,
  DT,
  MONSTER,
  MState,
  S2C,
  angleDiff,
  copyCore,
  isAttack,
  lerp,
  monsterSolid,
  newPlayerCore,
  stepPlayer,
  type Fx,
  type MonsterView,
  type PlayerCore,
  type PlayerInput,
  type PlayerView,
  type ResultMsg,
  type RoomView,
  type StepWorld,
} from "@pufflings/shared";
import { sfx } from "./audio";
import { Hud } from "./hud";
import { Input } from "./input";
import type { HuntRoom } from "./net";
import { Effects } from "./render/fx";
import { HunterModel } from "./render/hunter";
import { MonsterModel } from "./render/monster";
import { PALETTE, damp } from "./render/toon";
import { buildWorld, type World } from "./render/world";

/** Remote entities are drawn this far in the past, between two snapshots. */
const INTERP_DELAY_MS = 100;

interface Snapshot {
  t: number;
  x: number;
  z: number;
  yaw: number;
}

/** Snapshot buffer for smooth motion of things we do not predict. */
class Track {
  private readonly buf: Snapshot[] = [];

  push(t: number, x: number, z: number, yaw: number): void {
    const last = this.buf[this.buf.length - 1];
    // A big jump is a teleport (respawn): do not slide across the map.
    if (last && Math.hypot(x - last.x, z - last.z) > 8) this.buf.length = 0;
    this.buf.push({ t, x, z, yaw });
    if (this.buf.length > 20) this.buf.shift();
  }

  sample(t: number, out: Snapshot): boolean {
    const b = this.buf;
    if (b.length === 0) return false;
    let i = b.length - 1;
    while (i > 0 && b[i].t > t) i--;
    const a = b[i];
    const c = b[Math.min(i + 1, b.length - 1)];
    const k = c.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (c.t - a.t))) : 0;
    out.x = lerp(a.x, c.x, k);
    out.z = lerp(a.z, c.z, k);
    out.yaw = a.yaw + angleDiff(a.yaw, c.yaw) * k;
    return true;
  }
}

interface Remote {
  model: HunterModel;
  track: Track;
  lastX: number;
  lastZ: number;
  moving: number;
}

export class Game {
  readonly input: Input;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
  private readonly world: World;
  private readonly fx: Effects;
  private readonly hud: Hud;
  private readonly monster = new MonsterModel();
  private readonly monsterTrack = new Track();
  private readonly remotes = new Map<string, Remote>();
  private readonly myId: string;

  // Local hunter: predicted every tick, corrected by the server.
  private readonly pred: PlayerCore = newPlayerCore(0, 0);
  private readonly prev: PlayerCore = newPlayerCore(0, 0);
  private pending: PlayerInput[] = [];
  private seq = 0;
  private errX = 0;
  private errZ = 0;
  private myModel: HunterModel | undefined;
  private myMoving = 0;
  private ready = false;

  private acc = 0;
  private last = performance.now();
  private time = 0;
  private monsterState = -1;
  private monsterStateAt = 0;
  private readonly camTarget = new THREE.Vector3();
  /** 0..1: how far the camera has lifted to see over the monster. */
  private camLift = 0;
  private readonly tmp: Snapshot = { t: 0, x: 0, z: 0, yaw: 0 };

  constructor(
    private readonly room: HuntRoom,
    canvas: HTMLCanvasElement,
  ) {
    this.myId = room.sessionId;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.world = buildWorld(this.scene);
    this.fx = new Effects(this.scene);
    this.scene.add(this.monster.group);

    this.input = new Input(canvas);
    const start = () => {
      if (this.room.state.phase === "camp") this.room.send(C2S.StartHunt);
    };
    this.input.onStart = start;
    this.hud = new Hud(this.myId, room.roomId, start);

    room.onStateChange((state) => this.onState(state));
    room.onMessage(S2C.Fx, (e: Fx) => this.onFx(e));
    room.onMessage(S2C.Result, (r: ResultMsg) => this.onResult(r));

    window.addEventListener("resize", () => this.resize());
    this.resize();
    requestAnimationFrame(() => this.frame());
  }

  // ------------------------------------------------------------- network

  private stepWorld(): StepWorld {
    const m = this.room.state.monster;
    return { monsterSolid: monsterSolid(m.state), monsterX: m.x, monsterZ: m.z, monsterRadius: MONSTER.radius };
  }

  /** Server state arrived: rewind to it, then replay inputs it has not seen. */
  private onState(state: RoomView): void {
    const now = performance.now();
    const me = state.players.get(this.myId);
    if (me) {
      const oldX = this.pred.x;
      const oldZ = this.pred.z;
      copyCore(me, this.pred);
      this.pending = this.pending.filter((i) => i.seq > me.seq);
      const world = this.stepWorld();
      for (const i of this.pending) stepPlayer(this.pred, i, world);
      if (!this.ready) {
        this.ready = true;
        copyCore(this.pred, this.prev);
      } else {
        // Hide the correction: keep drawing where we were and ease the gap away.
        const dx = this.pred.x - oldX;
        const dz = this.pred.z - oldZ;
        this.prev.x += dx;
        this.prev.z += dz;
        this.errX -= dx;
        this.errZ -= dz;
        if (Math.hypot(this.errX, this.errZ) > 5) this.errX = this.errZ = 0;
      }
    }

    state.players.forEach((p, id) => {
      if (id === this.myId) return;
      let r = this.remotes.get(id);
      if (!r) {
        r = { model: new HunterModel(p.color, p.name), track: new Track(), lastX: p.x, lastZ: p.z, moving: 0 };
        this.scene.add(r.model.group);
        this.remotes.set(id, r);
      }
      r.track.push(now, p.x, p.z, p.yaw);
    });
    for (const [id, r] of this.remotes) {
      if (state.players.get(id)) continue;
      this.scene.remove(r.model.group);
      this.remotes.delete(id);
    }

    const m = state.monster;
    this.monsterTrack.push(now, m.x, m.z, m.yaw);
    if (m.state !== this.monsterState) {
      this.monsterState = m.state;
      this.monsterStateAt = now;
    }
  }

  private name(id: string): string {
    return this.room.state.players.get(id)?.name ?? "A hunter";
  }

  private onFx(e: Fx): void {
    const m = this.room.state.monster;
    switch (e.t) {
      case "hit": {
        const mine = e.by === this.myId;
        this.fx.floatText(e.x, e.head ? 3.6 : 2.6, e.z, String(e.dmg), e.head ? "#ffe066" : "#ffffff", e.head ? 1.1 : 0.85);
        this.fx.burst(e.x, 2, e.z, e.head ? PALETTE.star : 0xffffff, e.head ? 9 : 5);
        sfx.bonk(e.head);
        if (mine) this.fx.shake = Math.max(this.fx.shake, e.head ? 0.3 : 0.18);
        break;
      }
      case "hurt":
        if (e.id === this.myId) {
          this.hud.flashHurt();
          this.fx.shake = Math.max(this.fx.shake, 0.6);
          sfx.hurt();
        }
        break;
      case "faint":
        this.hud.banner(e.id === this.myId ? "You got dizzy!" : `${this.name(e.id)} got dizzy!`);
        break;
      case "revive":
        break;
      case "start":
        this.hud.banner("Hunt start!");
        sfx.start();
        break;
      case "roar":
        this.fx.shake = Math.max(this.fx.shake, 0.5);
        sfx.roar();
        break;
      case "enrage":
        this.hud.banner(`${MONSTER.name} is grumpy!`);
        this.fx.shake = Math.max(this.fx.shake, 0.7);
        sfx.roar();
        break;
      case "stun":
        this.fx.burst(m.x, 4, m.z, PALETTE.star, 14, 8, 0.22);
        sfx.stars();
        break;
      case "bonk":
        this.fx.floatText(e.x, 5, e.z, "BONK!", "#ffe066", 1.4);
        this.fx.burst(e.x, 3, e.z, PALETTE.star, 18, 9, 0.24);
        this.fx.shake = Math.max(this.fx.shake, 0.6);
        sfx.thud();
        sfx.stars();
        break;
      case "land":
        this.fx.ring(e.x, e.z, MONSTER.flopRadius + 1);
        this.fx.dust(e.x, e.z, 12, 5);
        this.shakeNear(e.x, e.z, 0.9);
        sfx.thud();
        break;
      case "spin":
        this.fx.ring(e.x, e.z, MONSTER.spinRadius, 0xffd6e0);
        this.fx.dust(e.x, e.z, 8, 4);
        sfx.swing();
        break;
      case "sleep":
        this.hud.banner("Fast asleep!", 2600);
        sfx.win();
        break;
    }
  }

  private shakeNear(x: number, z: number, strength: number): void {
    const d = Math.hypot(x - this.pred.x, z - this.pred.z);
    this.fx.shake = Math.max(this.fx.shake, strength * Math.max(0.15, 1 - d / 30));
  }

  private onResult(r: ResultMsg): void {
    const names = new Map<string, string>();
    this.room.state.players.forEach((p, id) => names.set(id, p.name));
    this.hud.showResult(r, names);
    if (!r.victory) sfx.lose();
  }

  // ---------------------------------------------------------------- loop

  /** One fixed simulation step for the local hunter. */
  private tick(): void {
    const { mx, mz } = this.input.move();
    const input: PlayerInput = { seq: ++this.seq, mx, mz, buttons: this.input.takeButtons() };
    copyCore(this.pred, this.prev);
    const before = this.pred.act;
    stepPlayer(this.pred, input, this.stepWorld());
    this.pending.push(input);
    if (this.pending.length > 120) this.pending.shift();
    this.room.send(C2S.Input, input);

    if (this.pred.act !== before) {
      if (isAttack(this.pred.act)) sfx.swing();
      else if (this.pred.act === Act.Dodge) sfx.roll();
      else if (this.pred.act === Act.Eat) sfx.munch();
    }
    const walking = (mx !== 0 || mz !== 0) && (this.pred.act === Act.Idle || this.pred.act === Act.Eat);
    this.myMoving = walking ? 1 : 0;
  }

  private frame(): void {
    requestAnimationFrame(() => this.frame());
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    const state = this.room.state;
    if (!this.ready || !state?.monster) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.input.update(dt);
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= DT) {
      this.acc -= DT;
      this.tick();
    }
    const alpha = this.acc / DT;

    // Local hunter: interpolate between the last two predicted ticks.
    const k = damp(10, dt);
    this.errX -= this.errX * k;
    this.errZ -= this.errZ * k;
    const px = lerp(this.prev.x, this.pred.x, alpha) + this.errX;
    const pz = lerp(this.prev.z, this.pred.z, alpha) + this.errZ;
    const mine = state.players.get(this.myId);
    if (!this.myModel && mine) {
      this.myModel = new HunterModel(mine.color, mine.name);
      this.scene.add(this.myModel.group);
    }
    if (this.myModel) {
      this.myModel.group.position.set(px, 0, pz);
      this.myModel.group.rotation.y = this.prev.yaw + angleDiff(this.prev.yaw, this.pred.yaw) * alpha;
      this.myModel.update(dt, { act: this.pred.act, actT: this.pred.actT + alpha * DT, moving: this.myMoving });
    }

    // Everyone else and the monster: replay the recent past smoothly.
    const past = now - INTERP_DELAY_MS;
    state.players.forEach((p: PlayerView, id: string) => {
      const r = this.remotes.get(id);
      if (!r || !r.track.sample(past, this.tmp)) return;
      const speed = Math.hypot(this.tmp.x - r.lastX, this.tmp.z - r.lastZ) / Math.max(dt, 1e-3);
      r.lastX = this.tmp.x;
      r.lastZ = this.tmp.z;
      const walking = p.act === Act.Idle || p.act === Act.Eat ? Math.min(1, speed / 4) : 0;
      r.moving += (walking - r.moving) * damp(12, dt);
      r.model.group.position.set(this.tmp.x, 0, this.tmp.z);
      r.model.group.rotation.y = this.tmp.yaw;
      r.model.update(dt, { act: p.act, actT: p.actT, moving: r.moving });
    });

    const m: MonsterView = state.monster;
    const st = (now - this.monsterStateAt) / 1000;
    if (this.monsterTrack.sample(past, this.tmp)) {
      this.monster.group.position.set(this.tmp.x, 0, this.tmp.z);
      this.monster.group.rotation.y = this.tmp.yaw;
    }
    this.monster.update(dt, m, st);
    this.fx.telegraph(m, st);
    if (m.state === MState.Roll && Math.random() < dt * 24) {
      this.fx.dust(this.monster.group.position.x, this.monster.group.position.z, 1, 1.5);
    }

    this.fx.update(dt);
    this.world.update(this.time);
    this.updateCamera(px, pz, dt);
    this.hud.update(state, this.pred);
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(px: number, pz: number, dt: number): void {
    const yaw = this.input.camYaw;
    const distance = 11.5;
    this.camTarget.lerp(new THREE.Vector3(px, 1.7, pz), this.camTarget.lengthSq() === 0 ? 1 : damp(14, dt));

    // If the monster's body sits on the line from camera to hunter it would
    // fill the screen, so rise and look down over it instead.
    let blocked = 0;
    if (this.monster.group.visible) {
      const reach = Math.cos(this.input.camPitch) * distance;
      const bx = -Math.sin(yaw);
      const bz = -Math.cos(yaw);
      const mx = this.monster.group.position.x - this.camTarget.x;
      const mz = this.monster.group.position.z - this.camTarget.z;
      const along = mx * bx + mz * bz;
      const side = Math.abs(mx * bz - mz * bx);
      if (along > 0 && along < reach + MONSTER.radius && side < MONSTER.radius + 1) blocked = 1;
    }
    this.camLift += (blocked - this.camLift) * damp(blocked ? 9 : 4, dt);
    const pitch = lerp(this.input.camPitch, Math.max(this.input.camPitch, 1.12), this.camLift);
    const flat = Math.cos(pitch) * distance;
    const shake = this.fx.shake * 0.5;
    this.camera.position.set(
      this.camTarget.x - Math.sin(yaw) * flat + (Math.random() - 0.5) * shake,
      this.camTarget.y + Math.sin(pitch) * distance + (Math.random() - 0.5) * shake,
      this.camTarget.z - Math.cos(yaw) * flat + (Math.random() - 0.5) * shake,
    );
    this.camera.lookAt(this.camTarget.x, this.camTarget.y + 0.6, this.camTarget.z);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------- test surface

  /** Snapshot for automated playtests (see tools/playtest-browser.mjs). */
  debug() {
    const s = this.room.state;
    if (!this.ready || !s?.players) return null;
    return {
      phase: s.phase,
      players: s.players.size,
      me: { x: this.pred.x, z: this.pred.z, act: this.pred.act, hp: this.pred.hp },
      server: (() => {
        const p = s.players.get(this.myId);
        return p ? { x: p.x, z: p.z, seq: p.seq } : null;
      })(),
      pending: this.pending.length,
      error: Math.hypot(this.errX, this.errZ),
      monster: { x: s.monster.x, z: s.monster.z, state: s.monster.state, hp: s.monster.hp, maxHp: s.monster.maxHp },
    };
  }
}
