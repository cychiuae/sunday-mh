import { HUNTER_COLORS, MAX_PLAYERS } from "@pufflings/shared";
import { unlockAudio } from "./audio";
import { Game } from "./game";
import { inviteLink } from "./hud";
import { joinHunt, type JoinMode } from "./net";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const nameInput = $<HTMLInputElement>("name");
const codeInput = $<HTMLInputElement>("code");
const errorBox = $("menu-error");
let color = Number(localStorage.getItem("pufflings.color") ?? 0) % HUNTER_COLORS.length;

nameInput.value = localStorage.getItem("pufflings.name") ?? "";
codeInput.value = new URLSearchParams(location.search).get("room") ?? "";

const swatches = HUNTER_COLORS.map((hex, i) => {
  const b = document.createElement("button");
  b.style.background = `#${hex.toString(16).padStart(6, "0")}`;
  b.setAttribute("aria-label", `Hood colour ${i + 1}`);
  b.addEventListener("click", () => {
    color = i;
    paint();
  });
  $("colors").append(b);
  return b;
});

function paint(): void {
  swatches.forEach((b, i) => b.classList.toggle("picked", i === color));
}
paint();

/**
 * Words for a failed join. The Colyseus SDK throws a `MatchMakeError` carrying a numeric `code` when the server
 * answered with a refusal, and a plain network error (no `code`) when the server could not be reached. Joining by
 * code is refused with the same code (invalid room id) for an unknown room and for a full one; only the message
 * tells them apart: `room "x" not found` or `room "x" is locked`. The server locks a room when it is full.
 */
function joinErrorText(mode: JoinMode, err: unknown): string {
  const e = (err ?? {}) as { code?: unknown; message?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  if (typeof e.code !== "number") return "Couldn't reach the game server. Check your connection and try again.";
  if (mode.kind !== "code") return "Couldn't set up a hunt just now. Please try again.";
  if (/\b(locked|full)\b/i.test(message)) {
    return `That hunt is full: all ${MAX_PLAYERS} hunters are already there. Try Quick Hunt, or host your own.`;
  }
  return "Couldn't find that hunt. Check the invite code.";
}

/**
 * The room is gone for good. The running game cannot be joined to a new room, so the one way back in is a fresh
 * page: this screen says so and offers exactly that, with the invite code carried along.
 */
function showDisconnected(roomCode: string): void {
  document.exitPointerLock?.();
  $("net-note").classList.add("hidden");
  $("hud").classList.add("hidden");
  $("menu-main").classList.add("hidden");
  $("menu-gone").classList.remove("hidden");
  $("menu").classList.remove("hidden");
  $("gone-note").textContent = `Invite code ${roomCode} will be filled in, in case the hunt is still on.`;
  const back = $("gone-back");
  back.addEventListener("click", () => location.assign(inviteLink(roomCode)));
  back.focus();
}

let joining = false;

async function join(mode: JoinMode): Promise<void> {
  if (joining) return;
  joining = true;
  errorBox.textContent = "Joining…";
  unlockAudio();
  const name = nameInput.value.trim();
  localStorage.setItem("pufflings.name", name);
  localStorage.setItem("pufflings.color", String(color));
  try {
    const room = await joinHunt(mode, { name, color });
    $("menu").classList.add("hidden");
    const game = new Game(room, $<HTMLCanvasElement>("game"));
    (window as unknown as { __game: Game }).__game = game;
    // A dropped socket is retried by the SDK for a while before the room gives up and leaves.
    room.onDrop(() => $("net-note").classList.remove("hidden"));
    room.onReconnect(() => $("net-note").classList.add("hidden"));
    room.onLeave(() => showDisconnected(room.roomId));
  } catch (err) {
    console.error(err);
    errorBox.textContent = joinErrorText(mode, err);
    joining = false;
  }
}

$("quick").addEventListener("click", () => void join({ kind: "quick" }));
$("host").addEventListener("click", () => void join({ kind: "host" }));
$("join").addEventListener("click", () => {
  const code = codeInput.value.trim();
  if (!code) {
    errorBox.textContent = "Enter an invite code first.";
    return;
  }
  void join({ kind: "code", code });
});
