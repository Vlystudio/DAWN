/**
 * voiceManager.ts — DAWN's local voice (TTS).
 *
 * Two fully-offline engines behind one interface:
 *   - **Piper** (preferred): high-quality neural TTS (resources/piper) — a calm,
 *     human, British "alan" voice. Main process synthesizes a WAV per sentence;
 *     we play it via an <audio> element. Cached by text+voice.
 *   - **Web Speech** (fallback): the OS SAPI voices (more robotic).
 *
 * Streaming sentence-by-sentence, instant interrupt, code/table skipping.
 * Original voice profile — no celebrity/character cloning.
 */

class VoiceManager {
  enabled = false;
  private s: any = {};
  private usePiper = false;
  private voices: SpeechSynthesisVoice[] = [];
  private queue: string[] = [];
  private buffer = '';
  private speaking = false;
  private currentAudio: HTMLAudioElement | null = null;

  init() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const load = () => { this.voices = window.speechSynthesis.getVoices(); };
      load();
      window.speechSynthesis.onvoiceschanged = load;
    }
    this.refresh();
  }

  async refresh() {
    try {
      this.s = await window.dawn.settings.get();
      this.enabled = !!this.s.voiceEnabled;
      if (!this.enabled) this.stop();
      const eng = this.s.voiceEngine || 'auto';
      if (eng === 'system') {
        this.usePiper = false;
      } else {
        const info = await window.dawn.voice.engine();
        // 'auto'/'kokoro'/'piper' -> use a neural engine (synth routed in main)
        this.usePiper = !!(info.kokoro || info.piper);
      }
    } catch {
      /* keep current */
    }
  }

  listVoices() {
    return this.voices.map((v) => ({ name: v.name, lang: v.lang }));
  }

  private clean(text: string): string {
    let t = text;
    if (!this.s.speakCodeBlocks) {
      t = t.replace(/```[\s\S]*?```/g, ' ');
      t = t.replace(/`[^`]+`/g, ' ');
    }
    t = t.replace(/^\s*\|.*\|\s*$/gm, ' ');
    t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    t = t.replace(/[#*_>~]/g, '');
    return t.replace(/\s+/g, ' ').trim();
  }

  speak(text: string) {
    if (!this.enabled) return;
    const c = this.clean(text);
    if (c) this.enqueue(c);
  }
  speakNow(text: string) {
    this.stop();
    const c = this.clean(text);
    if (c) this.enqueue(c);
  }

  feed(delta: string) {
    if (!this.enabled) return;
    this.buffer += delta;
    let m: RegExpMatchArray | null;
    while ((m = this.buffer.match(/^([\s\S]*?[.!?…\n])\s/))) {
      const sentence = m[1];
      this.buffer = this.buffer.slice(m[0].length);
      const c = this.clean(sentence);
      if (c) this.enqueue(c);
    }
  }
  flush() {
    if (!this.enabled) return;
    const c = this.clean(this.buffer);
    this.buffer = '';
    if (c) this.enqueue(c);
  }

  private enqueue(text: string) {
    this.queue.push(text);
    this.pump();
  }

  private pump() {
    if (this.speaking || !this.queue.length) return;
    const text = this.queue.shift()!;
    this.speaking = true;
    if (this.usePiper) this.piperPlay(text);
    else this.webSpeak(text);
  }

  private piperPlay(text: string) {
    window.dawn.voice
      .synth(text)
      .then((bytes: Uint8Array | null) => {
        if (!bytes || !bytes.length) {
          // Neural synth failed for this one sentence. Do NOT switch to the
          // robotic OS voice — that mid-stream voice change is jarring. The
          // main process already retried/restarted the engine; just move on so
          // the voice stays consistent.
          this.speaking = false;
          this.pump();
          return;
        }
        const blob = new Blob([bytes], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const a = new Audio(url);
        a.volume = this.s.voiceVolume ?? 1;
        this.currentAudio = a;
        const next = () => {
          URL.revokeObjectURL(url);
          if (this.currentAudio === a) this.currentAudio = null;
          this.speaking = false;
          this.pump();
        };
        a.onended = next;
        a.onerror = next;
        a.play().catch(next);
      })
      .catch(() => {
        this.speaking = false;
        this.pump();
      });
  }

  private webSpeak(text: string) {
    if (!window.speechSynthesis) {
      this.speaking = false;
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    const gb = this.voices.filter((v) => /en[-_]GB/i.test(v.lang));
    const male = gb.find((v) => /male|george|ryan|daniel|arthur/i.test(v.name));
    const chosen = this.s.voiceName ? this.voices.find((v) => v.name === this.s.voiceName) : null;
    const v = chosen || male || gb[0] || this.voices.find((x) => /^en/i.test(x.lang)) || this.voices[0];
    if (v) u.voice = v;
    u.rate = this.s.voiceRate ?? 0.98;
    u.pitch = this.s.voicePitch ?? 0.9;
    u.volume = this.s.voiceVolume ?? 1;
    u.onend = () => { this.speaking = false; this.pump(); };
    u.onerror = () => { this.speaking = false; this.pump(); };
    window.speechSynthesis.speak(u);
  }

  stop() {
    this.queue = [];
    this.buffer = '';
    this.speaking = false;
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.src = '';
      } catch {
        /* */
      }
      this.currentAudio = null;
    }
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* */
    }
  }
}

export const voice = new VoiceManager();
