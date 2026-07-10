import { useEffect, useState } from "react";
import { defaultSettings, formatKey, rebindKey, type GameSettings, type KeyAction } from "./settings";

const actions: Array<{ action: KeyAction; label: string }> = [
  { action: "forward", label: "Vorwärts" }, { action: "back", label: "Rückwärts" },
  { action: "left", label: "Links" }, { action: "right", label: "Rechts" },
  { action: "jump", label: "Springen" }, { action: "dash", label: "Dash" }, { action: "block", label: "Block/Parade" },
];

export function SettingsPanel({ settings, onChange, onClose }: { settings: GameSettings; onChange: (settings: GameSettings) => void; onClose: () => void }) {
  const [listening, setListening] = useState<KeyAction | null>(null);
  useEffect(() => {
    if (!listening) return;
    const capture = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.code === "Escape") { setListening(null); return; }
      onChange({ ...settings, bindings: rebindKey(settings.bindings, listening, event.code) });
      setListening(null);
    };
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [listening, onChange, settings]);
  return <div className="settings-overlay"><section><p>EINSTELLUNGEN</p><h2>GAMEPLAY & AUDIO</h2><label>MAUSEMPFINDLICHKEIT <b>{settings.sensitivity.toFixed(2)}×</b><input type="range" min="0.35" max="2" step="0.05" value={settings.sensitivity} onChange={event => onChange({...settings,sensitivity:Number(event.target.value)})}/></label><label>LAUTSTÄRKE <b>{Math.round(settings.volume*100)}%</b><input type="range" min="0" max="1" step="0.05" value={settings.volume} onChange={event => onChange({...settings,volume:Number(event.target.value)})}/></label><label className="toggle"><input type="checkbox" checked={settings.reducedMotion} onChange={event => onChange({...settings,reducedMotion:event.target.checked})}/> REDUZIERTE KAMERABEWEGUNG</label><h3>GRAFIKQUALITÄT</h3><div className="quality-grid">{(["low","medium","high"] as const).map(quality => <button className={settings.graphics === quality ? "active" : ""} key={quality} onClick={() => onChange({...settings,graphics:quality})}>{quality === "low" ? "NIEDRIG" : quality === "medium" ? "MITTEL" : "HOCH"}</button>)}</div><h3>STEUERUNG</h3><div className="keybind-grid">{actions.map(item => <button className={listening === item.action ? "listening" : ""} key={item.action} onClick={() => setListening(item.action)}><span>{item.label}</span><b>{listening === item.action ? "TASTE DRÜCKEN …" : formatKey(settings.bindings[item.action])}</b></button>)}</div><button onClick={onClose}>ÜBERNEHMEN</button><button className="quiet" onClick={() => onChange(defaultSettings)}>STANDARDWERTE</button></section></div>;
}
