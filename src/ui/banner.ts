// zero — the ASCII install banner.
//
// Renders a block-letter "zero" wordmark with a violet→cyan truecolor gradient,
// shown at the top of the interactive installer. Pure: no terminal writes of
// its own — the caller prints the returned string. Honours NO_COLOR.

/** The "zero" wordmark in ANSI Shadow block letters. */
const ART: readonly string[] = [
  " ███████╗███████╗██████╗  ██████╗ ",
  " ╚══███╔╝██╔════╝██╔══██╗██╔═══██╗",
  "   ███╔╝ █████╗  ██████╔╝██║   ██║",
  "  ███╔╝  ██╔══╝  ██╔══██╗██║   ██║",
  " ███████╗███████╗██║  ██║╚██████╔╝",
  " ╚══════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ",
];

const TAGLINE = "   spec-driven workflow · skill learning · shared memory";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

/** Gradient endpoints — violet-400 to cyan-400. */
const FROM = { r: 0xa7, g: 0x8b, b: 0xfa };
const TO = { r: 0x22, g: 0xd3, b: 0xee };

/** Options for {@link renderBanner}. */
export interface BannerOptions {
  /** Force color on/off; when omitted, autodetect from NO_COLOR and the TTY. */
  color?: boolean;
}

/** Linearly interpolate one channel between two values. */
function lerp(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * t);
}

/** A truecolor (24-bit) foreground SGR sequence. */
function fg(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}

/** Decide whether to emit color: an explicit option wins, else autodetect. */
function useColor(option: boolean | undefined): boolean {
  if (typeof option === "boolean") return option;
  if (process.env.NO_COLOR) return false;
  return process.stdout.isTTY === true;
}

/**
 * Render the install banner: the "zero" wordmark plus a tagline. With color,
 * each art row takes one step of a violet→cyan gradient.
 */
export function renderBanner(options: BannerOptions = {}): string {
  const color = useColor(options.color);

  const art = ART.map((line, index) => {
    if (!color) return line;
    const t = ART.length > 1 ? index / (ART.length - 1) : 0;
    return `${fg(lerp(FROM.r, TO.r, t), lerp(FROM.g, TO.g, t), lerp(FROM.b, TO.b, t))}${line}${RESET}`;
  });

  const tagline = color ? `${DIM}${TAGLINE}${RESET}` : TAGLINE;
  return `\n${art.join("\n")}\n${tagline}\n`;
}

/** Sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Options for {@link revealBanner}. */
export interface RevealOptions extends BannerOptions {
  /** Force the line-by-line animation on/off; when omitted, autodetect. */
  animate?: boolean;
}

/**
 * Write the banner to stdout. By default it is revealed line by line for a
 * brief animation; on a non-interactive stream (or with NO_COLOR) it is
 * written at once.
 */
export async function revealBanner(options: RevealOptions = {}): Promise<void> {
  const banner = renderBanner({ color: options.color });
  const animate =
    options.animate ?? (process.stdout.isTTY === true && !process.env.NO_COLOR);
  if (!animate) {
    process.stdout.write(banner);
    return;
  }
  for (const line of banner.split("\n")) {
    process.stdout.write(`${line}\n`);
    await sleep(55);
  }
}
