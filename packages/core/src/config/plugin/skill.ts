export * as ConfigSkillPlugin from "./skill.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { Entry } from "@opencode/schema/config"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import path from "path"
import { Effect, Stream } from "effect"
import { Config } from "../../config.js"
import { Location } from "../../location.js"
import { AbsolutePath } from "../../schema.js"
import { Skill } from "../../skill.js"
import { SkillDiscovery } from "../../skill/discovery.js"
import { SkillFile } from "./skill-file.js"
import { SkillScan } from "./skill-scan.js"

type Source = Skill.DirectorySource | Skill.UrlSource

export const Plugin = define({
  id: "opencode.config.skill",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const discovery = yield* SkillDiscovery.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const loaded: { entries: Entry[]; skills: Skill.Info[] } = {
      entries: yield* config.entries(),
      skills: [],
    }
    const sources = () => {
      const result: Source[] = []
      const add = (source: Source) => {
        if (result.some((item) => Skill.Source.equals(item, source))) return
        result.push(source)
      }
      const directories = loaded.entries.flatMap((entry) => (entry.type === "directory" ? [entry.path] : []))
      const items = loaded.entries.flatMap((entry) => (entry.type === "document" ? (entry.info.skills ?? []) : []))
      for (const directory of directories) {
        add(Skill.DirectorySource.make({ type: "directory", path: AbsolutePath.make(path.join(directory, "skill")) }))
        add(Skill.DirectorySource.make({ type: "directory", path: AbsolutePath.make(path.join(directory, "skills")) }))
      }
      for (const item of items) {
        if (URL.canParse(item) && /^(https?:)$/.test(new URL(item).protocol)) {
          add(Skill.UrlSource.make({ type: "url", url: item }))
          continue
        }
        const expanded = item.startsWith("~/") ? path.join(global.home, item.slice(2)) : item
        add(
          Skill.DirectorySource.make({
            type: "directory",
            path: AbsolutePath.make(path.isAbsolute(expanded) ? expanded : path.join(location.directory, expanded)),
          }),
        )
      }
      return result
    }

    const load = Effect.fn("ConfigSkillPlugin.load")(function* (source: Source) {
      const directories =
        source.type === "directory"
          ? [source.path]
          : yield* discovery.pull(source.url).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("failed to load skill source", {
                  source: Skill.Source.key(source),
                  cause,
                }).pipe(Effect.as([] as AbsolutePath[])),
              ),
            )
      const skills: Skill.Info[] = []
      for (const directory of directories) {
        for (const filepath of yield* SkillScan.scan(directory)) {
          const content = yield* fs.readFileStringSafe(filepath).pipe(Effect.orElseSucceed(() => undefined))
          if (!content) continue
          const parsed = SkillFile.parse(directory, filepath, content)
          if (parsed._tag === "Skipped") {
            yield* Effect.logDebug("skill file skipped", {
              filepath,
              reason: parsed.reason,
              ...(parsed.reason === "frontmatter" ? { issue: parsed.issue } : {}),
            })
            continue
          }
          skills.push(parsed.skill)
        }
      }
      yield* Effect.logDebug("skill source loaded", {
        source: Skill.Source.key(source),
        type: source.type,
        directories,
        skills: skills.map((skill) => skill.id),
      })
      return skills
    })

    const refresh = Effect.fn("ConfigSkillPlugin.refresh")(function* () {
      const skills = new Map<Skill.ID, Skill.Info>()
      for (const source of sources()) {
        for (const skill of yield* load(source)) skills.set(skill.id, skill)
      }
      loaded.skills = Array.from(skills.values())
    })

    yield* refresh()
    yield* ctx.skill.transform((editor) => {
      for (const skill of loaded.skills) editor.add(skill)
    })
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "config.updated"),
      Stream.runForEach(() =>
        config.entries().pipe(
          Effect.tap((entries) => Effect.sync(() => (loaded.entries = entries))),
          Effect.andThen(refresh()),
          Effect.andThen(ctx.skill.reload()),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
