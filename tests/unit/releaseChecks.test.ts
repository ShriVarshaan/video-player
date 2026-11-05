import { describe, expect, it } from 'vitest'
import { checkRelease, notesFor } from '../../scripts/releaseChecks.mjs'

const CHANGELOG = `# Changelog

## 1.1.0

- Newer things.

## 1.0.0

- First release.
- It plays films.
`

const good = {
  branch: 'main',
  dirty: false,
  head: 'abc',
  originMain: 'abc',
  version: '1.0.0',
  published: ['0.9.0'],
  hasToken: true,
  changelog: CHANGELOG
}

describe('checkRelease', () => {
  it('is happy when everything is right', () => {
    expect(checkRelease(good)).toEqual([])
  })

  it.each([
    ['not on main', { branch: 'milestone-10' }, /main/],
    ['uncommitted changes', { dirty: true }, /uncommitted/i],
    ['main not pushed', { head: 'def' }, /push/i],
    ['already released', { published: ['1.0.0'] }, /already/i],
    ['no token', { hasToken: false }, /GH_TOKEN/],
    ['no changelog entry', { version: '2.0.0' }, /CHANGELOG/],
    // It would be compiled in, and everyone who updated would seem to lose their library.
    ['the test data folder switch is set', { dataFolderOverride: 'video-player-update-test' }, /VP_DATA_FOLDER/]
  ])('%s is a problem', (_name, change, message) => {
    const problems = checkRelease({ ...good, ...change })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(message)
  })

  it('a draft at the same version is fine: it is not in published', () => {
    expect(checkRelease({ ...good, published: [] })).toEqual([])
  })

  it('reports every problem at once', () => {
    expect(checkRelease({ ...good, branch: 'x', dirty: true, hasToken: false })).toHaveLength(3)
  })
})

describe('notesFor', () => {
  it("returns just that version's section", () => {
    expect(notesFor(CHANGELOG, '1.0.0')).toBe('- First release.\n- It plays films.')
    expect(notesFor(CHANGELOG, '1.1.0')).toBe('- Newer things.')
  })

  it('copes with Windows line endings', () => {
    expect(notesFor(CHANGELOG.replace(/\n/g, '\r\n'), '1.1.0')).toBe('- Newer things.')
  })

  it('keeps the first note when no blank line follows the heading', () => {
    expect(notesFor('## 1.1.0\n- First\n- Second\n\n## 1.0.0\n\n- Old.', '1.1.0')).toBe('- First\n- Second')
    expect(notesFor('## 1.1.0\n- Only\n', '1.1.0')).toBe('- Only')
  })

  it('a heading can carry a date', () => {
    expect(notesFor('## 1.1.0 - 2026-11-05\n\n- Dated.', '1.1.0')).toBe('- Dated.')
  })

  it('finds nothing for a version not listed, or a part of one', () => {
    expect(notesFor(CHANGELOG, '2.0.0')).toBeNull()
    expect(notesFor(CHANGELOG, '1.0')).toBeNull()
    expect(notesFor('## 1x0x0\n\n- Not it.', '1.0.0')).toBeNull()
  })

  it('an empty section counts as no entry', () => {
    expect(notesFor('## 1.0.0\n\n## 0.9.0\n\n- Old.', '1.0.0')).toBeNull()
  })
})
