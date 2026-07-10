# Contributing

## Entwicklung

1. Node.js 22+ und pnpm 10+ installieren.
2. `pnpm install` und danach `pnpm dev` ausführen.
3. Gameplay-Konstanten ausschließlich in `packages/shared/src/index.ts` zentral halten.
4. Neue Netzwerkereignisse zuerst als diskriminierte Typen im Shared-Paket definieren.

Vor jeder Änderung müssen `pnpm typecheck`, `pnpm test` und `pnpm build` erfolgreich sein. Änderungen an Multiplayer-Abläufen werden zusätzlich mit den Scripts `test:integration` und `test:reconnect` gegen einen laufenden Server geprüft.

Client und Server dürfen kampfrelevante Entscheidungen nicht doppelt oder widersprüchlich implementieren. Der Client präsentiert unmittelbares Feedback, aber der Server entscheidet über Treffer, Knockback, KOs und Punkte.
