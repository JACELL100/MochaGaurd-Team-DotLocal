/**
 * Web Audio API synthesizer for the 2 AM Emergency Alert Sentinel.
 * Produces a high-priority, urgent alert chime inspired by emergency delivery dispatch sirens (Blinkit/Rapido).
 * Zero external MP3 dependencies; synthesized in browser memory.
 */

class SoundSynthesizer {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * Plays a high-urgency alternating two-tone siren (880Hz / 1174Hz) with rapid decay pulses.
   * Volume ranges from 0.0 to 1.0.
   */
  public playEmergencySiren(volume = 0.8): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(Math.min(1.0, Math.max(0.05, volume)), now);
    masterGain.connect(ctx.destination);

    // Play 3 rapid bursts of dual-tone pulses
    const bursts = [0, 0.28, 0.56, 0.84];

    bursts.forEach((startOffset) => {
      const burstTime = now + startOffset;

      // Primary tone (A5 = 880 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sawtooth";
      osc1.frequency.setValueAtTime(880, burstTime);
      osc1.frequency.exponentialRampToValueAtTime(1174.66, burstTime + 0.12); // Ramp to D6

      gain1.gain.setValueAtTime(0.35, burstTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, burstTime + 0.24);

      osc1.connect(gain1);
      gain1.connect(masterGain);

      osc1.start(burstTime);
      osc1.stop(burstTime + 0.25);

      // Harmonizing second tone (E6 = 1318.5 Hz) for extra acoustic penetration
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(1318.5, burstTime);
      osc2.frequency.setValueAtTime(1760, burstTime + 0.12); // A6 overtone

      gain2.gain.setValueAtTime(0.25, burstTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, burstTime + 0.24);

      osc2.connect(gain2);
      gain2.connect(masterGain);

      osc2.start(burstTime);
      osc2.stop(burstTime + 0.25);
    });
  }

  /**
   * Plays a subtle confirmation chime.
   */
  public playConfirmationChime(volume = 0.5): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

    gain.gain.setValueAtTime(volume * 0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.36);
  }
}

export const alertSound = new SoundSynthesizer();
