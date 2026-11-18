#!/usr/bin/env bash
# Type check of the mod: tsc against the API types Claude Code lays out in .claude-plugin/types/.
#
# The engine puts them there (the folder is in .gitignore) only when it loads the mod in an interactive session
# (`claude --plugin-dir .`). A fresh checkout, a git worktree and a run of `claude -p` have none, and `tsc -p .`
# fails on `extends` of the root tsconfig.json. The script then lays them out itself, from files of the same
# Claude Code version as `claude --version`:
#   1. .claude-plugin/types/ of another worktree of this repository (the engine put them there);
#   2. claude-code.d.ts, which the engine writes when the plugin-authoring skill loads:
#      /tmp/claude-<uid>/bundled-skills/<version>/*/plugin-authoring/types/claude-code.d.ts
#      (the API, the built-in tools and 'claude-code/testing' in one file).
# With neither, the script says how to get them and exits with code 2. With only the types of another
# version, it checks against them and warns.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
types="$root/.claude-plugin/types"
api="$types/claude-code/index.d.ts"
version=$(claude --version | awk '{ print $1 }')
stamp="// Written by Claude Code $version."

# fresh FILE: the types file was written by this Claude Code version (its first line is the version's signature).
fresh() { [[ -f "$1" ]] && [[ "$(head -n 1 "$1")" == "$stamp" ]]; }

from_worktree() {
	local path
	while read -r path; do
		[[ "$path" == "$root" ]] && continue
		fresh "$path/.claude-plugin/types/claude-code/index.d.ts" || continue
		rm -rf "$types"
		cp -R "$path/.claude-plugin/types" "$types"
		echo "typecheck: Claude Code $version types from $path/.claude-plugin/types" >&2
		return 0
	done < <(git -C "$root" worktree list --porcelain | sed -n 's/^worktree //p')
	return 1
}

from_skill() {
	local src="" file
	for file in /tmp/claude-"$(id -u)"/bundled-skills/"$version"/*/plugin-authoring/types/claude-code.d.ts; do
		fresh "$file" || continue
		[[ -z "$src" || "$file" -nt "$src" ]] && src=$file
	done
	[[ -n "$src" ]] || return 1
	rm -rf "$types"
	mkdir -p "$types/claude-code"
	cp "$src" "$api"
	# The settings of the tsconfig.json the engine writes (2.1.326), except `types`: the engine also names the
	# packages claude-code-tools and claude-code-mcp there, but here the built-in tools sit in the same
	# claude-code.d.ts, the mod calls no MCP tools, and a package in `types` that is not on disk fails tsc. When the
	# engine changes its settings, compare with .claude-plugin/types/tsconfig.json laid out by `claude --plugin-dir .`.
	cat >"$types/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "jsx": "react",
    "jsxFactory": "h",
    "jsxFragmentFactory": "Fragment",
    "typeRoots": ["."],
    "types": ["claude-code"]
  },
  "include": ["../../hooks", "../../types", "../../tests"]
}
JSON
	echo "typecheck: Claude Code $version types from $src" >&2
}

if ! fresh "$api" && ! from_worktree && ! from_skill; then
	if [[ -f "$api" ]]; then
		written=$(head -n 1 "$api" | sed 's#^// Written by ##; s#\.$##')
		echo "typecheck: warning: the types in .claude-plugin/types are from $written, not Claude Code $version" >&2
	else
		cat >&2 <<EOF
typecheck: no Claude Code $version types. Get them one of these ways and run again:
  - load the plugin-authoring skill in any Claude Code $version session (/plugin-authoring);
  - load the mod in an interactive session: claude --plugin-dir $root
EOF
		exit 2
	fi
fi

exec npx -y -p typescript@5 tsc -p "$root"
