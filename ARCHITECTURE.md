# Architektur

Das pnpm-Monorepo trennt Client, autoritativen Server und gemeinsame Verträge. `packages/shared` besitzt Balancewerte und alle Netzwerktypen. Der Server simuliert Bewegung, Angriffe, Verteidigung, Knockback, KOs und Respawns mit 30 Hz und sendet 20 Snapshots pro Sekunde. Clients senden ausschließlich Eingaben und interpolieren fremde Figuren; Trefferentscheidungen liegen nie beim Client.

Der Client nutzt React für Menü/HUD und Three.js direkt für den Renderloop. Diese Trennung verhindert React-Renderarbeit im Game-Loop. Geometrische Low-Poly-Assets werden zur Laufzeit erzeugt und benötigen keine externen Asset-Lizenzen.

Der derzeitige Transport verwendet kompaktes JSON über `ws`. Für die Alpha ist das transparent und robust. Ein kurzer serverseitiger Positionsverlauf ermöglicht bereits begrenztes Rewind bei Treffern; adaptive, clientzeitbasierte Lag Compensation und ein Binärprotokoll bleiben spätere Optimierungen.
