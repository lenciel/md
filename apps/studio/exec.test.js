import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { buildCommandLine, resolveCommandFile, resolveShell, usesFile } from './exec.js'
import { StudioError } from './workspace.js'

describe(`usesFile`, () => {
  it(`detects the {file} placeholder`, () => {
    expect(usesFile(`textlint --fix {file}`)).toBe(true)
    expect(usesFile(`rake prepare_deploy`)).toBe(false)
    expect(usesFile(undefined)).toBe(false)
  })
})

describe(`resolveCommandFile`, () => {
  it(`ignores the file for commands without the placeholder`, () => {
    expect(resolveCommandFile(`rake preview`, undefined)).toBe(null)
    expect(resolveCommandFile(`rake preview`, `_posts/a.md`)).toBe(null)
  })

  it(`returns a valid post path`, () => {
    expect(resolveCommandFile(`lint {file}`, `_posts/a.markdown`)).toBe(`_posts/a.markdown`)
  })

  it(`rejects a missing or empty reference`, () => {
    for (const value of [undefined, null, ``, 42]) {
      const err = (() => {
        try {
          resolveCommandFile(`lint {file}`, value)
        }
        catch (error) {
          return error
        }
        return null
      })()
      expect(err).toBeInstanceOf(StudioError)
      expect(err.status).toBe(400)
      expect(err.code).toBe(`no-active-file`)
    }
  })

  it(`rejects anything outside _posts`, () => {
    for (const value of [`../_posts/a.md`, `_site/a.md`, `_posts/sub/a.md`, `_posts/a.txt`, `Rakefile`]) {
      const err = (() => {
        try {
          resolveCommandFile(`lint {file}`, value)
        }
        catch (error) {
          return error
        }
        return null
      })()
      expect(err).toBeInstanceOf(StudioError)
      expect(err.code).toBe(`bad-path`)
    }
  })
})

describe(`buildCommandLine`, () => {
  it(`leaves commands without the placeholder untouched`, () => {
    expect(buildCommandLine(`rake prepare_deploy`, null)).toBe(`rake prepare_deploy`)
  })

  it(`quotes the expanded path`, () => {
    expect(buildCommandLine(`textlint --fix {file}`, `_posts/a.markdown`))
      .toBe(`textlint --fix '_posts/a.markdown'`)
  })

  it(`expands every occurrence`, () => {
    expect(buildCommandLine(`diff {file} {file}`, `_posts/a.md`))
      .toBe(`diff '_posts/a.md' '_posts/a.md'`)
  })

  it(`keeps a name with spaces and quotes as a single shell argument`, () => {
    // `isPostPath` allows these names, so the quoting is what stops them from
    // becoming shell syntax.
    for (const name of [`_posts/it's a test.markdown`, `_posts/a b.md`, `_posts/$(whoami).md`, `_posts/a;rm -rf x.md`]) {
      const line = buildCommandLine(`printf %s {file}`, name)
      const result = spawnSync(`zsh`, [`-c`, line], { encoding: `utf8` })
      expect(result.status).toBe(0)
      expect(result.stdout).toBe(name)
    }
  })
})

describe(`resolveShell`, () => {
  it(`keeps the interactive login shell by default`, () => {
    expect(resolveShell()).toEqual({ shell: `zsh`, args: [`-lic`] })
    expect(resolveShell({})).toEqual({ shell: `zsh`, args: [`-lic`] })
  })

  it(`takes the configured shell and arguments`, () => {
    expect(resolveShell({ shell: `/opt/homebrew/bin/zsh`, shellArgs: [`-c`] }))
      .toEqual({ shell: `/opt/homebrew/bin/zsh`, args: [`-c`] })
  })

  it(`falls back rather than spawning a shell it cannot trust`, () => {
    for (const broken of [{ shell: ``, shellArgs: [`-c`] }, { shell: 42 }, { shellArgs: [] }, { shellArgs: `-c` }, { shellArgs: [1] }]) {
      const { shell, args } = resolveShell(broken)
      expect(typeof shell).toBe(`string`)
      expect(shell.length).toBeGreaterThan(0)
      expect(args.length).toBeGreaterThan(0)
      expect(args.every(arg => typeof arg === `string`)).toBe(true)
    }
  })
})
