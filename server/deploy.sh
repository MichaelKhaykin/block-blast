#!/usr/bin/env bash
# One-shot deploy for the Block Blast leaderboard Worker.
# Run AFTER `npx wrangler login`. Safe to re-run.
set -e
cd "$(dirname "$0")"

if grep -q PLACEHOLDER_KV_ID wrangler.toml; then
  echo "→ Creating KV namespace 'SCORES'…"
  OUT=$(npx --yes wrangler kv namespace create SCORES 2>&1)
  echo "$OUT"
  ID=$(echo "$OUT" | grep -oiE '[a-f0-9]{32}' | head -1)
  if [ -z "$ID" ]; then
    echo "!! Could not auto-detect the KV id from the output above."
    echo "   Copy the id and paste it over PLACEHOLDER_KV_ID in server/wrangler.toml, then run: npx wrangler deploy"
    exit 1
  fi
  echo "→ KV id: $ID"
  sed -i '' "s/PLACEHOLDER_KV_ID/$ID/" wrangler.toml
fi

echo "→ Deploying Worker…"
npx --yes wrangler deploy
echo ""
echo "✅ Done. Copy the https://…workers.dev URL printed above and paste it back to me."
