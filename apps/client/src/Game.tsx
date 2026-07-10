import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_MATCH_RULES,
  PROTOCOL_VERSION,
  type MatchMode,
  type MatchPhase,
  type MatchRules,
  type PlayerSnapshot,
  type ServerMessage,
  type TrainingBotMode,
} from "@knockout/shared";
import { GameSocket } from "./network";
import { ArenaRenderer, type TutorialAction } from "./game/ArenaRenderer";
import type { GameSettings } from "./settings";
import type { MatchHistoryEntry } from "./profile";
import { SettingsPanel } from "./SettingsPanel";
import { formatKey } from "./settings";
import { EMPTY_COMBAT_HUD, type CombatHudState } from "./game/combatHud";

type Props = {
  name: string;
  roomCode: string;
  mode: MatchMode;
  createRoom: boolean;
  settings: GameSettings;
  onSettingsChange: (settings: GameSettings) => void;
  onMatchComplete: (entry: MatchHistoryEntry) => void;
  onExit: () => void;
};

export function Game({
  name,
  roomCode,
  mode,
  createRoom,
  settings,
  onSettingsChange,
  onMatchComplete,
  onExit,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);
  const [joinError, setJoinError] = useState<string>();
  const [room, setRoom] = useState(roomCode);
  const [me, setMe] = useState<PlayerSnapshot>();
  const [notice, setNotice] = useState("VERBINDUNG WIRD HERGESTELLT …");
  const [phase, setPhase] = useState<MatchPhase>(
    mode === "private" ? "lobby" : "playing",
  );
  const [phaseEndsAt, setPhaseEndsAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [players, setPlayers] = useState<PlayerSnapshot[]>([]);
  const socketRef = useRef<GameSocket | undefined>(undefined);
  const reconnectTokenRef = useRef("");
  const playerIdRef = useRef("");
  const recordedMatchRef = useRef("");
  const [copied, setCopied] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [matchChatOpen, setMatchChatOpen] = useState(false);
  const [scoreboardOpen, setScoreboardOpen] = useState(false);
  const matchChatInputRef = useRef<HTMLInputElement>(null);
  const [chat, setChat] = useState<
    Array<{ playerId: string; name: string; text: string; sentAt: number }>
  >([]);
  const [ping, setPing] = useState<number | null>(null);
  const [tutorialDone, setTutorialDone] = useState<Set<TutorialAction>>(
    () => new Set(),
  );
  const [trainingBotMode, setTrainingBotMode] =
    useState<TrainingBotMode>("aggressive");
  const [rules, setRules] = useState<MatchRules>({ ...DEFAULT_MATCH_RULES });
  const [spectatorTargetId, setSpectatorTargetId] = useState("");
  const [paused, setPaused] = useState(false);
  const [pauseSettings, setPauseSettings] = useState(false);
  const [hitMarker, setHitMarker] = useState(false);
  const [impact, setImpact] = useState<"" | "light" | "heavy">("");
  const [combatHud, setCombatHud] = useState<CombatHudState>(EMPTY_COMBAT_HUD);
  const [killfeed, setKillfeed] = useState<
    Array<{ id: number; text: string; assist: boolean }>
  >([]);
  const playersRef = useRef(new Map<string, PlayerSnapshot>());
  const feedIdRef = useRef(0);
  const rendererRef = useRef<ArenaRenderer | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const socket = new GameSocket();
    socketRef.current = socket;
    const renderer = new ArenaRenderer(
      hostRef.current,
      socket,
      (message: ServerMessage, local?: PlayerSnapshot) => {
        if (message.type === "welcome") {
          setJoinError(undefined);
          setRoom(message.roomCode);
          reconnectTokenRef.current = message.reconnectToken;
          playerIdRef.current = message.playerId;
        }
        if (message.type === "joinError") {
          setJoinError(message.message);
          setNotice("BEITRITT FEHLGESCHLAGEN");
        }
        if (message.type === "snapshot") {
          setPhase(message.phase);
          setPhaseEndsAt(message.phaseEndsAt);
          setPlayers(message.players);
          playersRef.current = new Map(
            message.players.map((player) => [player.id, player]),
          );
          setTrainingBotMode(message.trainingBotMode);
          setRules(message.rules);
          if (
            message.phase === "results" &&
            message.matchId !== recordedMatchRef.current
          ) {
            const localPlayer = message.players.find(
              (player) => player.id === playerIdRef.current,
            );
            if (localPlayer) {
              const ranked = [...message.players].sort(
                (a, b) => b.score - a.score || a.falls - b.falls,
              );
              recordedMatchRef.current = message.matchId;
              onMatchComplete({
                matchId: message.matchId,
                playedAt: new Date(message.serverTime).toISOString(),
                mode,
                roomCode,
                durationSeconds: Math.max(
                  0,
                  Math.round(
                    (message.serverTime - message.matchStartedAt) / 1000,
                  ),
                ),
                placement:
                  ranked.findIndex((player) => player.id === localPlayer.id) +
                  1,
                playerCount: ranked.length,
                kos: localPlayer.score,
                assists: localPlayer.assists,
                falls: localPlayer.falls,
              });
            }
          }
        }
        if (message.type === "notice") {
          setNotice(message.text);
          window.setTimeout(() => setNotice(""), 2200);
        }
        if (message.type === "hit") {
          setNotice(
            message.finisher
              ? "FINISHER!"
              : message.parried
                ? "PERFEKTE PARADE"
                : message.blocked
                  ? "GEBLOCKT"
                  : message.attackerId === playerIdRef.current &&
                      message.combo >= 2
                    ? `${message.combo} HIT`
                    : message.kind === "heavy"
                      ? "SCHWERER TREFFER"
                      : "TREFFER",
          );
          if (message.attackerId === playerIdRef.current) {
            setHitMarker(true);
            window.setTimeout(() => setHitMarker(false), 110);
          }
          if (message.victimId === playerIdRef.current) {
            setImpact(message.blocked ? "light" : message.kind);
            window.setTimeout(
              () => setImpact(""),
              message.kind === "heavy" ? 210 : 130,
            );
          }
        }
        if (message.type === "wallHit" && message.playerId === local?.id)
          setNotice("WALL HIT");
        if (message.type === "chat")
          setChat((current) => [...current.slice(-19), message]);
        if (message.type === "pong")
          setPing(Math.max(0, Date.now() - message.clientTime));
        if (message.type === "knockout") {
          setNotice(
            message.assistIds.includes(playerIdRef.current)
              ? "ASSIST"
              : "KNOCKOUT!",
          );
          const victim = playersRef.current.get(message.victimId);
          const attacker = message.attackerId
            ? playersRef.current.get(message.attackerId)
            : undefined;
          const assist = message.assistIds.includes(playerIdRef.current);
          const id = ++feedIdRef.current;
          const text = attacker
            ? `${attacker.name} → ${victim?.name ?? "GEGNER"}`
            : `${victim?.name ?? "SPIELER"} IST GEFALLEN`;
          setKillfeed((current) => [
            ...current.slice(-3),
            { id, text, assist },
          ]);
          window.setTimeout(
            () =>
              setKillfeed((current) =>
                current.filter((entry) => entry.id !== id),
              ),
            4_500,
          );
        }
        if (local) setMe({ ...local });
      },
      settings,
      (action) =>
        setTutorialDone((current) =>
          current.has(action) ? current : new Set(current).add(action),
        ),
      () => setPaused(true),
      setCombatHud,
      (action, active) => {
        if (action === "scoreboard") setScoreboardOpen(active);
        if (action === "chat" && active) {
          setMatchChatOpen(true);
          window.setTimeout(() => matchChatInputRef.current?.focus());
        }
      },
    );
    rendererRef.current = renderer;
    socket.connect(
      (message) => renderer.onMessage(message),
      (online) => {
        setConnected(online);
        if (online)
          socket.send({
            type: "join",
            name,
            roomCode,
            mode,
            protocolVersion: PROTOCOL_VERSION,
            createRoom,
            reconnectToken: reconnectTokenRef.current || undefined,
          });
      },
    );
    const pingTimer = window.setInterval(
      () => socket.send({ type: "ping", clientTime: Date.now() }),
      2_000,
    );
    renderer.start();
    return () => {
      window.clearInterval(pingTimer);
      rendererRef.current = null;
      renderer.dispose();
      socket.close();
    };
  }, [createRoom, mode, name, onMatchComplete, roomCode, settings]);

  const copyInvite = async () => {
    const invite = `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`;
    await navigator.clipboard.writeText(invite);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  };
  const sendChat = () => {
    const text = chatDraft.trim();
    if (text) socketRef.current?.send({ type: "chat", text });
    setChatDraft("");
    setMatchChatOpen(false);
    window.setTimeout(() => rendererRef.current?.capturePointer());
  };
  const resume = () => {
    setPauseSettings(false);
    setPaused(false);
    rendererRef.current?.capturePointer();
  };
  const updateRules = (patch: Partial<MatchRules>) =>
    socketRef.current?.send({ type: "updateRules", patch });
  const activeSpectators = players.filter(
    (player) => !player.eliminated && !player.bot && player.id !== me?.id,
  );
  const spectatorTarget =
    activeSpectators.find((player) => player.id === spectatorTargetId) ??
    activeSpectators[0];
  const cycleSpectator = (direction: -1 | 1) => {
    if (!activeSpectators.length) return;
    const current = Math.max(
      0,
      activeSpectators.findIndex((player) => player.id === spectatorTarget?.id),
    );
    const next =
      activeSpectators[
        (current + direction + activeSpectators.length) %
          activeSpectators.length
      ]!;
    setSpectatorTargetId(next.id);
    rendererRef.current?.setSpectatorTarget(next.id);
  };
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    rendererRef.current?.setSpectatorTarget(
      me?.eliminated && phase === "playing" ? (spectatorTarget?.id ?? "") : "",
    );
  }, [me?.eliminated, phase, spectatorTarget?.id]);

  const remainingSeconds = Math.max(0, Math.ceil((phaseEndsAt - now) / 1000));
  const clock = `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, "0")}`;
  const stockBattle = mode === "private" && rules.gameMode === "stock";
  const teamBattle = mode === "private" && rules.gameMode === "team";
  const teamScores = {
    red: players
      .filter((player) => player.team === "red")
      .reduce((sum, player) => sum + player.score, 0),
    blue: players
      .filter((player) => player.team === "blue")
      .reduce((sum, player) => sum + player.score, 0),
  };

  return (
    <main className={`game-shell mode-${mode}`}>
      <div ref={hostRef} className="viewport" />
      <div className="topbar">
        <span className={connected ? "online" : "offline"}>
          {connected ? "● ONLINE" : "● OFFLINE"}
        </span>
        <span>ARENA {room}</span>
        <span
          className={`network ${ping === null ? "" : ping < 80 ? "good" : ping < 160 ? "medium" : "bad"}`}
        >
          {ping ?? "—"} MS
        </span>
        <button onClick={onExit}>VERLASSEN</button>
      </div>
      <div className="notice">{notice}</div>
      <div
        className={`crosshair ${combatHud.blocking ? "blocking" : ""} ${combatHud.parryActive ? "parry" : ""} ${combatHud.validTarget ? "target-valid" : ""} ${hitMarker ? "confirmed" : ""} ${me?.eliminated ? "hidden" : ""}`}
      >
        <i />
        <i />
      </div>
      <div className={`impact-overlay ${impact}`} />
      <div className="hud-card">
        <span>KNOCKBACK</span>
        <strong>
          {Math.round(me?.knockback ?? 0)}
          <small>%</small>
        </strong>
        <div className="meter">
          <b style={{ width: `${Math.min(100, me?.knockback ?? 0)}%` }} />
        </div>
        {stockBattle && (
          <div
            className="stocks"
            aria-label={`${me?.stocksRemaining ?? rules.stocks} Stocks`}
          >
            {Array.from({ length: rules.stocks }, (_, index) => (
              <i
                className={
                  index < (me?.stocksRemaining ?? rules.stocks)
                    ? "alive"
                    : "lost"
                }
                key={index}
              />
            ))}
          </div>
        )}
      </div>
      <div className="match-clock">
        {mode === "training"
          ? "TRAINING"
          : phase === "playing"
            ? clock
            : "--:--"}
      </div>
      {teamBattle && (
        <div className="team-score">
          <span className="red">
            ROT <b>{teamScores.red}</b>
          </span>
          <i>VS</i>
          <span className="blue">
            <b>{teamScores.blue}</b> BLAU
          </span>
        </div>
      )}
      <div className="score">
        <span>
          KOs <b>{me?.score ?? 0}</b>
        </span>
        <span>
          ASSISTS <b>{me?.assists ?? 0}</b>
        </span>
        <span>
          FALLS <b>{me?.falls ?? 0}</b>
        </span>
      </div>
      <div className="combat-hud">
        <CombatMeter label="SCHLAG" value={combatHud.lightReady} enabled />
        <CombatMeter
          label="DASH"
          value={combatHud.dashReady}
          enabled={combatHud.dashEnabled}
        />
        <CombatMeter
          label="HEAVY"
          value={combatHud.heavyCharge || combatHud.heavyReady}
          enabled={combatHud.heavyEnabled}
          charging={combatHud.heavyCharge > 0}
        />
        <CombatMeter
          label="BLOCK"
          value={combatHud.blocking ? 1 : 0}
          enabled={combatHud.blockEnabled}
          active={combatHud.blocking}
          status={
            combatHud.parryActive
              ? "PARRY!"
              : combatHud.blocking
                ? "AKTIV"
                : "HALTEN"
          }
        />
      </div>
      <div className="killfeed">
        {killfeed.map((entry) => (
          <div className={entry.assist ? "assist" : ""} key={entry.id}>
            <i>{entry.assist ? "ASSIST" : "KO"}</i>
            <span>{entry.text}</span>
          </div>
        ))}
      </div>
      <div className="controls">
        {formatKey(settings.bindings.forward)}/
        {formatKey(settings.bindings.left)}/{formatKey(settings.bindings.back)}/
        {formatKey(settings.bindings.right)} BEWEGEN ·{" "}
        {formatKey(settings.bindings.jump)} SPRINGEN ·{" "}
        {formatKey(settings.bindings.dash)} DASH · LMB SCHLAG · RMB AUFLADEN ·{" "}
        {formatKey(settings.bindings.block)} BLOCK
      </div>
      <div className="lock-hint">KLICKEN, UM DIE MAUS ZU FANGEN</div>
      {scoreboardOpen && phase === "playing" && (
        <div className="scoreboard-overlay">
          <p>SCOREBOARD</p>
          <div className="roster">
            {[...players]
              .filter((player) => !player.bot)
              .sort((a, b) => b.score - a.score || a.falls - b.falls)
              .map((player, index) => (
                <span key={player.id}>
                  <i>#{index + 1}</i>
                  {player.team && (
                    <em className={`team ${player.team}`}>
                      {player.team === "red" ? "ROT" : "BLAU"}
                    </em>
                  )}
                  {player.name}
                  <b>
                    {player.score} KOs · {player.assists} A · {player.falls} F
                  </b>
                </span>
              ))}
          </div>
          <small>TAB LOSLASSEN ZUM SCHLIESSEN</small>
        </div>
      )}
      {matchChatOpen && phase === "playing" && (
        <div className="match-chat">
          <div className="chat-log">
            {chat.slice(-6).map((message) => (
              <div key={`${message.playerId}-${message.sentAt}`}>
                <b>{message.name}</b>
                <span>{message.text}</span>
              </div>
            ))}
          </div>
          <form
            className="chat-form"
            onSubmit={(event) => {
              event.preventDefault();
              sendChat();
            }}
          >
            <input
              ref={matchChatInputRef}
              aria-label="Match-Nachricht"
              maxLength={120}
              placeholder="NACHRICHT …"
              value={chatDraft}
              onChange={(event) => setChatDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.code !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                setChatDraft("");
                setMatchChatOpen(false);
                window.setTimeout(() => rendererRef.current?.capturePointer());
              }}
            />
            <button type="submit">SENDEN</button>
          </form>
        </div>
      )}
      {joinError && (
        <div className="phase-overlay join-error" role="alert">
          <section>
            <p>LOBBY NICHT VERFÜGBAR</p>
            <h2>BEITRITT FEHLGESCHLAGEN</h2>
            <small>{joinError}</small>
            <button className="ready" onClick={onExit}>
              ZURÜCK ZUM HAUPTMENÜ
            </button>
          </section>
        </div>
      )}
      {phase === "lobby" && (
        <div className="phase-overlay">
          <section className="lobby-panel">
            <p>{mode === "quick" ? "SPIELERSUCHE" : "PRIVATE LOBBY"}</p>
            <h2>{room}</h2>
            <div className="roster">
              {players
                .filter((p) => !p.bot)
                .map((p) => (
                  <span key={p.id}>
                    {p.host && <i>HOST</i>}
                    {teamBattle && p.team && (
                      <em className={`team ${p.team}`}>
                        {p.team === "red" ? "ROT" : "BLAU"}
                      </em>
                    )}
                    {p.name}
                    <b>{p.ready ? "BEREIT" : "WARTET"}</b>
                  </span>
                ))}
            </div>
            {mode === "private" && (
              <PrivateRules
                rules={rules}
                host={!!me?.host}
                update={updateRules}
              />
            )}
            {mode === "private" && (
              <div className="chat-log">
                {chat.length === 0 ? (
                  <small>Noch keine Nachrichten</small>
                ) : (
                  chat.map((message) => (
                    <div key={`${message.playerId}-${message.sentAt}`}>
                      <b>{message.name}</b>
                      <span>{message.text}</span>
                    </div>
                  ))
                )}
              </div>
            )}
            {mode === "private" && (
              <form
                className="chat-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  sendChat();
                }}
              >
                <input
                  aria-label="Lobby-Nachricht"
                  maxLength={120}
                  placeholder="NACHRICHT …"
                  value={chatDraft}
                  onChange={(event) => setChatDraft(event.target.value)}
                />
                <button type="submit">SENDEN</button>
              </form>
            )}
            {mode === "private" && (
              <button
                className={me?.ready ? "ready active" : "ready"}
                onClick={() =>
                  socketRef.current?.send({ type: "ready", ready: !me?.ready })
                }
              >
                {me?.ready ? "NICHT BEREIT" : "BEREIT"}
              </button>
            )}
            {mode === "private" && (
              <button className="invite" onClick={() => void copyInvite()}>
                {copied ? "LINK KOPIERT" : "EINLADUNGSLINK KOPIEREN"}
              </button>
            )}
            <small>
              {mode === "quick"
                ? "Warte auf einen Gegner – du kannst jederzeit verlassen."
                : "Stock Battle startet, sobald mindestens zwei Spieler bereit sind."}
            </small>
          </section>
        </div>
      )}
      {phase === "countdown" && (
        <div className="countdown">{Math.max(1, remainingSeconds)}</div>
      )}
      {me?.eliminated && phase === "playing" && (
        <div className="spectator-bar">
          <small>ZUSCHAUER</small>
          <strong>{spectatorTarget?.name ?? "KEIN SPIELER ÜBRIG"}</strong>
          <span>
            {spectatorTarget
              ? `${spectatorTarget.stocksRemaining} STOCKS · ${Math.round(spectatorTarget.knockback)}%`
              : "MATCH ENDET …"}
          </span>
          {activeSpectators.length > 1 && (
            <div>
              <button onClick={() => cycleSpectator(-1)}>← VORHERIGER</button>
              <button onClick={() => cycleSpectator(1)}>NÄCHSTER →</button>
            </div>
          )}
        </div>
      )}
      {phase === "results" && (
        <div className="phase-overlay">
          <section>
            <p>MATCH BEENDET</p>
            <h2>ERGEBNIS</h2>
            {teamBattle && (
              <div className="team-result">
                <span className="red">
                  ROT <b>{teamScores.red}</b>
                </span>
                <i>:</i>
                <span className="blue">
                  <b>{teamScores.blue}</b> BLAU
                </span>
              </div>
            )}
            <div className="roster">
              {[...players]
                .sort((a, b) =>
                  stockBattle
                    ? b.stocksRemaining - a.stocksRemaining ||
                      b.score - a.score ||
                      a.falls - b.falls
                    : b.score - a.score || a.falls - b.falls,
                )
                .map((p, i) => (
                  <span key={p.id}>
                    <i>#{i + 1}</i>
                    {teamBattle && p.team && (
                      <em className={`team ${p.team}`}>
                        {p.team === "red" ? "ROT" : "BLAU"}
                      </em>
                    )}
                    {p.name}
                    <b>
                      {stockBattle ? `${p.stocksRemaining} STOCKS · ` : ""}
                      {p.score} KOs · {p.assists} A
                    </b>
                  </span>
                ))}
            </div>
            <small>Rückkehr zur Lobby in wenigen Sekunden …</small>
            <button className="invite" onClick={onExit}>
              ZUM HAUPTMENÜ
            </button>
          </section>
        </div>
      )}
      {mode === "training" && (
        <TutorialPanel
          done={tutorialDone}
          botMode={trainingBotMode}
          settings={settings}
          setBotMode={(next) =>
            socketRef.current?.send({ type: "setTrainingBotMode", mode: next })
          }
        />
      )}
      {paused && !pauseSettings && (
        <div className="phase-overlay pause-overlay">
          <section>
            <p>PAUSIERT</p>
            <h2>KNOCKOUT ARENA</h2>
            <button className="ready" onClick={resume}>
              FORTSETZEN
            </button>
            <button className="invite" onClick={() => setPauseSettings(true)}>
              EINSTELLUNGEN
            </button>
            <button className="danger" onClick={onExit}>
              MATCH VERLASSEN
            </button>
            <small>Das Online-Match läuft während der Pause weiter.</small>
          </section>
        </div>
      )}
      {pauseSettings && (
        <SettingsPanel
          settings={settings}
          onChange={onSettingsChange}
          onClose={() => setPauseSettings(false)}
        />
      )}
    </main>
  );
}

function CombatMeter({
  label,
  value,
  enabled,
  charging = false,
  active = false,
  status,
}: {
  label: string;
  value: number;
  enabled: boolean;
  charging?: boolean;
  active?: boolean;
  status?: string;
}) {
  const ready = value >= 0.999;
  return (
    <div
      className={`${ready ? "ready" : ""} ${charging ? "charging" : ""} ${active ? "active" : ""} ${enabled ? "" : "off"}`}
    >
      <span>
        {label}
        <b>
          {!enabled
            ? "AUS"
            : (status ?? (ready ? "BEREIT" : `${Math.round(value * 100)}%`))}
        </b>
      </span>
      <i>
        <b style={{ width: `${enabled ? value * 100 : 0}%` }} />
      </i>
    </div>
  );
}

function PrivateRules({
  rules,
  host,
  update,
}: {
  rules: MatchRules;
  host: boolean;
  update: (patch: Partial<MatchRules>) => void;
}) {
  const choices = <T extends number>(
    values: T[],
    selected: T,
    label: (value: T) => string,
    select: (value: T) => void,
  ) =>
    values.map((value) => (
      <button
        key={value}
        className={selected === value ? "active" : ""}
        disabled={!host}
        onClick={() => select(value)}
      >
        {label(value)}
      </button>
    ));
  const toggles: Array<{
    key: "heavyEnabled" | "dashEnabled" | "blockEnabled";
    label: string;
  }> = [
    { key: "heavyEnabled", label: "HEAVY" },
    { key: "dashEnabled", label: "DASH" },
    { key: "blockEnabled", label: "BLOCK/PARRY" },
  ];
  return (
    <div className="private-rules">
      <header>
        <span>MATCH-REGELN</span>
        <b>{host ? "HOST STEUERT" : "NUR HOST"}</b>
      </header>
      <label>
        MODUS
        <div>
          <button
            disabled={!host}
            className={rules.gameMode === "stock" ? "active" : ""}
            onClick={() => update({ gameMode: "stock" })}
          >
            STOCK
          </button>
          <button
            disabled={!host}
            className={rules.gameMode === "team" ? "active" : ""}
            onClick={() => update({ gameMode: "team" })}
          >
            TEAM K.O.
          </button>
        </div>
      </label>
      <label>
        ZEIT
        <div>
          {choices(
            [60, 120, 180, 300],
            rules.matchDurationSeconds,
            (value) => `${value / 60} MIN`,
            (value) => update({ matchDurationSeconds: value }),
          )}
        </div>
      </label>
      {rules.gameMode === "stock" && (
        <label>
          STOCKS
          <div>
            {choices([1, 2, 3, 5], rules.stocks, String, (value) =>
              update({ stocks: value }),
            )}
          </div>
        </label>
      )}
      <label>
        KNOCKBACK
        <div>
          {choices(
            [0.75, 1, 1.25, 1.5],
            rules.knockbackMultiplier,
            (value) => `${value}×`,
            (value) => update({ knockbackMultiplier: value }),
          )}
        </div>
      </label>
      <label>
        FÄHIGKEITEN
        <div>
          {toggles.map((toggle) => (
            <button
              key={toggle.key}
              disabled={!host}
              className={rules[toggle.key] ? "active" : ""}
              onClick={() => update({ [toggle.key]: !rules[toggle.key] })}
            >
              {toggle.label}
            </button>
          ))}
        </div>
      </label>
      {rules.gameMode === "team" && (
        <label>
          FRIENDLY FIRE
          <div>
            <button
              disabled={!host}
              className={!rules.friendlyFire ? "active" : ""}
              onClick={() => update({ friendlyFire: false })}
            >
              AUS
            </button>
            <button
              disabled={!host}
              className={rules.friendlyFire ? "active" : ""}
              onClick={() => update({ friendlyFire: true })}
            >
              AN
            </button>
          </div>
        </label>
      )}
    </div>
  );
}

const tutorialSteps: Array<{ action: TutorialAction; label: string }> = [
  { action: "move", label: "Mit WASD bewegen" },
  { action: "look", label: "Mit der Maus umsehen" },
  { action: "jump", label: "Mit Leertaste springen" },
  { action: "punch", label: "Normalen Schlag ausführen" },
  { action: "hit", label: "Den Sparr-Bot treffen" },
  { action: "heavy", label: "Schweren Schlag aufladen" },
  { action: "dash", label: "Mit Shift ausweichen" },
  { action: "block", label: "Mit Q blocken/parieren" },
  { action: "knockback", label: "Knockback erleben" },
  { action: "knockout", label: "Einen Knockout erzielen" },
];

const botModes: Array<{ value: TrainingBotMode; label: string }> = [
  { value: "static", label: "STATISCH" },
  { value: "strafe", label: "SEITLICH" },
  { value: "aggressive", label: "ANGRIFF" },
  { value: "blocking", label: "BLOCK" },
];
function TutorialPanel({
  done,
  botMode,
  settings,
  setBotMode,
}: {
  done: Set<TutorialAction>;
  botMode: TrainingBotMode;
  settings: GameSettings;
  setBotMode: (mode: TrainingBotMode) => void;
}) {
  const labels: Partial<Record<TutorialAction, string>> = {
    move: `Mit ${formatKey(settings.bindings.forward)}/${formatKey(settings.bindings.left)}/${formatKey(settings.bindings.back)}/${formatKey(settings.bindings.right)} bewegen`,
    jump: `Mit ${formatKey(settings.bindings.jump)} springen`,
    dash: `Mit ${formatKey(settings.bindings.dash)} ausweichen`,
    block: `Mit ${formatKey(settings.bindings.block)} blocken/parieren`,
  };
  return (
    <aside className="tutorial-panel">
      <p>TRAINING</p>
      <h3>
        {done.size}/{tutorialSteps.length} SCHRITTE
      </h3>
      <div className="bot-modes">
        {botModes.map((mode) => (
          <button
            className={botMode === mode.value ? "active" : ""}
            onClick={() => setBotMode(mode.value)}
            key={mode.value}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <div>
        {tutorialSteps.map((step) => (
          <span
            className={done.has(step.action) ? "done" : ""}
            key={step.action}
          >
            <b>{done.has(step.action) ? "✓" : "○"}</b>
            {labels[step.action] ?? step.label}
          </span>
        ))}
      </div>
      {done.size === tutorialSteps.length && (
        <strong>TUTORIAL ABGESCHLOSSEN</strong>
      )}
    </aside>
  );
}
