// =====================================================================================
//  aiPanel.js
//  MI-CHIPS (NSF #2606117): in-scene AI analyst panel. It works in AR, where there is
//  no page UI: talk, hands-free, explode all, stop speaking, and the latest exchange.
// =====================================================================================

import { CanvasPanel } from '../render/panel.js';
import { THEME, PALETTE } from '../render/chart.js';

export class AiPanel extends CanvasPanel {
  constructor(app) {
    super({ title: 'AI Analyst', width: 0.56, height: 0.4, closable: false });
    this.app = app;
    this.kind = 'ai';
    this.interactables = [this.mesh];
    this.state = 'idle';     // idle | listening | thinking | error
    this.heard = '';
    this.answer = 'Ask about the data by voice, for example: "Where is the hottest spot on the die?", "Is the gate CD process capable?", or "Explode the wafer map." Lost a view? Say "arrange" or double air-tap empty space.';
    this.mode = '';
  }

  set(fields) { Object.assign(this, fields); this.dirty = true; }

  draw(ctx) {
    const W = this.W, a = this.app;
    this.eyebrow('Operation SEMI / MI-CHIPS · voice analyst', 22, 78);

    // Status line with an indicator dot (ice blue while listening, orange while thinking)
    const dot = this.state === 'listening' ? PALETTE.iceBlue : this.state === 'thinking' ? PALETTE.orange : this.state === 'error' ? PALETTE.orange : PALETTE.labelSlate;
    ctx.fillStyle = dot; ctx.beginPath(); ctx.arc(32, 124, 8, 0, Math.PI * 2); ctx.fill();
    const status = { idle: a.aiReady() ? 'Ready: Claude connected' : 'Ready: local commands (connect AI in settings for analysis)', listening: 'Listening…', thinking: 'Analyzing…', error: 'Problem' }[this.state] || this.state;
    this.text(status + (this.mode ? `   ·   ${this.mode}` : ''), 50, 113, { size: 21, weight: 600, color: THEME.caption });

    let y = 152;
    if (this.heard) {
      this.text('You said', 22, y, { size: 17, color: THEME.eyebrow, weight: 700 });
      y = this.paragraph(`“${this.heard}”`, 22, y + 24, W - 44, { size: 21, color: PALETTE.white, maxLines: 2 }) + 8;
    }
    ctx.fillStyle = PALETTE.orange; ctx.fillRect(22, y + 2, 34, 3);
    y = this.paragraph(this.answer, 22, y + 14, W - 44, { size: 21, color: THEME.muted, maxLines: this.heard ? 5 : 7 });

    const by = this.H - 66;
    let x = 22;
    x = this.button(a.listening() ? 'Stop' : 'Talk', x, by, 120, 48, () => a.toggleListening(), { active: a.listening(), primary: !a.listening() });
    x = this.button('Hands-free', x, by, 160, 48, () => a.toggleHandsFree(), { active: a.handsFree() });
    x = this.button(a.anyExploded() ? 'Collapse all' : 'Explode all', x, by, 170, 48, () => a.execute({ type: 'explode', target: 'all', exploded: !a.anyExploded() }));
    this.button('Mute', x, by, 100, 48, () => a.stopSpeaking());
  }
}
