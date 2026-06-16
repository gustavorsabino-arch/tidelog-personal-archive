import { describe, it, expect } from 'bun:test'
import { matchTeamMember } from './match-team-member'

const roster = [
  { name: 'Bradley Chong (Hafu Design Inc)', department: 'Product', status: 'active' },
  { name: 'Mike Yoo (Mikey)', department: 'Product', status: 'active' },
  { name: 'Amina Ben Salem', department: 'Ops', status: 'active' },
  { name: 'Otto Carpenter', department: 'Engineering', status: 'active' },
  { name: 'Gone Person', department: 'Ops', status: 'inactive' },
]

describe('matchTeamMember', () => {
  it('matches "First L." to full name', () => {
    expect(matchTeamMember('Bradley C.', roster)?.name).toBe('Bradley Chong (Hafu Design Inc)')
  })
  it('matches "First Last" exactly', () => {
    expect(matchTeamMember('Amina Ben Salem', roster)?.department).toBe('Ops')
  })
  it('strips a "(2)" suffix on the label', () => {
    expect(matchTeamMember('Otto C. (2)', roster)?.name).toBe('Otto Carpenter')
  })
  it('ignores inactive members', () => {
    expect(matchTeamMember('Gone P.', roster)).toBeNull()
  })
  it('returns null for an unknown label', () => {
    expect(matchTeamMember('Random Vendor Inc', roster)).toBeNull()
  })
  // Alias map: "mike y." is in _teamAliases → 'Mike Yoo (Mikey)' which is in roster
  it('matches via alias exact key', () => {
    expect(matchTeamMember('mike y.', roster)?.name).toBe('Mike Yoo (Mikey)')
  })
  // Exact real name (strips parenthetical)
  it('matches real name without parenthetical', () => {
    expect(matchTeamMember('Otto Carpenter', roster)?.name).toBe('Otto Carpenter')
  })
  // First+last contained
  it('matches when label contains first and last name', () => {
    expect(matchTeamMember('Amina Salem', roster)?.name).toBe('Amina Ben Salem')
  })
  // Nickname match: "Mikey" is nickname for Mike Yoo
  it('matches via nickname prefix', () => {
    expect(matchTeamMember('Mikey', roster)?.name).toBe('Mike Yoo (Mikey)')
  })
})
