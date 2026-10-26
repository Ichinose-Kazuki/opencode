export * as ConfigCompatibilityPlugin from "./compatibility.js"

import { define } from "@opencode/plugin/effect/plugin"
import { FSUtil } from "@opencode/util/fs-util"
import path from "path"
import { Effect, Semaphore, Stream } from "effect"
import { Config } from "../../config.js"
import { Skill } from "../../skill.js"
import { SkillFile } from "./skill-file.js"
import { SkillScan } from "./skill-scan.js"

export const Plugin = define({
  id: "opencode.config.compatibility",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const lock = Semaphore.makeUnsafe(1)
    const skills: Skill.Info[] = []

    const refresh = Effect.fn("ConfigCompatibilityPlugin.refresh")(
      function* () {
        const roots = config.compatibility ? yield* config.compatibility() : { claude: [], agents: [] }
        const directories = [...roots.claude, ...roots.agents].map((root) => path.join(root, "skills"))
        const loaded = new Map<Skill.ID, Skill.Info>()
        for (const directory of directories) {
          const resolved = yield* fs.realPath(directory).pipe(Effect.orElseSucceed(() => undefined))
          if (!resolved) continue
          for (const filepath of yield* SkillScan.scan(resolved)) {
            const content = yield* fs.readFileStringSafe(filepath).pipe(Effect.orElseSucceed(() => undefined))
            if (!content) continue
            const parsed = SkillFile.parse(resolved, filepath, content)
            if (parsed._tag === "Parsed") loaded.set(parsed.skill.id, parsed.skill)
          }
        }
        skills.splice(0, skills.length, ...loaded.values())
      },
      (effect) => lock.withPermit(effect),
    )

    const reload = refresh().pipe(Effect.andThen(ctx.skill.reload()))
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "config.updated"),
      Stream.runForEach(() => reload),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refresh()
    yield* ctx.skill.transform((editor) => {
      for (const skill of skills) editor.add(skill)
    })
  }),
})
