# Single agent core, cascaded voice pipeline

Status: Accepted; the Zendesk-specific ticket adapter is superseded for the
provider-limited delivery by ADR 0008

One Agent Core serves every channel. The Ticket channel (Zendesk API polling/webhooks) and the Voice Channel (browser audio over WebSocket) are thin I/O adapters; reasoning, tools, and escalation policy live in the shared core.

The Voice Channel is a **cascaded pipeline** — streaming STT → Agent Core → annotated reply text → ElevenLabs TTS — rather than a managed speech-to-speech platform. The deciding factor is Emotional Delivery, the demo's killer feature: the Agent Core classifies the Customer's emotional state per turn and annotates its own reply with inline audio tags (`[whispers]`, `[chuckles]`) that ElevenLabs v3 renders. With a managed platform (ElevenLabs Conversational AI, OpenAI Realtime) that behavior would be emergent rather than designed, and the voice brain would be split from the ticket brain.

## Considered Options

- ElevenLabs Conversational AI platform — rejected: splits the brain per channel; emotional delivery not directly controllable.
- OpenAI Realtime speech-to-speech — rejected: no ElevenLabs, third brain, least friendly to a one-shot build.

## Consequences

- Swapping STT or TTS vendors touches only the Voice Channel adapter, never the Agent Core.
- Emotional Delivery quality is testable at the text layer (annotation correctness) independently of audio rendering.
