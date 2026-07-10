import { useCallback, useMemo, useState } from "react";
import type { MatchMode } from "@knockout/shared";
import { Game } from "./Game";
import { loadSettings, saveSettings, type GameSettings } from "./settings";
import { loadProfile, recordMatch, type GuestProfile, type MatchHistoryEntry } from "./profile";
import { SettingsPanel } from "./SettingsPanel";

type Session = { mode: MatchMode; code: string };
const randomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

export function App() {
  const [name, setName] = useState(() => localStorage.getItem("ko-name") ?? `Rookie${Math.floor(Math.random() * 90 + 10)}`);
  const [code, setCode] = useState(new URLSearchParams(location.search).get("room") ?? "");
  const [session, setSession] = useState<Session>();
  const [settings, setSettings] = useState<GameSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [profile, setProfile] = useState<GuestProfile>(loadProfile);
  const sparks = useMemo(() => Array.from({ length: 18 }, (_, i) => <i key={i} style={{ "--x": `${(i * 37) % 100}%`, "--d": `${2 + (i % 5)}s` } as React.CSSProperties}/>), []);
  const launch = (mode: MatchMode, roomCode: string) => { localStorage.setItem("ko-name", name); setSession({ mode, code: roomCode }); };
  const updateSettings = (next: GameSettings) => { setSettings(next); saveSettings(next); };
  const completeMatch = useCallback((entry: MatchHistoryEntry) => setProfile(current => recordMatch(current, entry)), []);
  if (session) return <Game name={name} roomCode={session.code} mode={session.mode} settings={settings} onSettingsChange={updateSettings} onMatchComplete={completeMatch} onExit={() => setSession(undefined)}/>;
  return <main className="menu">
    <div className="ambient">{sparks}</div><div className="arena-graphic"><div/><div/><div/></div>
    <section className="brand"><p className="eyebrow">FIRST-PERSON BRAWLING</p><h1>KNOCKOUT<br/><em>ARENA</em></h1><p className="tagline">TREFFEN. AUFLADEN. RAUSBEFÖRDERN.</p></section>
    <section className="menu-panel">
      <label>SPIELERNAME<input value={name} maxLength={18} onChange={(e) => setName(e.target.value)}/></label>
      <button className="primary" onClick={() => launch("quick", "QUICK")}><span>SCHNELLSPIEL</span><small>Sofort in die öffentliche Arena</small></button>
      <div className="join"><input value={code} maxLength={6} placeholder="LOBBYCODE" onChange={(e) => setCode(e.target.value.toUpperCase())}/><button disabled={!code.trim()} onClick={() => launch("private", code)}>BEITRETEN</button></div>
      <button onClick={() => launch("private", randomCode())}>PRIVATE LOBBY ERSTELLEN</button>
      <button onClick={() => launch("training", `TR${randomCode().slice(0,4)}`)}>TRAINING MIT SPARR-BOT</button>
      <button onClick={() => setShowSettings(true)}>EINSTELLUNGEN</button>
      <button onClick={() => setShowProfile(true)}>PROFIL & MATCH-HISTORIE</button>
      <footer><span>ALPHA 0.1</span><span>WASD · MAUS · KEINE WAFFEN</span></footer>
    </section>
    {showSettings && <SettingsPanel settings={settings} onChange={updateSettings} onClose={() => setShowSettings(false)}/>} 
    {showProfile && <div className="settings-overlay profile-overlay"><section><p>LOKALES GASTPROFIL</p><h2>{name}</h2><div className="profile-stats"><span><b>{profile.matches}</b>Matches</span><span><b>{profile.wins}</b>Siege</span><span><b>{profile.kos}</b>KOs</span><span><b>{profile.assists}</b>Assists</span></div><h3>LETZTE MATCHES</h3><div className="history">{profile.history.length === 0 ? <small>Noch keine abgeschlossenen Matches.</small> : profile.history.map(match => <div key={match.matchId}><b>#{match.placement}</b><span>{match.mode.toUpperCase()} · {match.roomCode}<small>{match.kos} KOs · {match.assists} Assists · {match.falls} Falls</small></span><time>{new Date(match.playedAt).toLocaleDateString("de-DE")}</time></div>)}</div><button onClick={() => setShowProfile(false)}>SCHLIESSEN</button></section></div>}
  </main>;
}
