export * as ConfigPluginSource from "./source.js"

import { Directory, Document, type Entry } from "@opencode/schema/config"
import { ConfigPlugin } from "@opencode/schema/config/plugin"
import { FSUtil } from "@opencode/util/fs-util"
import { Host } from "@opencode/plugin/host"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Option, Scope } from "effect"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { Config } from "../../config.js"
import { Location } from "../../location.js"
import { PluginSourceDirectory } from "../../plugin/source-directory.js"

export type Operation =
  | {
      readonly type: "add"
      readonly target: string
      readonly options: Record<string, unknown>
      readonly mtime?: number
    }
  | {
      readonly type: "remove"
      readonly target: string
    }

export interface Interface {
  readonly operations: () => Effect.Effect<readonly Operation[], never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ConfigPluginSource") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service

    return Service.of({
      operations: Effect.fn("ConfigPluginSource.operations")(function* () {
        return yield* scan(fs, location, yield* config.entries())
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node, FSUtil.node, Location.node],
})

export const empty = makeLocationNode({
  service: Service,
  layer: Layer.succeed(
    Service,
    Service.of({
      operations: () => Effect.succeed([]),
    }),
  ),
  deps: [],
})

function parse(input: ConfigPlugin.Plugin): Operation {
  if (typeof input !== "string") {
    return { type: "add", target: input.package, options: input.options ?? {} }
  }
  if (!input.startsWith("-")) return { type: "add", target: input, options: {} }
  if (input.length === 1) throw new Error("Plugin remove operation requires a target")
  return { type: "remove", target: input.slice(1) }
}

const scan = Effect.fn("ConfigPluginSource.scan")(function* (
  fs: FSUtil.Interface,
  location: Location.Interface,
  entries: readonly Entry[],
) {
  const discovered = yield* Effect.forEach(
    entries.filter((entry): entry is Directory => entry.type === "directory"),
    (entry) =>
      PluginSourceDirectory.discover(fs, entry.path).pipe(
        Effect.map((targets) => targets.map((target): Operation => ({ type: "add", target, options: {} }))),
      ),
  ).pipe(Effect.map((items) => items.flat()))
  const configured = entries
    .filter((entry): entry is Document => entry.type === "document")
    .flatMap((entry) =>
      (entry.info.plugins ?? []).map(parse).map((operation) => {
        if (operation.type === "remove") return operation
        const directory = entry.path ? path.dirname(entry.path) : location.directory
        const target = operation.target.startsWith("file://")
          ? fileURLToPath(operation.target)
          : operation.target.startsWith("./") || operation.target.startsWith("../")
            ? path.resolve(directory, operation.target)
            : operation.target
        return { ...operation, target }
      }),
    )
  const resolved = yield* Effect.forEach(configured, (operation) =>
    Effect.gen(function* () {
      if (operation.type === "remove" || !path.isAbsolute(operation.target)) return Option.some(operation)
      if (yield* fs.isFile(operation.target)) {
        yield* Effect.logWarning("configured plugin path must be a directory", { target: operation.target })
        return Option.none<Operation>()
      }
      return Option.some<Operation>(operation)
    }),
  ).pipe(Effect.map((operations) => operations.flatMap(Option.toArray)))
  // Explicit config is applied last so it can remove auto-discovered packages.
  return yield* Effect.forEach([...discovered, ...resolved], (operation) =>
    Effect.gen(function* () {
      if (operation.type === "remove" || !path.isAbsolute(operation.target)) return [operation]
      if (!(yield* fs.existsSafe(operation.target))) return [operation]
      const directory = yield* fs.isDir(operation.target)
      const entrypoints: Host.Entrypoints = directory
        ? yield* Effect.sync(() => Host.resolve({ directory: operation.target }))
        : { server: pathToFileURL(operation.target).href }
      if (!entrypoints.server) return []
      if (directory) {
        const root = yield* fs.resolve(operation.target)
        const server = yield* fs.resolve(fileURLToPath(entrypoints.server))
        if (!FSUtil.contains(root, server)) return []
      }
      const times = yield* Effect.forEach(
        [
          ...Object.values(entrypoints)
            .filter((entry) => entry !== undefined)
            .map((entry) => fileURLToPath(entry)),
          path.join(directory ? operation.target : path.dirname(operation.target), "package.json"),
        ],
        (entry) =>
          fs.stat(entry).pipe(
            Effect.map((info) => Option.getOrElse(info.mtime, () => new Date(0)).getTime()),
            Effect.orElseSucceed(() => 0),
          ),
      )
      return [{ ...operation, mtime: Math.max(...times) }]
    }),
  ).pipe(Effect.map((operations) => operations.flat()))
})
