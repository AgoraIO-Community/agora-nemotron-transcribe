# Verification · 29 October 2026

- `pnpm run verify`: passed (doctor, lint, TypeScript, 26 tests, production build).
- A real Agora host session was accepted by the server start API and stopped successfully; the App Certificate was not printed or returned.
- Runtime logs also showed recorded attempts reaching evaluation during local use. An audible Hindi roundtrip was not independently verified by the assistant.
- Browser inspected at desktop 1280×720 and phone 390×844 / 390×600. Document scroll dimensions matched viewport dimensions. The long ninth phrase was visually checked at 390×600.
- Tested contracts include Hindi Unicode alignment, omissions/substitutions/extras, deterministic scores, speed-bonus threshold, best-attempt summary, guarded uploads, actual token expiry decoding, session-stop capability, inference response errors, target-prompt isolation and AudioWorklet final-frame flushing.
- The optional self-hosted model service is not running at `127.0.0.1:8000`. The active provider is now the real free Hugging Face Space (see below). Hindi ASR quality, word timestamps and all-ten-round spoken feedback remain unverified.
- The readiness check rejects unreachable providers before opening a host session. For the free Space, API availability cannot verify remaining quota or reserve GPU time. Mock inference exists only inside contract tests; it is not a gameplay fallback.
- GPU setup scripts follow the linked NVIDIA model documentation and have not been executed on GPU hardware here.
- Docker packaging files are supplied; no Docker image build was run here.
- Original source checkout and destination Git origin were preserved. No commit, push or deployment was performed.

## Hindi/English update

- English lobby, language selection, challenge preview (including the long Peter Piper round), rules and official logo rendering were verified in the browser at 1280×720; document dimensions matched the viewport. The browser viewport override did not take effect in this run, so the new English layout has not been independently checked at phone dimensions. Earlier phone checks above cover the original Hindi version.
- Added tests for all ten English targets, case-insensitive scoring, cross-language mismatch, English host instructions, neutral English inference prompts and invalid language rejection. All 26 tests passed with lint, types and production build.
- Actual English host audio and NVIDIA GPU inference remain unverified. The official NVIDIA artwork retains its paths and colors; only excess empty artboard margins were trimmed for display.

## Free Hugging Face provider

- Actual public Gradio API inspected: `/gradio_api/info`, `/upload`, `/call/transcribe` and final SSE response. Exact model ID verified in the Space’s public source.
- Live 15-second bundled speech sample transcribed through `pnpm run smoke:inference` in **12.4 seconds**, including remote handling.
- Production `/api/readiness`: HTTP 200 with `provider: hf-space`.
- Production `/api/evaluate?level=0&language=en&seconds=4`: real four-second sample returned “The birch canoe slid on the smooth planks.” in **9.735 seconds**, word match/score 0 against the unrelated first English twister. This confirms real provider-to-scoring integration; it is a connectivity test, not a player attempt or model quality benchmark.
- 26 tests, lint, TypeScript and production build passed. Free-provider contracts cover chunked Unicode SSE, final-output-only parsing, empty/truncated responses, quota failure, cancellation, prompt isolation and provider readiness. No paid fallback exists.
- Browser checked the refreshed English interface and free GPU/queue/quota notice. Complete Hindi/English microphone gameplay with the live Agora host remains a separate manual check.
- No credentials were exposed, no paid inference was selected, no account was created, and no deployment or Git push was performed. Anonymous usage is shared by server identity and may be depleted by tests and players.
