import { Btn } from "@pufflings/shared";

/**
 * Keyboard + mouse. Movement is read as a held state; buttons are collected
 * as edges and handed out once per simulation tick via `takeButtons()`.
 */
export class Input {
  camYaw = Math.PI;
  camPitch = 0.42;
  /** Fires when the player asks to start the hunt (Enter). */
  onStart: () => void = () => {};

  private readonly keys = new Set<string>();
  private pressed = 0;
  private locked = false;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      if (e.repeat || (e.target as HTMLElement)?.tagName === "INPUT") return;
      this.keys.add(e.code);
      if (e.code === "Space" || e.code === "ShiftLeft") this.pressed |= Btn.Dodge;
      if (e.code === "KeyJ") this.pressed |= Btn.Attack;
      if (e.code === "KeyK") this.pressed |= Btn.Heavy;
      if (e.code === "KeyE") this.pressed |= Btn.Eat;
      if (e.code === "Enter") this.onStart();
      if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());

    canvas.addEventListener("mousedown", (e) => {
      if (!this.locked) {
        void canvas.requestPointerLock?.();
        return;
      }
      if (e.button === 0) this.pressed |= Btn.Attack;
      if (e.button === 2) this.pressed |= Btn.Heavy;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
      document.getElementById("lock-hint")?.classList.toggle("hidden", this.locked);
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.camYaw -= e.movementX * 0.0032;
      this.camPitch = Math.min(1.25, Math.max(0.06, this.camPitch + e.movementY * 0.0026));
    });
  }

  /** Per-frame: arrow keys turn the camera for players without mouse look. */
  update(dt: number): void {
    if (this.keys.has("ArrowLeft")) this.camYaw += dt * 2.4;
    if (this.keys.has("ArrowRight")) this.camYaw -= dt * 2.4;
    if (this.keys.has("ArrowUp")) this.camPitch = Math.max(0.06, this.camPitch - dt * 1.2);
    if (this.keys.has("ArrowDown")) this.camPitch = Math.min(1.25, this.camPitch + dt * 1.2);
  }

  /** World-space move direction relative to where the camera looks. */
  move(): { mx: number; mz: number } {
    const f = (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0);
    const r = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
    if (!f && !r) return { mx: 0, mz: 0 };
    const sin = Math.sin(this.camYaw);
    const cos = Math.cos(this.camYaw);
    // forward = (sin, cos); right = (-cos, sin)
    const mx = sin * f - cos * r;
    const mz = cos * f + sin * r;
    const len = Math.hypot(mx, mz);
    return { mx: mx / len, mz: mz / len };
  }

  takeButtons(): number {
    const b = this.pressed;
    this.pressed = 0;
    return b;
  }

  /** For automated playtests: press buttons as if the player did. */
  press(buttons: number): void {
    this.pressed |= buttons;
  }

  hold(code: string, down: boolean): void {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }
}
