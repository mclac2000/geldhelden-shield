# Test-Checkliste für geldhelden-shield

## Setup vor Tests

1. ✅ `.env` Datei korrekt konfiguriert:
   - `BOT_TOKEN` gesetzt
   - `ADMIN_LOG_CHAT` = Chat-ID einer privaten Gruppe (für Logs)
   - `ADMIN_IDS` = Deine Telegram User-ID (z.B. via @userinfobot)
   - `JOIN_WINDOW_HOURS=24`
   - `JOIN_THRESHOLD=5`
   - `ACTION_MODE=restrict` (empfohlen für Tests)

2. ✅ Bot in Test-Gruppen hinzugefügt:
   - Bot hat Admin-Rechte in allen Test-Gruppen
   - Notwendige Rechte: "Nutzer bannen", "Nutzer einschränken"
   - Gruppen via `/register` registriert (oder automatisch beim Hinzufügen)

3. ✅ Bot läuft:
   ```bash
   npm run dev
   # oder
   docker-compose up
   ```

---

## Test 1: Normaler User joint 1 Gruppe

**Ziel**: Prüfen, dass normale User nicht blockiert werden

**Schritte:**
1. Füge einen normalen Test-User (NICHT in `ADMIN_IDS`) zu einer Test-Gruppe hinzu
2. Bot sollte:
   - ✅ Join registrieren (in Console siehst du: `[Join] User X ist Gruppe Y beigetreten`)
   - ✅ User NICHT restrict/ban
   - ✅ Kein Log im `ADMIN_LOG_CHAT` (nur bei Threshold-Überschreitung)

**Erwartetes Ergebnis:**
- User kann normal schreiben
- Keine Aktion durch Bot
- Status in DB bleibt "ok"

**Prüfung:**
```bash
# Im Bot Chat (als Admin):
/status <test_user_id>

# Sollte zeigen:
# Status: OK
# Joins in 24h Fenster: 1
# Risk Score: 10/100
```

---

## Test 2: Bot-User joint 5 Gruppen

**Ziel**: Prüfen, dass Bot selbst nicht gebannt/restricted wird

**Warnung**: Dieser Test erfordert einen zweiten Bot oder Test-Bot!

**Schritte:**
1. Erstelle einen zweiten Test-Bot (via @BotFather)
2. Füge diesen Test-Bot zu 5 verschiedenen Test-Gruppen hinzu (innerhalb 24h)
3. Bot sollte:
   - ✅ Joins registrieren
   - ✅ Test-Bot NICHT restrict/ban (Bot-Protection)
   - ✅ Log zeigen: `[Shield] SKIP restrict <bot_id>: Bot selbst`

**Erwartetes Ergebnis:**
- Test-Bot kann normal funktionieren
- Bot erkennt selbst-Bots und überspringt sie

**Prüfung:**
```bash
# Im Admin-Log Chat:
# Sollte "SKIP restrict" Messages zeigen für Bot-User
# Keine Restrictions tatsächlich durchgeführt
```

---

## Test 3: Admin joint Gruppen

**Ziel**: Prüfen, dass Admin-User (aus `ADMIN_IDS`) niemals gebannt werden

**Schritte:**
1. Verwende einen Telegram-Account, der in `ADMIN_IDS` steht
2. Füge diesen Account zu 10 verschiedenen Test-Gruppen hinzu (innerhalb 24h)
3. Bot sollte:
   - ✅ Joins registrieren
   - ✅ Admin NICHT restrict/ban
   - ✅ Log zeigen: `[Shield] SKIP restrict <admin_id>: Admin-User`

**Erwartetes Ergebnis:**
- Admin kann normal in allen Gruppen schreiben
- Keine Restrictions durchgeführt
- Admin-Protection funktioniert

**Prüfung:**
```bash
# Als Admin in einer Gruppe:
# Versuche zu schreiben → sollte funktionieren

# Im Bot Chat:
/status <deine_user_id>

# Sollte zeigen:
# Status: OK
# Joins in 24h Fenster: 10
# (aber trotzdem kein restrict!)
```

---

## Test 4: Verdächtiger User (Threshold-Überschreitung)

**Ziel**: Prüfen, dass automatische Restrict/Ban bei Threshold-Überschreitung funktioniert

**Schritte:**
1. Verwende einen Test-User (NICHT Admin, NICHT Bot)
2. Füge diesen User zu 5 verschiedenen Test-Gruppen hinzu (innerhalb 24h)
   - Gruppe 1: Join → OK (1/5)
   - Gruppe 2: Join → OK (2/5)
   - Gruppe 3: Join → OK (3/5)
   - Gruppe 4: Join → OK (4/5)
   - Gruppe 5: Join → **TRIGGER** (5/5 ≥ THRESHOLD)
3. Bot sollte:
   - ✅ Bei 5. Join automatisch Restrict ausführen (bei `ACTION_MODE=restrict`)
   - ✅ Log senden: `[Shield] User X → RESTRICTED (5 Joins / 24h)`
   - ✅ Status in DB auf "restricted" setzen
   - ✅ User in Gruppe 5 shadow-restricted

**Erwartetes Ergebnis:**
- User kann in Gruppe 5 keine Nachrichten mehr senden (shadow-restricted)
- Log erscheint im `ADMIN_LOG_CHAT`
- Status in DB: "restricted"

**Prüfung:**
```bash
# Im Admin-Log Chat:
# Sollte zeigen:
# [Shield] User 123456789 → RESTRICTED (5 Joins / 24h)
# Grund: Automatisch: 5 Joins in 24 Stunden...
# Chat: <chat_id>
# User: <username>

# Als Test-User in Gruppe 5:
# Versuche Nachricht zu senden → sollte nicht funktionieren (shadow-restricted)

# Im Bot Chat (als Admin):
/status <test_user_id>

# Sollte zeigen:
# Status: RESTRICTED
# Joins in 24h Fenster: 5
```

---

## Test 5: Manuelles /ban Kommando

**Ziel**: Prüfen, dass manueller Ban-Command in allen Gruppen funktioniert

**Schritte:**
1. Verwende einen Test-User (NICHT Admin)
2. Stelle sicher, dass dieser User in mindestens 3 Gruppen ist
3. Führe als Admin aus:
   ```
   /ban <test_user_id>
   ```
4. Bot sollte:
   - ✅ User in **allen** registrierten Gruppen bannen
   - ✅ Status in DB auf "banned" setzen
   - ✅ Log senden: `[Shield] User X → BANNED (Admin Action)`
   - ✅ Antwort im Chat: `🚫 User X gebannt und in N Gruppen gebannt.`

**Erwartetes Ergebnis:**
- User aus allen Gruppen entfernt
- Status: "banned"
- Log im `ADMIN_LOG_CHAT`

**Prüfung:**
```bash
# Bot Antwort im Chat:
# 🚫 User 123456789 gebannt und in 3 Gruppen gebannt. (0 Fehler) (0 übersprungen)

# Im Admin-Log Chat:
# [Shield] User 123456789 → BANNED (Admin Action)
# Grund: Manuell durch Admin <admin_id>: Ban-Command
# Ban: 3 Erfolg, 0 Fehler, 0 Übersprungen
# Admin: <admin_name> (<admin_id>)

# Als Test-User:
# Versuche einer der Gruppen beizutreten → sollte nicht möglich sein (gebannt)

# Im Bot Chat:
/status <test_user_id>

# Sollte zeigen:
# Status: BANNED
```

---

## Test 6: /allow Kommando (False Positive Korrektur)

**Ziel**: Prüfen, dass False Positives korrigiert werden können

**Schritte:**
1. Verwende den User aus Test 4 (der automatisch restricted wurde)
2. Als Admin:
   ```
   /allow <test_user_id>
   ```
3. Bot sollte:
   - ✅ Status auf "ok" setzen
   - ✅ Restrictions in **allen** Gruppen entfernen
   - ✅ Log senden: `[Shield] User X → ALLOW (Status: ok)`
   - ✅ Antwort: `✅ User X auf "ok" gesetzt und in N Gruppen unrestricted.`

**Erwartetes Ergebnis:**
- User kann wieder normal schreiben
- Status: "ok"
- Alle Restrictions entfernt

**Prüfung:**
```bash
# Bot Antwort:
# ✅ User 123456789 auf "ok" gesetzt und in 1 Gruppen unrestricted.

# Im Admin-Log Chat:
# [Shield] User 123456789 → ALLOW (Status: ok)

# Als Test-User:
# Versuche in Gruppe 5 zu schreiben → sollte wieder funktionieren

# Im Bot Chat:
/status <test_user_id>

# Sollte zeigen:
# Status: OK
```

---

## Test 7: /unrestrict Kommando

**Ziel**: Prüfen, dass nur Restrictions entfernt werden (ohne Status-Änderung)

**Schritte:**
1. Verwende einen restricted User (Status: "restricted")
2. Als Admin:
   ```
   /unrestrict <test_user_id>
   ```
3. Bot sollte:
   - ✅ Restrictions entfernen
   - ✅ Status **bleibt** "restricted" (kein "ok")
   - ✅ Log senden: `[Shield] User X → UNRESTRICTED`
   - ✅ Antwort: `🔓 User X in N Gruppen unrestricted.`

**Erwartetes Ergebnis:**
- User kann wieder schreiben
- Status bleibt "restricted" (nicht "ok")

**Prüfung:**
```bash
# Bot Antwort:
# 🔓 User 123456789 in 1 Gruppen unrestricted.

# Status sollte weiterhin "restricted" sein:
/status <test_user_id>
# Status: RESTRICTED (unverändert!)
```

---

## Test 8: Rate-Limit-Schutz

**Ziel**: Prüfen, dass Rate-Limits beachtet werden

**Schritte:**
1. Banne einen User manuell in sehr vielen Gruppen (z.B. 20+ Gruppen)
2. Führe `/ban` aus:
   ```
   /ban <test_user_id>
   ```
3. Bot sollte:
   - ✅ Alle Bans sequenziell durchführen (350ms Delay zwischen Actions)
   - ✅ Bei FloodWait automatisch warten und retry
   - ✅ Fortschritt in Console zeigen
   - ✅ Finale Statistik zeigen (success/failed/skipped)

**Erwartetes Ergebnis:**
- Keine Rate-Limit-Fehler in Console
- Alle Bans werden durchgeführt (eventuell mit Verzögerung)
- Console zeigt: `[Shield] Rate-Limit bei ban...` falls FloodWait auftritt

**Prüfung:**
```bash
# Console sollte zeigen:
# [Shield] Rate-Limit bei ban 123456789 in -1001234567890, warte 5s...
# (bei FloodWait)

# Bot Antwort:
# 🚫 User 123456789 gebannt und in 20 Gruppen gebannt. (0 Fehler) (0 übersprungen)
```

---

## Test 9: Gruppenregistrierung

**Ziel**: Prüfen, dass Gruppen korrekt registriert werden

**Schritte:**
1. Füge Bot zu einer neuen Test-Gruppe hinzu (als Admin)
2. Bot sollte:
   - ✅ Automatisch Gruppe registrieren (via `my_chat_member` Event)
   - ✅ Log senden: `✅ Bot zu Gruppe hinzugefügt`
3. Oder manuell:
   ```
   /register
   ```
   (in der Gruppe als Admin)

**Prüfung:**
```bash
# Im Admin-Log Chat:
# ✅ Bot zu Gruppe hinzugefügt
# Chat ID: -1001234567890
# Titel: Test Gruppe
# Typ: supergroup

# Im Bot Chat:
/groups

# Sollte Anzahl registrierter Gruppen zeigen
```

---

## Test 10: Fehlerbehandlung (Fehlende Rechte)

**Ziel**: Prüfen, dass Bot bei fehlenden Rechten nicht crasht

**Schritte:**
1. Entferne Bot-Rechte "Nutzer bannen" aus einer Test-Gruppe
2. Versuche User in dieser Gruppe zu bannen:
   ```
   /ban <test_user_id>
   ```
3. Bot sollte:
   - ✅ In anderen Gruppen (mit Rechten) bannen
   - ✅ In Gruppe ohne Rechte leise überspringen
   - ✅ Log zeigen: `[Shield] SKIP ban <user_id> in <chat_id>: not enough rights`
   - ✅ **NICHT crashen**

**Erwartetes Ergebnis:**
- Bot läuft weiter (kein Crash)
- Statistik zeigt skipped Groups
- Console zeigt Skip-Reason

**Prüfung:**
```bash
# Console:
# [Shield] SKIP ban 123456789 in -1001234567890: not enough rights

# Bot Antwort:
# 🚫 User 123456789 gebannt und in 4 Gruppen gebannt. (0 Fehler) (1 übersprungen)
```

---

## Abschluss-Checkliste

Nach allen Tests sollte:

- ✅ Bot läuft stabil (keine Crashes)
- ✅ Alle Logs erscheinen korrekt im `ADMIN_LOG_CHAT`
- ✅ Admin-Protection funktioniert
- ✅ Bot-Protection funktioniert
- ✅ Rate-Limit-Schutz funktioniert
- ✅ Alle Commands funktionieren
- ✅ False Positives können korrigiert werden
- ✅ Gruppenregistrierung funktioniert
- ✅ Fehlerbehandlung ist robust

## Bekannte Einschränkungen

- Bot benötigt Admin-Rechte in allen Gruppen für Actions
- Rate-Limits können bei sehr vielen Gruppen zu Verzögerungen führen
- `getChatMember` API-Calls werden bei jeder Action ausgeführt (für Admin-Check)
- User müssen bereits in der Gruppe sein, damit Actions funktionieren
