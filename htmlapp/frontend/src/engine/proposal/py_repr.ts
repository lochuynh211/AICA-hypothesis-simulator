/**
 * Python `repr()` mirrors — the ONE shared implementation for every module
 * in this port that embeds a Python `{x!r}` f-string interpolation into a
 * validation/error message.
 *
 * WHY SHARED (deliberately breaking from this codebase's usual per-module-
 * copy convention for small Python-mirroring helpers — see `pyFloatRepr`'s
 * own doc comment in `world_validation.ts`, and the copies in
 * `data/packages/builtin/aica_transparent_service_selector_v1.ts` /
 * `engine/services/feedback.ts`): that convention is safe for a genuinely
 * independent one-liner where every copy is trivially reviewable in place.
 * It was NOT safe for this one. `world_validation.ts` originally had a
 * naive always-single-quote `pyReprStr`, got a real bug fix
 * (double-quoting when a string contains `'` and no `"` — found via
 * `GenreLiteral`'s `"children's music"` member), and that fix landed at
 * exactly ONE of the four call sites doing the identical operation across
 * `world_validation.ts` and `world_overrides.ts` — the other three kept
 * silently diverging from real Python for any apostrophe-bearing value
 * (C2 follow-up wave, item 1). Importing one function from here removes
 * that whole class of "fixed it in one place, forgot the rest" bug — a
 * future fix here reaches every call site by construction, not by memory.
 *
 * Lives under `engine/proposal/` (not a more general `engine/` location)
 * because every current caller is a proposal-domain module
 * (`world_validation.ts`, `world_overrides.ts`) mirroring proposal-domain
 * Python (`services/world_validation.py`, `services/world_clone_store.py`,
 * `models/proposal/world.py`) — nothing outside that domain needs it today.
 * A future caller elsewhere is free to import it too; nothing here is
 * proposal-specific.
 *
 * Python's `repr()` quote-picking rule for `str` (verified against a real
 * `python3` interpreter, not inferred — see the C2 follow-up report for the
 * full transcript — five cases, run via `python3 -c`):
 *   1. plain string, no quotes at all            -> repr(plain)      = 'plain'
 *   2. contains `'` only                          -> repr(it's)       = "it's"   (double-quoted)
 *   3. contains `"` only                          -> repr(he said "hi") = 'he said "hi"'  (single-quoted)
 *   4. contains BOTH `'` and `"`                  -> repr(it's "both") = 'it\'s "both"'  (single-quoted,
 *      the apostrophe backslash-escaped, the double quote left bare — the
 *      double-quote exception only fires when the string has an apostrophe
 *      and NO double quote; a string with both still single-quotes, which
 *      is the "not the same as when it contains only one" case the C2
 *      brief specifically warned not to infer)
 *   5. contains a backslash                       -> repr(back\slash) = 'back\\slash'
 *      (backslash is always escaped, regardless of which quote character
 *      the rule above picks)
 */
export function pyReprQuoteOne(v: string): string {
  if (v.includes("'") && !v.includes('"')) return `"${v}"`
  return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/**
 * Mirrors Python's `repr()` of a `str, Enum` member — e.g.
 * `repr(ServiceId.music_playlist) == "<ServiceId.music_playlist: 'music_playlist'>"`.
 * A DIFFERENT shape from a plain string repr, verified directly against
 * this repo's real `ServiceId` + pydantic stack (not assumed identical to
 * `pyReprQuoteOne`'s output): the `<ClassName.member_name: ` prefix and the
 * trailing `>` are never quoted (a Python attribute name cannot itself
 * contain a quote or backslash), and only the VALUE portion after the colon
 * goes through the same quote-picking rule as a plain string repr —
 * confirmed with a throwaway `str, Enum` whose VALUE (not member name)
 * carries an apostrophe: `repr(Foo.apos) == '<Foo.apos: "it\'s">'`.
 *
 * Every `str, Enum` this port's Python source (`models/proposal/enums.py`)
 * embeds in an error message this way declares `member_name = "member_name"`
 * (the value verbatim equals the member name — e.g. every one of
 * `ServiceId`'s 14 members), so `member` here doubles as both the attribute
 * name and the value; there is no currently-reachable case where they
 * differ.
 */
export function pyReprEnumMember(className: string, member: string): string {
  return `<${className}.${member}: ${pyReprQuoteOne(member)}>`
}
