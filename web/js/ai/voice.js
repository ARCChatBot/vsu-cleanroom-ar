// =====================================================================================
//  voice.js
//  MI-CHIPS (NSF #2606117): speech in/out through the browser's Web Speech API.
//  • Recognition: Chrome, Edge (desktop and HoloLens 2), Android Chrome. Safari partial,
//    Firefox none. The app also accepts typed questions, so voice is never required.
//  • Synthesis: reads the analyst's answers aloud (toggle in AI settings).
// =====================================================================================

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const voiceSupported = !!Recognition;

export class Voice {
  constructor({ onResult, onState }) {
    this.onResult = onResult;
    this.onState = onState;
    this.listening = false;
    this.handsFree = false;
    if (!Recognition) return;
    this.rec = new Recognition();
    this.rec.lang = 'en-US';
    this.rec.interimResults = true;
    this.rec.maxAlternatives = 1;
    this.rec.onresult = (e) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
      }
      if (interim) this.onState?.('listening', interim);
      if (final.trim()) this.onResult?.(final.trim());
    };
    this.rec.onerror = (e) => {
      this.onState?.('error', e.error === 'not-allowed' ? 'Microphone permission was denied.' : `Speech error: ${e.error}`);
    };
    this.rec.onend = () => {
      this.listening = false;
      if (this.handsFree) { try { this.rec.start(); this.listening = true; return; } catch { /* restart failed */ } }
      this.onState?.('idle');
    };
  }

  /** Start listening for one utterance (or continuously when handsFree). Must run from a user gesture. */
  start(handsFree = false) {
    if (!this.rec) { this.onState?.('error', 'Voice input is not supported in this browser. Type your question instead.'); return; }
    this.handsFree = handsFree;
    this.rec.continuous = handsFree;
    if (this.listening) return;
    speechSynthesis?.cancel();
    try { this.rec.start(); this.listening = true; this.onState?.('listening', ''); }
    catch (e) { this.onState?.('error', e.message); }
  }

  stop() {
    this.handsFree = false;
    if (this.rec && this.listening) this.rec.stop();
  }

  toggle() { this.listening ? this.stop() : this.start(false); }
}

export function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[*_#`>|]/g, ''));
  u.rate = 1.03;
  speechSynthesis.speak(u);
}

export function stopSpeaking() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }
