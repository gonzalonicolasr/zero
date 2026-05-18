// zero — the pi adapter.
//
// Installs the zero layer onto pi (pi.dev) the gentle-pi way: as the
// `zero-pi` package. The package — the SDD workflow prompts, the skill-learning
// assets, and the animated ZERO startup-banner extension — lives under
// `packages/zero-pi/` and is shipped with zero; it is also published to npm
// as `@gonrocca/zero-pi` so it can be installed standalone with
// `pi install npm:@gonrocca/zero-pi`.
//
// The adapter:
//   1. bootstraps pi.dev itself when the `pi` CLI is missing;
//   2. delivers the zero-pi package — by default `pi install`s it from npm
//      (`npm:@gonrocca/zero-pi`); a local ZERO_PI_SOURCE is instead registered
//      directly in `~/.pi/agent/settings.json` through the install context;
//   3. merges the Cortex MCP server into `~/.pi/agent/mcp.json`;
//   4. records the install — and the per-phase models — in `~/.pi/zero.json`.
//
// Set ZERO_PI_SOURCE to override the package source (e.g. `npm:@gonrocca/zero-pi`
// or a git source). A remote source is fetched by spawning `pi install`; the
// default local source is registered through the backup-aware install context
// so the install stays reversible.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AgentAdapter,
  AgentStatus,
  InstallContext,
  InstallReport,
  McpServer,
  Payload,
  PhaseModels,
} from "../types.ts";
import { ZERO_VERSION } from "../version.ts";
import { zeroHome } from "./detect.ts";

/** The leaf name of the zero layer — the bundled dir and the scoped npm leaf. */
const PACKAGE_NAME = "zero-pi";

/** The published npm name of the zero layer. */
const PACKAGE_NPM_NAME = "@gonrocca/zero-pi";

/** The npm package zero bootstraps when the `pi` CLI is missing. */
const PI_NPM_PACKAGE = "@earendil-works/pi-coding-agent";

/** A source string that pi fetches over the network rather than reading locally. */
const REMOTE_SOURCE = /^(npm:|git:|https?:|ssh:)/;

/** Read a JSON file, returning a fallback when it is absent or invalid. */
function readJsonSafe<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/**
 * Whether a packages-list entry refers to the zero-pi package, in any form:
 * the scoped npm name, a bare or `npm:`-prefixed legacy name, or a local path.
 */
function isZeroPiEntry(entry: unknown): boolean {
  if (typeof entry !== "string") return false;
  if (entry === PACKAGE_NAME || entry === `npm:${PACKAGE_NAME}`) return true;
  if (entry === PACKAGE_NPM_NAME || entry === `npm:${PACKAGE_NPM_NAME}`) return true;
  // A scoped npm name or a local path: the trailing segment is the leaf name.
  return entry.split(/[\\/]/).pop() === PACKAGE_NAME;
}

/** The absolute path of the zero-pi package bundled with zero. */
function bundledPackagePath(): string {
  return fileURLToPath(new URL("../../packages/zero-pi", import.meta.url));
}

/**
 * The package source to install, and whether pi must fetch it remotely.
 *
 * By default the published npm package; ZERO_PI_SOURCE overrides it — point it
 * at the bundled local path ({@link bundledPackagePath}) to install offline.
 */
function resolveSource(): { source: string; remote: boolean } {
  const override = process.env.ZERO_PI_SOURCE?.trim();
  if (override) return { source: override, remote: REMOTE_SOURCE.test(override) };
  return { source: `npm:${PACKAGE_NPM_NAME}`, remote: true };
}

/**
 * The external side-effects the pi install needs — installing pi.dev and
 * running pi's package manager. Injectable so tests stay hermetic (no spawns).
 */
export interface PiToolchain {
  /** Whether the `pi` CLI resolves on PATH. */
  piAvailable(): boolean;
  /** Bootstrap pi.dev globally. Throws on failure. */
  bootstrapPi(): void;
  /** Run `pi install <source>` for a remote source. Throws on failure. */
  installRemote(source: string): void;
}

/** The real toolchain — shells out to npm and pi. */
function defaultToolchain(): PiToolchain {
  const onWindows = process.platform === "win32";
  return {
    piAvailable(): boolean {
      try {
        return (
          spawnSync(onWindows ? "where" : "which", ["pi"], { stdio: "ignore" }).status === 0
        );
      } catch {
        return false;
      }
    },
    bootstrapPi(): void {
      const result = spawnSync("npm", ["install", "-g", PI_NPM_PACKAGE], {
        stdio: "inherit",
        shell: onWindows,
      });
      if (result.status !== 0) {
        throw new Error(`zero: failed to install pi.dev (${PI_NPM_PACKAGE})`);
      }
    },
    installRemote(source: string): void {
      const result = spawnSync("pi", ["install", source], {
        stdio: "inherit",
        shell: onWindows,
      });
      if (result.status !== 0) {
        throw new Error(`zero: 'pi install ${source}' failed`);
      }
    },
  };
}

/** The active toolchain; tests swap it through {@link setPiToolchain}. */
let activeToolchain: PiToolchain = defaultToolchain();

/** Override the pi toolchain (tests). Passing null restores the real one. */
export function setPiToolchain(toolchain: PiToolchain | null): void {
  activeToolchain = toolchain ?? defaultToolchain();
}

/** The pi agent adapter. */
export class PiAdapter implements AgentAdapter {
  readonly id = "pi" as const;

  /** pi's configuration directory. */
  private configDir(): string {
    return join(zeroHome(), ".pi");
  }

  /**
   * pi is always a valid install target: when it is missing, zero bootstraps
   * pi.dev during the install. So detection returns the config directory
   * unconditionally rather than gating on the directory already existing.
   */
  detect(): { configDir: string } | null {
    return { configDir: this.configDir() };
  }

  install(payload: Payload, ctx: InstallContext): InstallReport {
    const changed: string[] = [];

    // 1. Ensure pi.dev is present — install it when the CLI is missing.
    if (!activeToolchain.piAvailable()) {
      activeToolchain.bootstrapPi();
    }

    // 2. Deliver the zero-pi package.
    const { source, remote } = resolveSource();
    if (remote) {
      // A remote source: pi fetches it and registers it in settings.json
      // itself — those files are pi-managed, outside zero's snapshot.
      activeToolchain.installRemote(source);
    } else {
      // A local source: registering its path in settings.json is exactly what
      // `pi install ./path` does. Done through the context so it is snapshotted
      // and the install stays reversible.
      this.registerPackage(source, ctx);
      changed.push("agent/settings.json");
    }

    // 3. Merge the Cortex MCP server, preserving the user's servers.
    this.applyMcp(payload.mcpDefaults, ctx);
    changed.push("agent/mcp.json");

    // 4. Record the install in zero's marker file.
    ctx.mergeJson("zero.json", {
      version: ZERO_VERSION,
      installedAt: new Date().toISOString(),
    });
    changed.push("zero.json");

    return { agent: this.id, changed, outcome: "installed" };
  }

  /** Register the zero-pi source in pi's `packages`, replacing any prior entry. */
  private registerPackage(source: string, ctx: InstallContext): void {
    const settingsPath = join(this.configDir(), "agent", "settings.json");
    const settings = readJsonSafe<Record<string, unknown>>(settingsPath, {});
    const existing = Array.isArray(settings.packages) ? (settings.packages as unknown[]) : [];
    const packages = existing.filter((entry) => !isZeroPiEntry(entry));
    packages.push(source);
    ctx.write(
      "agent/settings.json",
      `${JSON.stringify({ ...settings, packages }, null, 2)}\n`,
    );
  }

  status(): AgentStatus {
    const marker = readJsonSafe<{ version?: unknown }>(
      join(this.configDir(), "zero.json"),
      {},
    );
    if (typeof marker.version === "string") {
      return { agent: this.id, installed: true, version: marker.version };
    }
    return { agent: this.id, installed: false, version: null };
  }

  applyMcp(servers: McpServer[], ctx: InstallContext): void {
    const mcpServers: Record<string, unknown> = {};
    for (const server of servers) {
      mcpServers[server.name] = { transport: server.transport, ...server.spec };
    }
    ctx.mergeJson("agent/mcp.json", { mcpServers });
  }

  applyModels(models: PhaseModels, ctx: InstallContext): void {
    ctx.mergeJson("zero.json", { models });
  }
}

/** Whether the zero-pi package is bundled with this zero install. */
export function packageIsBundled(): boolean {
  return existsSync(join(bundledPackagePath(), "package.json"));
}
