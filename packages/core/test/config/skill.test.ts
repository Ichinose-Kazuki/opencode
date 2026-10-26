import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Config } from "@opencode/core/config"
import { Directory, Document, type Entry, Info } from "@opencode/schema/config"
import { ConfigSkillPlugin } from "@opencode/core/config/plugin/skill"
import { ConfigCompatibilityPlugin } from "@opencode/core/config/plugin/compatibility"
import { SkillFile } from "@opencode/core/config/plugin/skill-file"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { Skill } from "@opencode/core/skill"
import { SkillDiscovery } from "@opencode/core/skill/discovery"
import { WellKnown } from "@opencode/core/wellknown"
import { emptyCredentialNode, emptyWellknownNode } from "../fixture/config-nodes"
import { tmpdir } from "../fixture/tmpdir"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { host } from "../plugin/host"

const emptyDiscovery = SkillDiscovery.Service.of({ pull: () => Effect.succeed([]) })
const it = testEffect(AppNodeBuilder.build(LayerNode.group([Skill.node, Bus.node, FSUtil.node])))
const decode = Schema.decodeUnknownSync(Info)

function write(directory: string, name: string, description: string) {
  return fs.writeFile(
    path.join(directory, name, "SKILL.md"),
    `---
name: ${name}
description: ${description}
---
# ${name}`,
  )
}

const startEntries = Effect.fnUntraced(function* (
  entries: Entry[],
  directory: string,
  home = directory,
  discovery = emptyDiscovery,
  compatibility: { readonly claude: readonly AbsolutePath[]; readonly agents: readonly AbsolutePath[] } = {
    claude: [],
    agents: [],
  },
) {
  const service = yield* Skill.Service
  const pluginHost = host({
    skill: {
      list: () => Effect.die("unused skill.list"),
      transform: service.transform,
      reload: service.reload,
    },
  })
  yield* ConfigCompatibilityPlugin.Plugin.effect(pluginHost).pipe(
    Effect.provide(Config.testLayer(entries, compatibility)),
  )
  yield* ConfigSkillPlugin.Plugin.effect(
    pluginHost,
  ).pipe(
    Effect.provide(Config.testLayer(entries, compatibility)),
    Effect.provideService(SkillDiscovery.Service, discovery),
    Effect.provideService(Global.Service, Global.Service.of({ ...Global.make(), home })),
    Effect.provideService(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
  )
  return service
})

const start = (skills: string[], directory: string, discovery = emptyDiscovery) =>
  startEntries(
    [
      new Document({
        type: "document",
        info: decode({ skills }),
      }),
    ],
    directory,
    directory,
    discovery,
  )

const discover = (directory: string, global: string) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    return { entries: yield* config.entries(), compatibility: yield* config.compatibility!() }
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([Config.node, Bus.node]), [
        Location.node.replace(
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ),
        Global.node.replace(Global.layerWith({ config: global, home: path.join(global, "home") })),
        Credential.node.replace(emptyCredentialNode),
        WellKnown.node.replace(emptyWellknownNode),
      ]),
    ),
  )

describe("SkillFile.parse", () => {
  test("reads disable-model-invocation as autoinvoke", () => {
    const parse = (frontmatter: string) =>
      SkillFile.parse("/repo/skills", "/repo/skills/deploy/SKILL.md", `---\n${frontmatter}\n---\n# deploy`)
    expect(parse("disable-model-invocation: true")).toMatchObject({ skill: { autoinvoke: false } })
    expect(parse("disable-model-invocation: yes")).toMatchObject({ skill: { autoinvoke: false } })
    expect(parse("disable-model-invocation: false")).not.toMatchObject({ skill: { autoinvoke: expect.anything() } })
    expect(parse("disable-model-invocation: maybe")).not.toMatchObject({ skill: { autoinvoke: expect.anything() } })
    expect(
      parse("disable-model-invocation: true\nmetadata:\n  opencode/autoinvoke: true"),
    ).toMatchObject({ skill: { autoinvoke: true } })
  })

  test("parses root and nested skill ids and metadata flags", () => {
    const directory = "/repo/skills"
    expect(
      SkillFile.parse(
        directory,
        "/repo/skills/manual/SKILL.md",
        `---
name: Manual
description: Manual only
metadata:
  opencode/autoinvoke: false
---
# manual`,
      ),
    ).toEqual({
      _tag: "Parsed",
      skill: {
        id: Skill.ID.make("manual"),
        name: Skill.Name.make("Manual"),
        description: "Manual only",
        autoinvoke: false,
        path: AbsolutePath.make("/repo/skills/manual/SKILL.md"),
        content: "# manual",
      },
    })
    expect(SkillFile.parse(directory, "/repo/skills/foo.md", "# foo")).toMatchObject({
      _tag: "Parsed",
      skill: { id: Skill.ID.make("foo") },
    })
    expect(SkillFile.parse("/repo/skills/manual", "/repo/skills/manual/SKILL.md", "# manual")).toMatchObject({
      _tag: "Parsed",
      skill: { id: Skill.ID.make("manual"), name: Skill.Name.make("manual") },
    })
    expect(
      SkillFile.parse(directory, "/repo/skills/broken.md", "---\ndescription: foo: bar\nmetadata: [\n---\n# broken"),
    ).toEqual({ _tag: "Skipped", reason: "markdown" })
  })
})

describe("ConfigSkillPlugin.Plugin", () => {
  it.live("maps config entry types to skill directories", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const claude = path.join(tmp.path, "claude")
          const agents = path.join(tmp.path, "agents")
          const opencode = path.join(tmp.path, "opencode")
          const home = path.join(tmp.path, "home")
          const directory = path.join(tmp.path, "project")
          const expected = [
            path.join(claude, "skills"),
            path.join(agents, "skills"),
            path.join(opencode, "skill"),
            path.join(opencode, "skills"),
            path.join(home, "shared"),
            path.join(directory, "relative"),
          ]
          yield* Effect.promise(() =>
            Promise.all(
              expected.map(async (item, index) => {
                await fs.mkdir(path.join(item, `skill-${index}`), { recursive: true })
                await write(item, `skill-${index}`, item)
              }),
            ),
          )

          const skill = yield* startEntries(
            [
              new Directory({ type: "directory", path: AbsolutePath.make(opencode) }),
              new Document({ type: "document", info: decode({ skills: ["~/shared", "./relative"] }) }),
            ],
            directory,
            home,
            emptyDiscovery,
            { claude: [AbsolutePath.make(claude)], agents: [AbsolutePath.make(agents)] },
          )
          expect(
            (yield* skill.list())
              .map((item) => ({ id: item.id, description: item.description }))
              .toSorted((a, b) => a.id.localeCompare(b.id)),
          ).toEqual(expected.map((item, index) => ({ id: Skill.ID.make(`skill-${index}`), description: item })))
        }),
      ),
    ),
  )

  it.live("loads directory and individual downloaded skill roots with later-source precedence", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const first = path.join(tmp.path, "first")
          const second = path.join(tmp.path, "second")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(first, "review"), { recursive: true })
            await fs.mkdir(path.join(second, "deploy"), { recursive: true })
            await fs.mkdir(path.join(second, "review"), { recursive: true })
            await write(first, "review", "First")
            await write(second, "deploy", "Deploy")
            await write(second, "review", "Second")
          })
          const pulls: string[] = []
          const discovery = SkillDiscovery.Service.of({
            pull: (url) => {
              pulls.push(url)
              return Effect.succeed([
                AbsolutePath.make(path.join(second, "deploy")),
                AbsolutePath.make(path.join(second, "review")),
              ])
            },
          })

          const skill = yield* start([first, "https://example.test/skills/"], tmp.path, discovery)
          expect((yield* skill.list()).map((item) => item.id).toSorted()).toEqual([
            Skill.ID.make("deploy"),
            Skill.ID.make("review"),
          ])
          expect((yield* skill.list()).find((item) => item.id === "deploy")?.description).toBe("Deploy")
          expect((yield* skill.list()).find((item) => item.id === "review")?.description).toBe("Second")
          expect(pulls).toEqual(["https://example.test/skills/"])
        }),
      ),
    ),
  )

  it.live("prefers a worktree skill over the parent checkout copy", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const checkout = path.join(tmp.path, "repo")
          const worktree = path.join(checkout, ".worktrees", "feature")
          const parentSkills = path.join(checkout, ".agents", "skills")
          const worktreeSkills = path.join(worktree, ".agents", "skills")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(checkout, ".git"), { recursive: true })
            await fs.mkdir(path.join(parentSkills, "review"), { recursive: true })
            await fs.mkdir(path.join(worktreeSkills, "review"), { recursive: true })
            await fs.writeFile(path.join(worktree, ".git"), "gitdir: ../../../.git/worktrees/feature\n")
            await write(parentSkills, "review", "Parent checkout")
            await write(worktreeSkills, "review", "Worktree")
          })

          const discovered = yield* discover(worktree, path.join(tmp.path, "global"))
          const skill = yield* startEntries(
            discovered.entries,
            worktree,
            worktree,
            emptyDiscovery,
            discovered.compatibility,
          )
          const review = (yield* skill.list()).find((item) => item.id === "review")

          expect(review?.description).toBe("Worktree")
          expect(review?.path).toBe(AbsolutePath.make(path.join(worktreeSkills, "review", "SKILL.md")))
        }),
      ),
    ),
  )

  it.live("keeps directory skills when a URL source fails", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(tmp.path, "review"), { recursive: true })
            await write(tmp.path, "review", "Available")
          })
          const url = "https://unreachable.example.test/skills/"
          const discovery = SkillDiscovery.Service.of({ pull: () => Effect.die(`failed to pull ${url}`) })

          const skill = yield* start([tmp.path, url], tmp.path, discovery)
          expect((yield* skill.list()).find((item) => item.id === "review")?.description).toBe("Available")
        }),
      ),
    ),
  )

  it.live("loads canonical files behind symlinked skills", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const source = path.join(tmp.path, "source")
          const target = path.join(tmp.path, "target", "bro")
          const file = path.join(target, "SKILL.md")
          yield* Effect.promise(async () => {
            await fs.mkdir(source, { recursive: true })
            await fs.mkdir(target, { recursive: true })
            await fs.writeFile(file, "---\nname: bro\ndescription: Initial\n---\n# bro")
            await fs.symlink(target, path.join(source, "bro"), process.platform === "win32" ? "junction" : undefined)
          })

          const skill = yield* start([source], tmp.path)
          expect((yield* skill.list()).find((item) => item.id === "bro")?.description).toBe("Initial")
        }),
      ),
    ),
  )

  it.live("loads symlinked sources from their target", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const source = path.join(tmp.path, "source")
          const first = path.join(tmp.path, "first")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(first, "bro"), { recursive: true })
            await write(first, "bro", "First")
            await fs.symlink(first, source, process.platform === "win32" ? "junction" : undefined)
          })

          const skill = yield* start([source], tmp.path)
          expect((yield* skill.list()).find((item) => item.id === "bro")?.description).toBe("First")
        }),
      ),
    ),
  )
})
