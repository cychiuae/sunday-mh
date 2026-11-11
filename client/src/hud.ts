import { HUNTER_COLORS, MAX_FAINTS, MONSTER, MState, PLAYER, type ResultMsg, type RoomView } from "@pufflings/shared";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setWidth(el: HTMLElement, frac: number): void {
  const w = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
  if (el.style.width !== w) el.style.width = w;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The Result message and the patch that moves `phase` off "hunt" are sent separately and arrive in either order,
 * a few tens of milliseconds apart. A hunt still running this long after a result arrived is a new hunt.
 */
const RESULT_PATCH_GRACE_MS = 2000;

/** The link a friend opens to land on the menu with this hunt's invite code filled in. */
export function inviteLink(roomCode: string): string {
  return `${location.origin}${location.pathname}?room=${encodeURIComponent(roomCode)}`;
}

/** The DOM overlay. Reads state every frame; never writes game state. */
export class Hud {
  private readonly mates = new Map<string, { root: HTMLElement; bar: HTMLElement; name: HTMLElement }>();
  private readonly link: string;
  private bannerTimer = 0;
  private copyTimer = 0;
  private berries = -1;
  private atCamp = false;
  /** The result panel on screen, if any. `ended` turns true once the room is seen in its result phase. */
  private result: { heading: string; at: number; ended: boolean } | null = null;

  constructor(
    private readonly myId: string,
    roomCode: string,
    onStart: () => void,
  ) {
    this.link = inviteLink(roomCode);
    $("hud").classList.remove("hidden");
    setText($("room-code"), roomCode);
    $("start-hunt").addEventListener("click", onStart);
    $("copy-link").addEventListener("click", () => void this.copyLink());
    // The browser's own copy (Ctrl+C on the selected link) counts too.
    $("invite-link").addEventListener("copy", () => {
      $("invite-link").blur();
      this.copied();
    });

    // A locked mouse cannot click, so the Camp card says so and every button on it has a key.
    const hud = $("hud");
    const onLock = () => hud.classList.toggle("mouse-locked", document.pointerLockElement !== null);
    document.addEventListener("pointerlockchange", onLock);
    onLock();
    window.addEventListener("keydown", (e) => {
      if (e.code !== "KeyC" || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement)?.tagName === "INPUT" || !this.atCamp) return;
      void this.copyLink();
    });
  }

  /** Copy the invite link. Says "Copied!" only if it was; otherwise hands the player the link to copy. */
  private async copyLink(): Promise<void> {
    let ok = false;
    try {
      // `navigator.clipboard` is missing on plain-http pages (a LAN host) and rejects without permission.
      await navigator.clipboard.writeText(this.link);
      ok = true;
    } catch {
      ok = false;
    }
    const field = $<HTMLInputElement>("invite-link");
    if (!ok) {
      field.value = this.link;
      $("copy-fallback").classList.remove("hidden");
      field.focus();
      field.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
    }
    if (ok) {
      this.copied();
      return;
    }
    // Still not copied: the link stays on screen, selected, one key press away.
    const keys = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘C" : "Ctrl+C";
    setText($("copy-note"), `Couldn't copy it for you. The link is selected: press ${keys}.`);
  }

  private copied(): void {
    $("copy-fallback").classList.add("hidden");
    setText($("copy-label"), "Copied!");
    clearTimeout(this.copyTimer);
    this.copyTimer = window.setTimeout(() => setText($("copy-label"), "Copy invite link"), 1500);
  }

  update(state: RoomView, me: { hp: number; stamina: number; berries: number }): void {
    const mine = state.players.get(this.myId);
    if (mine) setText($("me-name"), mine.name);
    setWidth($("me-hp"), me.hp / PLAYER.maxHp);
    setWidth($("me-stamina"), me.stamina / PLAYER.maxStamina);
    if (me.berries !== this.berries) {
      this.berries = me.berries;
      const dots = document.createElement("b");
      dots.textContent = "●".repeat(me.berries);
      $("me-berries").replaceChildren(me.berries > 0 ? "Berries " : "No berries left", dots);
    }

    const seen = new Set<string>();
    state.players.forEach((p, id) => {
      if (id === this.myId) return;
      seen.add(id);
      let mate = this.mates.get(id);
      if (!mate) {
        const root = document.createElement("div");
        root.className = "card mate";
        const name = document.createElement("div");
        const barWrap = document.createElement("div");
        barWrap.className = "bar hp";
        const bar = document.createElement("div");
        barWrap.append(bar);
        root.append(name, barWrap);
        root.style.borderColor = `#${HUNTER_COLORS[p.color % HUNTER_COLORS.length].toString(16).padStart(6, "0")}`;
        $("party").append(root);
        mate = { root, bar, name };
        this.mates.set(id, mate);
      }
      setText(mate.name, p.name);
      setWidth(mate.bar, p.hp / PLAYER.maxHp);
    });
    for (const [id, mate] of this.mates) {
      if (seen.has(id)) continue;
      mate.root.remove();
      this.mates.delete(id);
    }

    const hunting = state.phase === "hunt";
    const m = state.monster;
    this.atCamp = state.phase === "camp";
    $("camp-box").classList.toggle("hidden", !this.atCamp);
    $("monster-box").classList.toggle("hidden", m.state === MState.Absent);
    $("hunt-info").classList.toggle("hidden", !hunting);
    if (m.state !== MState.Absent) {
      setWidth($("monster-sleepy"), 1 - m.hp / m.maxHp);
      const mood =
        m.state === MState.Asleep
          ? "Fast asleep"
          : m.state === MState.Stunned
            ? "Dizzy!"
            : m.enraged
              ? "Grumpy! · Sleepiness"
              : "Sleepiness";
      setText($("monster-mood"), mood);
      setText($("monster-name"), MONSTER.name);
    }
    if (hunting) {
      setText($("hunt-info"), `Time ${clock(state.timeLeft)}  ·  Dizzy ${state.faints}/${MAX_FAINTS}`);
    }
    this.trackResult(state.phase);
  }

  /**
   * Keep the result panel up for the whole result phase, whichever of the Result message and the phase patch
   * arrives first, and take it down when the room is back at camp or hunting again.
   */
  private trackResult(phase: RoomView["phase"]): void {
    const r = this.result;
    if (!r) return;
    if (phase === "victory" || phase === "failed") {
      r.ended = true;
      return;
    }
    const stillTheOldHunt = phase === "hunt" && !r.ended && performance.now() - r.at < RESULT_PATCH_GRACE_MS;
    if (stillTheOldHunt) return;
    this.result = null;
    $("result").classList.add("hidden");
    $("hud").classList.remove("result-up");
  }

  banner(text: string, ms = 1800): void {
    // The result panel already says this in its heading ("Hunt failed…"): once is enough.
    if (this.result?.heading === text) return;
    const el = $("banner");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => el.classList.remove("show"), ms);
  }

  flashHurt(): void {
    const v = $("vignette");
    v.classList.add("flash");
    requestAnimationFrame(() => requestAnimationFrame(() => v.classList.remove("flash")));
  }

  showResult(r: ResultMsg, names: Map<string, string>): void {
    const el = $("result");
    el.replaceChildren();
    const h = document.createElement("h2");
    h.textContent = r.victory ? "Hunt complete!" : "Hunt failed…";
    const sub = document.createElement("div");
    sub.textContent = r.victory
      ? `${MONSTER.name} is fast asleep after ${clock(r.seconds)}.`
      : r.reason === "time"
        ? "Out of time. It wandered off."
        : "Too many dizzy hunters. Back to camp for a nap.";
    el.append(h, sub);

    const loot = r.loot[this.myId] ?? [];
    if (loot.length) {
      const box = document.createElement("div");
      box.className = "loot";
      for (const item of loot) {
        const s = document.createElement("span");
        s.textContent = `${item.icon} ${item.name} ×${item.qty}`;
        box.append(s);
      }
      el.append(box);
    }

    const rows = Object.entries(r.damage).sort((a, b) => b[1] - a[1]);
    const total = rows.reduce((n, [, d]) => n + d, 0) || 1;
    for (const [id, dmg] of rows) {
      const row = document.createElement("div");
      row.textContent = `${names.get(id) ?? "Hunter"} — ${Math.round((dmg / total) * 100)}% of the bonks`;
      el.append(row);
    }
    const foot = document.createElement("small");
    foot.textContent = "Returning to camp shortly…";
    el.append(foot);
    el.classList.remove("hidden");
    $("hud").classList.add("result-up");
    this.result = { heading: h.textContent, at: performance.now(), ended: false };
  }
}
