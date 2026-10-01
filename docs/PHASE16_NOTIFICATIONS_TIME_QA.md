# Phase 16 — Notifications / midnight / DST QA

## Implemented

- Notification send now returns success/failure; a notification is marked as delivered only after a successful dispatch path.
- When a service worker is controlling the page, notifications use `ServiceWorkerRegistration.showNotification()`; otherwise the browser `Notification` constructor is used.
- Start-reminder windows are calculated as circular minute-of-day intervals, so a window beginning late in the evening can cross midnight.
- Missing-shift detection uses calendar-date arithmetic instead of subtracting exactly 24 hours in milliseconds, avoiding DST boundary errors.
- Pure tests cover a 23:30 → 01:00 reminder window and previous-calendar-day calculations.

## Explicit limitation

The Shift model stores a calendar date and HH:mm values but no IANA timezone/UTC instant. Therefore the exact elapsed duration of a shift crossing a DST transition cannot be reconstructed from the current data model. This phase does not pretend to solve that limitation.

## Production matrix still required

1. Android Chrome, permission granted, app foreground.
2. Android installed PWA, app background/locked.
3. Android permission denied/revoked.
4. iOS Safari/PWA where notification support is available.
5. Desktop Chrome/Edge.
6. App fully closed: current architecture cannot guarantee scheduled local notifications because there is no server push subscription / platform scheduler driving `runNotificationChecks()`.
7. DST transition dates in Europe/Berlin with real device clocks.
