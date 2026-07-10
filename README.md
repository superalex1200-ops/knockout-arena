# Knockout Arena

Knockout Arena ist ein schneller 3D-First-Person-Brawler für den Browser. Client und autoritativer WebSocket-Server werden in Produktion gemeinsam unter einer HTTPS-Domain ausgeliefert. Der Browser leitet daraus automatisch seine sichere `wss://…/ws`-Verbindung ab; es gibt keine fest eingebaute Localhost-Adresse.

Enthalten sind unter anderem Schnellspiel-FFA, private Stock Battles mit Host-Regeln, Training mit Sparr-Bot, Einladungslinks, Chat, Reconnect, Prediction/Reconciliation, Dash, Block/Parade, leichte und aufladbare schwere Schläge, Finisher, Wall-Hits, Assists, Zuschaueransicht, Einstellungen und lokale Match-Historie.

## Öffentlich deployen

Das Repository enthält eine [Render Blueprint](./render.yaml) und einen gemeinsamen [Produktionscontainer](./Dockerfile). Nach dem Verbinden des Repositorys in Render genügt **New → Blueprint**. Render erstellt anschließend einen öffentlichen `https://…onrender.com`-Endpunkt mit TLS; WebSockets laufen über dieselbe Domain.

Wichtig: Der Server hält laufende Räume im Arbeitsspeicher. Deshalb zunächst nur eine Instanz betreiben. Für horizontale Skalierung muss der Room-State später in einen gemeinsamen Store ausgelagert werden.

## Entwicklung

Voraussetzungen: Node.js 22+ und pnpm 10+.

```bash
pnpm install
pnpm dev
```

Vite leitet `/ws` und `/health` im Entwicklungsmodus automatisch an den Spielserver weiter. Der Produktionsbuild braucht keine `VITE_SERVER_URL`.

## Produktionsbuild

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

Der Node-Prozess liefert danach sowohl die gebaute Spielseite als auch `/ws` und `/health` über den in `PORT` gesetzten Anschluss aus.

## Container

```bash
docker compose up --build
```

Docker Compose startet nur noch einen gemeinsamen Game-Service. Damit entspricht die lokale Containerarchitektur der Cloud-Version.

## Steuerung

- WASD: bewegen
- Leertaste: springen
- Shift: Dash
- Linke Maustaste: leichter Schlag
- Rechte Maustaste halten und loslassen: Heavy
- Q: Block; die ersten 190 ms sind das Paradefenster
- Tab halten: Scoreboard anzeigen
- Enter: Match-Chat öffnen
- Escape: Pausemenü

Die Bewegungstasten lassen sich in den Einstellungen neu belegen.
