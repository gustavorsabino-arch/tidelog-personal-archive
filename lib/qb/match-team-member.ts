export type RosterMember = { name: string; department: string; status: string }

// Verbatim port of V1's _teamAliases (keys are lowercase)
const _teamAliases: Record<string, string> = {
  'will t.': 'Will Thieme',       // Will = Wilhelm
  'wilhem': 'Will Thieme',
  'wilhelm': 'Will Thieme',
  'mike y.': 'Mike Yoo (Mikey)',  // Mike Yoo = Won Sang Yoo
  'won sang': 'Mike Yoo (Mikey)',
  'won sang yoo': 'Mike Yoo (Mikey)',
  'jose p.': 'Jose Preciado Perez', // José Preciado
  'josé p.': 'Jose Preciado Perez',
  'josé preciado': 'Jose Preciado Perez',
  'josh g.': 'Josh Guha',         // Abhinaba Guha
  'abhinaba': 'Josh Guha',
  'abhinaba guha': 'Josh Guha',
}

/**
 * Pure port of V1's _matchTeamMember function.
 *
 * Matching strategies (in order):
 *  1. Alias exact match
 *  2. Alias prefix match (lbl starts with alias key minus trailing dot)
 *  3. For each active member:
 *     a. Exact full name or real name (no parenthetical)
 *     b. First + last both contained in label
 *     c. "First L." / "First L" pattern
 *     d. Nickname prefix match, or "Nickname L." pattern
 *     e. Unique first-name match (length guard ≤ first + 4 chars)
 *     f. Unique nickname match (length guard ≤ nickname + 4 chars)
 */
export function matchTeamMember(label: string, roster: RosterMember[]): RosterMember | null {
  if (!label || label.length < 3 || !roster?.length) return null

  // Normalize: lowercase, strip trailing "(N)" suffix, trim
  const lbl = label.toLowerCase().replace(/\s*\(\d+\)\s*$/, '').trim()

  const active = roster.filter(t => t.status === 'active')

  // 1. Alias exact match
  const aliasTarget = _teamAliases[lbl]
  if (aliasTarget) {
    const found = active.find(t => t.name === aliasTarget)
    if (found) return found
  }

  // 2. Alias prefix match
  for (const [alias, target] of Object.entries(_teamAliases)) {
    if (lbl.startsWith(alias.replace(/\.$/, '')) && lbl.length <= alias.length + 2) {
      const found = active.find(t => t.name === target)
      if (found) return found
    }
  }

  // 3. Per-member strategies
  for (const tm of active) {
    const fullLower = tm.name.toLowerCase()
    // Real name: strip parenthetical
    const realName = tm.name.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase()
    // Nickname: text inside first parentheses
    const nickMatch = tm.name.match(/\(([^)]+)\)/)
    const nickname = nickMatch ? nickMatch[1].trim().toLowerCase() : ''
    const parts = realName.split(/[\s-]+/)
    const first = parts[0] || ''
    const last = parts[parts.length - 1] || ''

    // a. Exact full name or real name
    if (lbl === fullLower || lbl === realName) return tm

    // b. First + last both contained in label
    if (lbl.includes(first) && lbl.includes(last)) return tm

    // c. "First L." pattern (with or without dot)
    if (first.length > 2 && last.length > 0) {
      const lastInitial = last[0]
      const pat1 = first + ' ' + lastInitial + '.'
      const pat2 = first + ' ' + lastInitial
      if (
        lbl === pat1 ||
        lbl === pat2 ||
        lbl.startsWith(pat1) ||
        (lbl.startsWith(pat2) && lbl.length <= pat2.length + 1)
      ) return tm
    }

    // d. Nickname match
    if (nickname && nickname.length > 3) {
      // Nickname prefix
      if (lbl.startsWith(nickname)) return tm
      // "Nickname L." pattern using real last name
      if (last.length > 0) {
        const nickPat1 = nickname + ' ' + last[0] + '.'
        const nickPat2 = nickname + ' ' + last[0]
        if (
          lbl === nickPat1 ||
          lbl === nickPat2 ||
          lbl.startsWith(nickPat1) ||
          (lbl.startsWith(nickPat2) && lbl.length <= nickPat2.length + 1)
        ) return tm
      }
    }

    // e. Unique first-name match
    if (first.length >= 4 && lbl.startsWith(first) && lbl.length <= first.length + 4) {
      const sameFirst = active.filter(t =>
        t.name.replace(/\s*\(.*?\)/g, '').trim().toLowerCase().startsWith(first)
      )
      if (sameFirst.length === 1) return tm
    }

    // f. Unique nickname match
    if (nickname && nickname.length >= 4 && lbl.startsWith(nickname) && lbl.length <= nickname.length + 4) {
      return tm
    }
  }

  return null
}
