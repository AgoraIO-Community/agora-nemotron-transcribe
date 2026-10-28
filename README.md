# ज़ुबान रेस · Zubaan Race

**ज़ुबान फिसली, गेम गया!** Ten Hindi or English tongue twisters. One playful AI host. Your voice does the playing.

A solo, voice-first browser game built from the Agora Next.js agent quickstart. **Chulbul**, an Agora Conversational AI host, introduces each tongue twister, responds in your selected language, and talks through your final results. **NVIDIA Nemotron 3.5 Transcribe** checks the isolated recording of each attempt. A deterministic scoring engine computes word match and a speed bonus.

No friend rooms, multiplayer, account system, or leaderboard. No fake inference results. All screens fit the viewport; the results review uses previous/next controls instead of scrolling.

## Play

The app checks the selected NVIDIA provider before opening an Agora host session. In free Hugging Face mode this checks API availability, not remaining GPU quota. Agora usage remains subject to your own project’s plan.

1. Allow your attempts to be processed, select **माइक ऑन, गेम ऑन!**, and grant microphone access.
2. Tell Chulbul **शुरू करो**.
3. Listen to the phrase. When **तुम्हारी बारी** appears, say it.
4. About a second of silence ends the recording automatically. Only the player microphone goes to Nemotron, not host audio.
5. Hear feedback and say **दोबारा**, **दोहराओ**, or **अगला**. Buttons provide an accessible fallback.
6. After ten phrases, talk to Chulbul about the measured results, review individual rounds, replay your best attempts, and download a score card.

Microphone permission and the first Start action require browser interaction; after that, progression is voice controlled. Use headphones and a quiet room. The speech detector has a 27-second attempt limit. There is no countdown that penalizes GPU processing time.

## Quick start

### Requirements

- Node.js 22 or newer; pnpm (the lockfile is included).
- An Agora project with RTC, RTM and Conversational AI enabled, an App Certificate, and access to the configured managed providers.
- The default **free Hugging Face ZeroGPU Space**, or your own NeMo Speech + vLLM deployment of `nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B`.
- Chrome or Edge recommended. HTTPS is required away from localhost.

The host uses Agora-managed Deepgram Nova-3 Hindi/English ASR, OpenAI GPT-4o-mini, and MiniMax TTS. These services must be available to your Agora project and may incur usage charges. This does not configure Nemotron as native streaming STT inside Agora. Nemotron evaluates completed attempts separately.

### 1. Install Agora Skills and CLI

```bash
npx skills add github:AgoraIO/skills
curl -fsSL https://dl.agora.io/cli/install.sh | sh
agora version
agora doctor --json
agora login
```

On Windows, use the [official CLI PowerShell installer](https://github.com/AgoraIO/cli).

### 2. Clone this demo and configure the existing project

```bash
git clone https://github.com/AgoraIO-Community/agora-nemotron-transcribe.git
cd agora-nemotron-transcribe
pnpm install --frozen-lockfile
cp env.local.example .env.local
agora quickstart env write . --template nextjs --scenario voice-agent --project YOUR_PROJECT
```

The CLI writes `NEXT_PUBLIC_AGORA_APP_ID` and server-only `NEXT_AGORA_APP_CERTIFICATE`. Use an existing enabled project. Do not initialize the ordinary quickstart over this game checkout: that would give you the unmodified starter.

If CLI authentication or project access is unavailable, populate those two keys in `.env.local` from your own project. Never put the certificate in a public environment variable or commit the file.

### 3. Use free NVIDIA inference (default)

The demo calls the public `/transcribe` API of [hugging-apps/nemotron-3-5-transcribe](https://huggingface.co/spaces/hugging-apps/nemotron-3-5-transcribe), which runs the exact NVIDIA model on ZeroGPU. No local GPU, SSH tunnel, DeepInfra subscription or model download is needed. Set:

```dotenv
NEMOTRON_PROVIDER=hf-space
# Optional server-side token from your free Hugging Face account:
HF_TOKEN=
```

Without a token, requests use the web server’s shared anonymous allowance. An optional token uses the corresponding account quota; keep it in `.env.local`, never a `NEXT_PUBLIC_` variable. Use a free account for the no-cost route. This integration has no paid-provider fallback and never purchases credits.

[ZeroGPU’s current limits](https://huggingface.co/docs/hub/spaces-zerogpu) are 2 minutes/day for anonymous users and 5 minutes/day for free accounts. This Space uses `xlarge`, which costs **2× quota**; GPU allowance is not audio duration, and all players using one server identity share its quota. Queues, quota exhaustion and upstream changes can interrupt a run. This is suitable for limited community testing, not unlimited public traffic. Hosting a duplicate Space has its own account eligibility requirements.

Recordings are uploaded to the public Space for inference; its upload and retention behavior is controlled by its operator. The adapter waits for the final completed response, strips the Space’s processing metrics, rejects incomplete/truncated output, and reports quota failures without assigning a score. The Space does not return word timestamps; scoring still uses transcript differences and locally measured speaking time.

Only neutral language/style instructions go to NVIDIA. Expected tongue twisters never go into its prompt. `pnpm run smoke:inference` sends the attributed sample through whichever provider you selected.

### Optional: self-host NVIDIA inference

Set `NEMOTRON_PROVIDER=vllm` to use the original GPU server path instead:


The checked-in scripts follow NVIDIA's published BF16 H100 80 GB setup. Run them **on a suitable Linux GPU host**, not a normal laptop:

```bash
bash inference/setup.sh
bash inference/serve.sh
```

The setup downloads a large model and installs NeMo Speech with its vLLM extra. Install [uv](https://docs.astral.sh/uv/) and compatible NVIDIA drivers first. Set `NEMO_REF` to an audited NeMo Speech commit for a reproducible deployment. The setup records the checked-out commit in ignored `inference/runtime/nemo-commit.txt`.

The server binds to loopback. From the laptop running Next.js:

```bash
ssh -N -L 8000:127.0.0.1:8000 YOUR_USER@YOUR_GPU_HOST
```

Set in `.env.local`:

```dotenv
NEMOTRON_BASE_URL=http://127.0.0.1:8000/v1
NEMOTRON_MODEL=nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B
# Optional if your server requires Bearer authentication:
NEMOTRON_API_KEY=
# Optional host voice override; default is a documented Hindi system voice:
AGORA_HOST_VOICE=hindi_female_1_v2
```

An SSH tunnel to your laptop does not make inference reachable from a deployed web server. For deployment, configure a private network path or an authenticated HTTPS inference endpoint reachable from that server.

Timestamp capture requires the NeMo CTC middleware and V1 model runner, enabled in `inference/serve.sh`. DFlash2's V2 runner does not support this alignment path. Plain transcript scoring can still succeed if optional alignment is unavailable.

Use the [NVIDIA model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B) as the source of truth for compatible hardware and changing inference dependencies. The self-hosting scripts have not been GPU-qualified in this repository's current verification environment.

### 4. Start the game

```bash
pnpm run doctor
pnpm dev
```

Open the Local URL printed by Next.js. **पहले चुनौतियाँ देखूँ** lets you inspect the ten phrases without a microphone or provider call. It does not generate scores or simulate an agent.

Restart Next.js after environment changes. To test only the inference connection, send the attributed English sample with:

```bash
pnpm run smoke:inference
```

That sample checks connectivity, not Hindi accuracy. Actual tongue-twister evaluation requires your recorded Hindi attempt.

## Scoring and fairness

- Normalize Unicode to NFC; ignore punctuation and invisible joiners. Preserve Hindi vowel marks, spelling, repeated words, and word order.
- Word-level Levenshtein alignment identifies substitutions, omissions and extra words.
- `word match = max(0, round(100 × (1 − edit distance / expected word count)))`.
- Accuracy points: `word match × 8`, maximum 800.
- Speed bonus: only at 90% word match or better, `round(200 × min(1, target seconds / attempt seconds))`.
- Up to 1,000 points per level and 10,000 per run. Retries keep your highest-scoring attempt per level.
- Speaking time is measured locally from detected speech onset to last detected speech, including pauses within the utterance. Network and inference waiting are excluded.
- The server validates the uploaded audio and bounds client timing against clip duration. This is a casual local game, not a tamper-proof competitive ranking system.

**A transcript match is not verified pronunciation accuracy.** An ASR model can mishear a correct attempt or reconstruct an incorrect one. The target phrase is never passed to Nemotron as a transcription hint. Results retain the recognised transcript, alignment and recorded replay so a player can inspect discrepancies. Chulbul is instructed to discuss measured word differences, not diagnose articulation, accents or medical issues.

## Architecture

```text
Browser ── combined RTC/RTM token ── Next.js
   │
   ├── Agora RTC: player microphone ↔ Hindi/English-speaking AI host
   ├── Agora RTM + Toolkit: commands, live captions, host state
   └── player-only AudioWorklet recording + local speech detection
                 │
                 ▼
       POST /api/evaluate?level=...
       bounded raw WAV → free HF Space OR self-hosted NVIDIA chat-completions
                 │
                 ▼
       Hindi transcript → deterministic word comparison
                 │
                 ▼
       screen feedback + trusted GAME_RESULT context to host
```

The agent's live ASR is used for conversation and voice commands. It never supplies the score. Nemotron gets completed attempts; it is not a live streaming recognizer. The host receives computed results after evaluation and can discuss the whole run at the end.

### Source reuse

This derivative uses the requested local `agent-quickstart-nextjs` checkout. Its family/AssemblyAI customization is not part of this game. The combined token builder, provider builder, StrictMode guard, RTC hook ownership, parallel agent/RTM startup, partial-failure cleanup, Toolkit events and token renewals are adapted from the inspected source. See [the source map](docs/source-map.md).

### Key files

| File                                 | Responsibility                                             |
| ------------------------------------ | ---------------------------------------------------------- |
| `components/zubaan-game.tsx`         | Solo game states, voice commands, results and score card   |
| `components/agent-session.tsx`       | Agora RTC/RTM, Toolkit and microphone lifecycle            |
| `lib/game.ts`                        | Ten phrases, word alignment, scores and host instructions  |
| `lib/attempt-capture.ts`             | Player-only recording, speech detection and silence cutoff |
| `public/pcm-recorder.js`             | PCM AudioWorklet                                           |
| `app/api/invite-agent/route.ts`      | Start the Hindi host through Agora Agents SDK              |
| `app/api/stop-conversation/route.ts` | Stop with a signed session capability                      |
| `app/api/evaluate/route.ts`          | Validate attempt, call NVIDIA, calculate word match        |
| `lib/nemotron.ts`                    | Provider selection, NeMo/vLLM request and alignment parsing |
| `lib/hf-space.ts` | Free Space upload, queue, final-response parsing and quota errors |
| `inference/`                         | GPU setup and serving scripts                              |

## Verification

```bash
pnpm run verify
```

This checks local prerequisites, lint, types, contract/scoring tests and a production build. Offline tests use explicit mocked inference responses; the application never silently switches to mock scores.

Before a public launch, separately verify real Hindi host speech, voice commands, interruption behavior, all ten recorded attempts against your GPU, retry and replay, host review, and page-close cleanup. An HTTP response, signed token or accepted agent-start request does not establish an audible roundtrip.

## Deployment and limits

A Node.js host or the included Docker image serves the web app. The model runs on the selected remote GPU provider. The demo has no app-side recording storage and does not write attempts to disk. The Hugging Face Space receives uploaded recordings, and your inference provider has its own logging and retention behavior.

The browser-facing start/token/evaluation routes do not implement user accounts, durable quotas or abuse prevention. Before operating an unrestricted public service, add authentication or session gating, host/inference concurrency controls, rate limits and spend limits. Stop capabilities prevent arbitrary callers from stopping other agent IDs, but do not replace application authentication.

Other limits: Hindi names/spelling variants can produce false differences; local voice detection is sensitive to noise; Hindi TTS/provider access depends on account availability; very short displays can truncate long captions while spoken audio continues. Browser autoplay may need the player's initial click. Use the visible fallback buttons if voice recognition misses a command.

## References

- [Agora Skills](https://github.com/AgoraIO/skills)
- [Agora CLI](https://github.com/AgoraIO/cli)
- [Agora Next.js agent quickstart](https://github.com/AgoraIO-Conversational-AI/agent-quickstart-nextjs)
- [NVIDIA model card and serving setup](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B)
- [NVIDIA Nemotron Transcribe and Granary v2 introduction](https://huggingface.co/blog/nvidia/nemotron-transcribe-granary)
- [Deepgram language support](https://developers.deepgram.com/docs/models-languages-overview/)
- [MiniMax official voice catalog](https://github.com/MiniMax-AI/skills/blob/main/skills/frontend-dev/references/minimax-voice-catalog.md)

Code: MIT; see LICENSE. The original cartoon microphone is generated as SVG in this repository's UI code. Optional connectivity-test audio is attributed in [samples/README.md](samples/README.md). NVIDIA model weights have their own license and are not included.

## Language selection and official logos

Choose **हिंदी / English** at the top right before starting. Each language has ten distinct tongue twisters. The switch updates interface copy, preview, host greeting/instructions, Deepgram language, MiniMax voice, neutral NVIDIA transcription instruction, scored targets, results and score-card headline. During an active session, exit before switching languages so recordings and scores cannot mix. Hindi remains the default. English voice commands: **start**, **repeat**, **try again**, **next**, **stop**.

English uses MiniMax `English_Aussie_Bloke`; Hindi uses `hindi_female_1_v2`. Override with `AGORA_HOST_VOICE_EN` and `AGORA_HOST_VOICE_HI`; the existing `AGORA_HOST_VOICE` remains a Hindi fallback. Both defaults are listed in the [official MiniMax voice catalog](https://github.com/MiniMax-AI/skills/blob/main/skills/frontend-dev/references/minimax-voice-catalog.md).

The footer uses the official Agora RGB blue SVG from the supplied quickstart and the official horizontal NVIDIA SVG (only empty artboard margins trimmed; logo paths and colors unchanged) from [NVIDIA’s logo guidelines](https://www.nvidia.com/en-us/about-nvidia/legal-info/logo-brand-usage/). The NVIDIA logo links to the exact Nemotron 3.5 Transcribe model card. Logos remain the property of their respective owners.

Free-provider implementation was checked against the Space’s public API schema and [app.py](https://huggingface.co/spaces/hugging-apps/nemotron-3-5-transcribe/blob/main/app.py). A real 15-second sample completed through the application adapter in 12.4 seconds on 29 October 2026. This is a single observed result, not a latency guarantee.
