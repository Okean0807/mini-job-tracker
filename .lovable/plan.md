# Diagnose: Preview/Editor zeigt "This page didn't load"

Nur Diagnose – es wurde nichts geändert, nichts committet.

## Befund (bestätigt)

Der Dev-Server läuft, antwortet aber auf jede Anfrage mit HTTP 500 und der Fehlerseite.
Im Server-Log steht bei jedem Request derselbe Fehler:

```text
TypeError: matchedRoutes is not iterable
  at handleServerRoutes (@tanstack/start-server-core/src/createStartHandler.ts:778)
```

Das ist ein Framework-interner Fehler, kein Fehler im App-Code der Seiten.

## Ursache (bestätigt durch Lockfile und installierte Versionen)

Es sind zwei unterschiedliche Kopien des Router-Kerns installiert:

| Paket | Version | Router-Kern |
| --- | --- | --- |
| @tanstack/react-router (App) | 1.170.32 | router-core 1.171.27 |
| @tanstack/start-server-core (Server) | 1.169.17 | router-core 1.171.15 |

Der Routen-Baum wird also mit einer anderen Kern-Version erzeugt, als der Server ihn beim
Rendern liest. Der Server findet dadurch keine Routen-Liste (`undefined`) und bricht ab.

Auslöser ist der Commit `8484a9d "chore(deps): bump tanstack router patches and refresh bun.lock"`
(04.09.2026, Autor Okean0807, nicht Lovable). Dort wurde `@tanstack/react-router`
1.170.18 → 1.170.32 und `@tanstack/router-plugin` 1.168.23 → 1.168.35 angehoben, während
`@tanstack/react-start` weiterhin auf 1.168.32 gepinnt ist. Diese Kombination passt nicht zusammen.

## Einordnung der Frage "Code / Commit / GitHub / Lovable-Infrastruktur"

- Projektcode (Routen, Seiten, Logik): unauffällig, `src/routeTree.gen.ts` ist korrekt erzeugt.
- Letzter Commit `ed1f875` bzw. `94c3c64`: nicht ursächlich (nur Doku/Merge).
- Ursache: der Abhängigkeits-Commit `8484a9d`.
- GitHub-Sync: funktioniert, Historie vollständig, keine Hinweise auf blockierten Zugriff.
- Lovable-Infrastruktur: kein Hinweis auf ein Plattformproblem.

## Sicherer nächster Schritt (noch nicht ausgeführt)

Version-Sätze wieder aufeinander abstimmen – die kleinste, risikoärmste Variante:

1. In `package.json` `@tanstack/react-router` auf `1.170.18` und `@tanstack/router-plugin`
   auf `1.168.23` zurücksetzen (Stand vor `8484a9d`, passend zu `@tanstack/react-start` 1.168.32).
2. Abhängigkeiten neu installieren, Lockfile aktualisieren.
3. Prüfen, dass nur noch eine `router-core`-Version installiert ist.
4. Preview laden, danach Typecheck, vollständige Tests und Production Build.

Alternative, falls das Zurücksetzen nicht greift: stattdessen `@tanstack/react-start` auf den
zum neuen Router passenden Stand anheben. Nur eine der beiden Richtungen, nicht beide.

Ich führe nichts davon aus, bevor du zustimmst.
