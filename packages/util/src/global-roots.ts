import os from "os"
import path from "path"

const home = os.homedir()
// OPENCODE_* overrides keep opencode's own locations off the XDG variables, so
// a wrapper can relocate opencode without XDG-aware tools reacting to it.
const data =
  process.env.OPENCODE_DATA_HOME || process.env.XDG_DATA_HOME || (home ? path.join(home, ".local", "share") : undefined)
const cache =
  process.env.OPENCODE_CACHE_HOME || process.env.XDG_CACHE_HOME || (home ? path.join(home, ".cache") : undefined)
const config = process.env.XDG_CONFIG_HOME || (home ? path.join(home, ".config") : undefined)
const state =
  process.env.OPENCODE_STATE_HOME || process.env.XDG_STATE_HOME || (home ? path.join(home, ".local", "state") : undefined)

/** The base directories that root opencode's global paths (OPENCODE_* over XDG over home). */
export function roots(app: string) {
  return {
    data: path.join(data!, app),
    cache: path.join(cache!, app),
    config: path.join(config!, app),
    state: path.join(state!, app),
    tmp: path.join(os.tmpdir(), app),
  }
}
