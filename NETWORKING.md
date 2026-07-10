# Networking

Clientnachrichten: `join`, `ready`, `chat`, `input`, `attack`. Servernachrichten: `welcome`, `snapshot`, `hit`, `wallHit`, `knockout`, `chat`, `notice`. Alle Verträge befinden sich in `packages/shared/src/index.ts`.

Der Server begrenzt Bewegungsachsen, prüft Zahlenwerte, verwirft doppelte oder rückwärts laufende Input-Sequenzen und bestätigt die zuletzt verarbeitete Sequenz in jedem Snapshot. Der Client sagt horizontale Eigenbewegung unmittelbar voraus, entfernt bestätigte Eingaben und gleicht kleine Abweichungen weich aus; Abweichungen über 2,75 Meter werden hart auf den autoritativen Zustand gesetzt. Beim Reconnect übernimmt der Client die letzte Serversequenz, statt wieder bei null zu beginnen. Angriffs-Cooldowns, Reichweite, Blickkegel, Spawn-Schutz, Ladezeit, Chatlänge/-rate und Verteidigungsfenster werden serverseitig geprüft. `ping`/`pong` misst die aktuelle Roundtrip-Zeit. Eine spätere Optimierungsphase kann die JSON-Snapshots binär codieren.

Schläge verwenden einen 300-ms-Positionspuffer und dürfen höchstens 150 ms zurückgespult werden. Der Clientzeitstempel wird serverseitig geklemmt; Reichweite, Blickwinkel und Wand-Sichtlinie werden anschließend gegen den historischen Zustand geprüft. Dies verbessert moderate Latenz, ohne dem Client Trefferautorität zu geben.
