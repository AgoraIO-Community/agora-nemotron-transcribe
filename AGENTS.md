# Zubaan Race development guide

This is a solo Hindi/English tongue-twister game, adapted from the user-provided Agora Next.js agent quickstart. Read README.md and docs/source-map.md before modifying it.

## Boundaries

- Agora Conversational AI is the live host in the selected language. Preserve its source-derived SDK builder, RTM flags and session lifecycle.
- useJoin/usePublish/useLocalMicrophoneTrack own RTC join, publication and microphone cleanup. Never manually leave or close their tracks.
- Keep one ref-owned RTC client and the StrictMode readiness delay.
- Preserve combined RTC/RTM tokens, matching identities, one-hour **relative** expiration and renewal of both RTC/RTM.
- The agent's live STT is for conversation/commands; NVIDIA alone supplies the transcript used for game scoring.
- Never give NVIDIA the expected tongue twister in a prompt, context hint or request field.
- lib/game.ts owns scores. Host feedback gets GAME_RESULT/GAME_SUMMARY data and cannot invent scores or diagnose pronunciation.
- Record only the player's microphone. Host audio must not enter scored recordings.
- No friends, multiplayer, leaderboard or typing-based scoring. One player, ten twisters, optional retries.
- Keep each screen inside 100dvh without document scrolling. Use paging for result review.
- Never silently fake an inference result, host connection, elapsed time or word match.
- Keep App Certificate and model-provider credentials server-side; do not log them. Preserve ignored .env.local.

## Changes and checks

Run pnpm run verify. Tests with synthetic credentials or mocked providers prove contracts only. State real voice and GPU evidence separately. Update README and docs/source-map.md when responsibilities, environment keys or workflow changes. Do not commit, push or deploy without user authorization.

- Free inference uses only the fixed public Space origin in lib/hf-space.ts. Never route to paid inference automatically. HF_TOKEN stays server-side. Only final completed SSE output may be scored; quota/queue/incomplete failures receive no score. Do not claim readiness verifies free quota or that anonymous quota is per player.
