/**
 * Heartbeat input layer: keyboard and gamepad both map to the same named actions, so game
 * code asks "is boost held?" instead of "is Shift or RB held?".
 */
export type Action = 'forward' | 'back' | 'left' | 'right' | 'up' | 'down' | 'boost' | 'overview' | 'gnme' | 'folio' | 'jump';

const KEY_BINDINGS: Record<string, Action> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'up',
  KeyC: 'down',
  ControlLeft: 'down',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
  KeyM: 'overview',
  KeyG: 'gnme',
  Tab: 'folio',
  KeyJ: 'jump',
};

/** Standard-mapping gamepad buttons. */
const PAD_BUTTONS: [number, Action][] = [
  [0, 'up'],
  [1, 'down'],
  [5, 'boost'],
  [3, 'overview'],
  [8, 'gnme'],
  [9, 'folio'],
];

const DEADZONE = 0.15;
const dead = (v: number) => (Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE));

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

export class Input {
  private readonly keys = new Set<Action>();
  private readonly pad = new Set<Action>();
  private readonly pressed = new Set<Action>();
  private padMove = { x: 0, y: 0 };
  /** Right-stick look, -1..1 per axis. */
  readonly look = { x: 0, y: 0 };

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      const action = KEY_BINDINGS[e.code];
      if (!action) return;
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
      if (!e.repeat) this.pressed.add(action);
      this.keys.add(action);
    });
    window.addEventListener('keyup', (e) => {
      const action = KEY_BINDINGS[e.code];
      if (action) this.keys.delete(action);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Call once per frame before reading. */
  poll(): void {
    const gp = navigator.getGamepads?.().find((g) => g?.connected) ?? null;
    const before = new Set(this.pad);
    this.pad.clear();
    this.padMove = { x: 0, y: 0 };
    this.look.x = 0;
    this.look.y = 0;
    if (!gp) return;
    this.padMove = { x: dead(gp.axes[0] ?? 0), y: dead(gp.axes[1] ?? 0) };
    this.look.x = dead(gp.axes[2] ?? 0);
    this.look.y = dead(gp.axes[3] ?? 0);
    for (const [i, action] of PAD_BUTTONS) {
      if (gp.buttons[i]?.pressed) {
        this.pad.add(action);
        if (!before.has(action)) this.pressed.add(action);
      }
    }
  }

  /** Call once per frame after reading, so `wasPressed` only fires once. */
  endFrame(): void {
    this.pressed.clear();
  }

  isDown(a: Action): boolean {
    return this.keys.has(a) || this.pad.has(a);
  }

  /** True on the frame the action was first pressed. */
  wasPressed(a: Action): boolean {
    return this.pressed.has(a);
  }

  /** Movement axes in -1..1: x = right, y = forward. */
  move(): { x: number; y: number } {
    const kx = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
    const ky = (this.isDown('forward') ? 1 : 0) - (this.isDown('back') ? 1 : 0);
    return { x: Math.max(-1, Math.min(1, kx + this.padMove.x)), y: Math.max(-1, Math.min(1, ky - this.padMove.y)) };
  }

  clear(): void {
    this.keys.clear();
    this.pressed.clear();
  }
}
