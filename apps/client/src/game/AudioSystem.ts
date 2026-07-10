export class AudioSystem {
  private context?: AudioContext;
  constructor(private volume = 0.75) {}

  private getContext(): AudioContext | undefined {
    if (typeof AudioContext === "undefined") return undefined;
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") void this.context.resume();
    return this.context;
  }

  playPunch(heavy = false): void {
    const context = this.getContext();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(heavy ? 105 : 155, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      45,
      context.currentTime + (heavy ? 0.15 : 0.08),
    );
    gain.gain.setValueAtTime(
      (heavy ? 0.16 : 0.09) * this.volume,
      context.currentTime,
    );
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      context.currentTime + (heavy ? 0.18 : 0.1),
    );
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.2);
  }

  playHit(parried: boolean): void {
    const context = this.getContext();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = parried ? "sine" : "square";
    oscillator.frequency.setValueAtTime(
      parried ? 880 : 92,
      context.currentTime,
    );
    oscillator.frequency.exponentialRampToValueAtTime(
      parried ? 1320 : 48,
      context.currentTime + 0.12,
    );
    gain.gain.setValueAtTime(
      (parried ? 0.08 : 0.055) * this.volume,
      context.currentTime,
    );
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.16);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.18);
  }

  playDash(): void {
    const context = this.getContext();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(180, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      55,
      context.currentTime + 0.13,
    );
    gain.gain.setValueAtTime(0.045 * this.volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.14);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.15);
  }

  playGuard(): void {
    const context = this.getContext();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(420, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      260,
      context.currentTime + 0.08,
    );
    gain.gain.setValueAtTime(0.025 * this.volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.1);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.11);
  }

  dispose(): void {
    void this.context?.close();
    this.context = undefined;
  }
}
