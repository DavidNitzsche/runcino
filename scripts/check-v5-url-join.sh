#!/usr/bin/env bash
#
# scripts/check-v5-url-join.sh · A PATH CONCATENATED ONTO A BASE URL CARRIES ITS
# OWN LEADING SLASH.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT IT IS FOR
#
# `API.baseURL` is `https://www.faff.run` — no trailing slash — and
# `DesignV5/APIV5.swift` builds most of its URLs by STRING CONCATENATION onto
# `baseURL.absoluteString` rather than by `appendingPathComponent`. That is a
# deliberate choice (`v5`'s own doc comment explains it: `appendingPathComponent`
# percent-encodes a query string), and it has exactly one obligation: the path
# must start with "/".
#
# Two call sites forgot, both of them on the proposal surface, and both were
# invisible:
#
#   answerProposal   "api/plan/workout-proposals/6/accept"
#                    → https://www.faff.runapi/plan/workout-proposals/6/accept
#                    A VALID URL naming a host that does not exist. The POST
#                    left the phone, failed DNS, and the caller's `try?` ate it.
#                    Against a local host the authority "127.0.0.1:3111api" is
#                    unparseable, `URL(string:)` answers nil, and the function
#                    returned false having sent nothing at all.
#                    THE ACCEPT AND LEAVE-IT BUTTONS NEVER SENT A REQUEST.
#
#   fetchDecisions   "api/v5/decisions" → the same shape. The decision history
#                    screen drew its outage state on every open, which claims we
#                    went blind about a screen that was never asked.
#
# Neither is a type error, neither is a compile warning, and no test could see
# them: both failures are indistinguishable from "the server said no" at every
# layer above the transport. That is what Rule 20 means by a rule with no gate.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT THIS CANNOT FAIL ON (Rule 22)
#
# · A path that is WRONG but well separated. "/api/v5/decisons" passes here and
#   404s at runtime. This checks the JOIN, not the route.
# · `appendingPathComponent` call sites. Those insert their own separator and
#   are correct with or without a leading slash, so they are not examined.
# · A path built from a variable rather than a literal. It reports those as
#   UNCHECKED with the line number rather than passing them silently, because a
#   scanner that quietly skips what it cannot read is how a gate ends up
#   reporting clean on zero files (Rule 18).
# · A JOIN IDIOM OTHER THAN THESE TWO. `appendingPathComponent` call sites
#   insert their own separator and are correct either way, so they are not
#   examined; a third idiom introduced later would be invisible until this
#   list is extended.
# · Anything outside `native-v2/Faff/Faff`. The scope is every Swift file under
#   that tree that performs the join, discovered at run time rather than named,
#   so a new file is covered the day it starts concatenating.
#
# ─────────────────────────────────────────────────────────────────────────────
# FALSIFYING IT (Rule 18). Both directions have been run:
#
#   · delete a leading slash in APIV5.swift → guard 1 names the line, exit 1
#   · point FILE at a path that does not exist → guard 0 fails on zero files
#
set -uo pipefail
cd "$(dirname "$0")/.."

# ACCEPTVOICE-1 (2026-09-05) · SCOPE IS DISCOVERED, NOT HARDCODED.
#
# This named ONE file. `ViewsV5/RescheduleV5.swift:255` performs the identical
# `baseURL.absoluteString + "…"` concatenation and sat entirely outside the
# scan — so the exact defect this gate exists for could be reintroduced there
# and the gate would report OK. A gate whose scope is a literal filename is a
# gate that only covers the file somebody happened to be looking at.
#
# So the scope is now every Swift file that performs the join. A new file that
# starts concatenating is covered the day it does, with nothing to remember.
ROOT="native-v2/Faff/Faff"
fail=0

# ── guard 0 · LIVENESS ───────────────────────────────────────────────────────
# A scanner that reports clean because it read nothing is the worst outcome
# available, because it also reports confidence.
if [ ! -d "$ROOT" ]; then
  echo "check-v5-url-join: FAIL · $ROOT does not exist. This gate has moved or the"
  echo "  tree was renamed; either way it is scanning nothing and must not pass."
  exit 1
fi

FILES=$(grep -rlE 'baseURL\.absoluteString \+|await v5\("' "$ROOT" --include='*.swift' 2>/dev/null | sort || true)
if [ -z "$FILES" ]; then
  echo "check-v5-url-join: FAIL · found 0 files under $ROOT that concatenate onto"
  echo "  baseURL.absoluteString or call v5(). The predicate no longer matches the"
  echo "  code it was written against."
  exit 1
fi

joins=0
calls=0
for FILE in $FILES; do
  joins=$(( joins + $(grep -c 'baseURL\.absoluteString +' "$FILE" || true) ))
  calls=$(( calls + $(grep -cE 'await v5\("' "$FILE" || true) ))
done
if [ "$joins" -eq 0 ] && [ "$calls" -eq 0 ]; then
  echo "check-v5-url-join: FAIL · files matched but 0 concatenations and 0 v5() calls."
  exit 1
fi
echo "check-v5-url-join: scanning $(printf '%s\n' $FILES | wc -l | tr -d ' ') file(s) · ${joins} concatenation(s), ${calls} v5() call(s)"
printf '    %s\n' $FILES

# ── guard 1 · every concatenated literal starts with "/" ─────────────────────
#
# Matches   baseURL.absoluteString + "…"      (the direct form)
# and       v5("…"                            (the helper, which concatenates)
#
#
# TWO SHAPES, AND THE SECOND IS THE ONE THAT BIT.
#
# The literal can sit on the concatenation itself:
#
#     URL(string: API.baseURL.absoluteString + "/api/v5/plan-snapshot")
#
# or it can be bound one line above and concatenated by NAME, which is what
# `answerProposal` did:
#
#     let path = "api/plan/workout-proposals/\(id)/accept"
#     URL(string: API.baseURL.absoluteString + path)
#
# The first cut of this gate only matched the inline form. Falsified against the
# real defect it was written for, it reported OK — the exact "a gate that has
# never been made to fail is a hypothesis" outcome Rule 18 names, produced by
# the gate's own author in the same hour. So the second shape is resolved: for a
# concatenation by name, look back up to 12 lines for that name's binding and
# check the literal it was bound to.
#
for FILE in $FILES; do
while IFS= read -r hit; do
  line="${hit%%:*}"
  text="${hit#*:}"
  lit=$(printf '%s' "$text" | sed -n 's/.*baseURL\.absoluteString + "\([^"]*\).*/\1/p')
  src="inline"
  if [ -z "$lit" ]; then
    name=$(printf '%s' "$text" | sed -n 's/.*baseURL\.absoluteString + \([A-Za-z_][A-Za-z0-9_]*\).*/\1/p')
    if [ -n "$name" ]; then
      from=$(( line > 12 ? line - 12 : 1 ))
      lit=$(sed -n "${from},${line}p" "$FILE" \
        | grep -E "(let|var)[[:space:]]+$name[[:space:]]*=[[:space:]]*\"" \
        | tail -1 | sed -n 's/.*=[[:space:]]*"\([^"]*\).*/\1/p')
      src="bound as \`$name\`"
    fi
  fi
  if [ -z "$lit" ]; then
    echo "  UNCHECKED $FILE:$line · concatenates a path this gate cannot resolve to a"
    echo "      literal. Read it by hand, or bind it to a \`let\` on a nearby line."
    echo "      $(printf '%s' "$text" | sed 's/^[[:space:]]*//')"
    continue
  fi
  case "$lit" in
    /*) ;;
    *)
      echo "  FAIL $FILE:$line · path \"$lit\" ($src) has no leading slash."
      echo "      baseURL carries no trailing slash, so this builds"
      echo "      https://www.faff.run$lit — a host that does not exist."
      fail=1
      ;;
  esac
done < <(grep -nE 'baseURL\.absoluteString \+ ("|[A-Za-z_])' "$FILE" || true)

while IFS= read -r hit; do
  line="${hit%%:*}"
  text="${hit#*:}"
  lit=$(printf '%s' "$text" | sed -n 's/.*await v5("\([^"]*\).*/\1/p')
  if [ -z "$lit" ]; then
    echo "  UNCHECKED $FILE:$line · v5() called with a non-literal path"
    continue
  fi
  case "$lit" in
    /*) ;;
    *)
      echo "  FAIL $FILE:$line · v5(\"$lit\") has no leading slash."
      echo "      v5 concatenates onto baseURL.absoluteString; see its doc comment."
      fail=1
      ;;
  esac
done < <(grep -nE 'await v5\("' "$FILE" || true)
done

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "check-v5-url-join: FAIL"
  echo "  A path joined onto baseURL.absoluteString must start with \"/\"."
  echo "  Use appendingPathComponent instead only where there is no query string."
  exit 1
fi

echo "check-v5-url-join: OK"
