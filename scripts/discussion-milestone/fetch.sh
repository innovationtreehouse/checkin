#!/usr/bin/env bash
# Fetch a discussion as JSON for the planner. Everything here is untrusted text
# written by whoever can comment on a public repo, so it leaves as DATA on
# stdout — never interpolated into a shell command or a workflow expression.
#
# Author permission rides along per comment: `author_association` says "in the
# org", not "can write here", so the planner is told to trust neither and to
# treat only the maintainer allowlist as authority.
set -euo pipefail

NUM="${1:?usage: fetch.sh <discussion-number>}"
OWNER="${GITHUB_REPOSITORY%%/*}"
NAME="${GITHUB_REPOSITORY##*/}"

gh api graphql -f owner="$OWNER" -f name="$NAME" -F number="$NUM" -f query='
query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    discussion(number:$number){
      number title body locked
      category{name}
      author{login}
      labels(first:20){nodes{name}}
      comments(first:100){nodes{
        body createdAt authorAssociation author{login}
        replies(first:50){nodes{body createdAt authorAssociation author{login}}}
      }}
    }
  }
}' --jq '.data.repository.discussion'
