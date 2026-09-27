# Befund: Copy-Trading-Scam in Koh Phangan — und eine Abnahmebedingung, die nicht durchfallen konnte

**27.09.2026, Auftrag #125.** Zwei Befunde. Der zweite ist der größere.

---

## 1. Warum der Scam durchkam

In „Staatenlos / Geldhelden MeetUp Koh Phangan" (406 Mitglieder, `-1001515992806`)
erschien ein Album aus zwei Gewinn-Screenshots einer Kryptobörse — `BTCUSDT Perp |
Long | 33x | Closed | +348,86 %`, `ATOMUSDT | Long | 50x | +648,26 %`, im zweiten Bild
ein QR-Code und `Referral Code LHVUGTBO` — mit der Bildunterschrift:

> Best regards……I only listen to Suitable Win Trade
> 98% win rate in one month of copying his trades
> @SuitableWinTrade

**Die erste Vermutung war falsch und wurde gemessen statt geglaubt.** Die Gruppe
ist bewacht: `status='managed'`, `group_settings.scam_enabled = 1`,
`bot_is_admin = 1`, Schwelle 70. Der Erkenner lief also.

| Erkenner | Ergebnis |
|---|---|
| `src/scam.ts` (rund 90 Muster) | **0 von 70 Punkten** |
| `src/firstMessageRisk.ts` | **10 Punkte** |

Kein einziges Muster kennt Copy-Trading. **Zwei Erkenner haben die Nachricht
gesehen, beide haben sie durchgelassen.** Die Nachricht steht als Beleg dafür noch
in `first_message_samples` (id 446, 2026-09-27 00:23:00 UTC, Konto 8536848765 /
@KryptoEuleStefanV7 / „KryptoEule StefanV").

**Zur Uhrzeit, weil hier sieben Uhren durcheinandergehen können:** Die Nachricht
ist um **00:23 UTC** eingegangen, das sind **02:23 CEST** und **07:23 in Bangkok**.
Marco nennt „09:2x" — keine dieser drei Zeiten. Das ist nicht aufgelöst und wird
hier bewusst als Abweichung stehen gelassen statt stillschweigend passend gerechnet.
Von Hand gesperrt wurde das Konto um **01:02 UTC**, also rund 39 Minuten nach dem Post.

### Was gebaut wurde

- `src/copyTradingRisk.ts` — reiner Erkenner, fünf tragende Signalgruppen
  (unglaubwürdiger Gewinn, Hebel, Copy-Vokabular, Werbecode, Abwanderung) plus
  Börsensyntax als Stütze, die nie trägt.
- `src/copyTradingGuard.ts` — Durchsetzung in drei Stufen, Albumbehandlung.
- `copy_trading_events` — Protokoll **inklusive** der Fälle ohne Maßnahme.
- `leseNachrichtenStand()` — eine **lesende** Nachrichtenzählung.

### Vier Entscheidungen, die tragen

**Kein Börsenname in den Mustern.** Eine Liste ist an dem Tag falsch, an dem sie
geschrieben wird — dieselbe Lehre wie die 17 gmx-Endungen im Newsletter. Was eine
Börse verrät, ist ihre Syntax: `BTCUSDT`, `Perp`, `Long/Short` mit `PnL` und
`Entry price`. Die überlebt jede Umbenennung. Und sie hat den zweiten Vorteil, der
eine Namensliste erledigt: *„Hat jemand Erfahrung mit BingX?"* ist eine echte
Mitgliederfrage und darf nicht greifen — mit Liste hätte sie gegriffen.

**Die Unglaubwürdigkeit ist das Signal, nicht das Thema.** Eine Gewinnangabe zählt
erst ab 100 %, eine Trefferquote erst ab 80 %. Wer „+12 %" oder „Hebel 3x"
schreibt, berichtet; wer „+348,86 %" und „98 % win rate" schreibt, wirbt. Ohne
diese Grenzen trifft die Regel die halbe Gruppe.

**Der Text steckt in der Bildunterschrift, und ein Album ist mehrere Nachrichten
mit nur einer Unterschrift.** Telegram schickt jedes Bild als eigene Nachricht mit
gemeinsamer `media_group_id`; die Unterschrift trägt genau eine. Wer nur diese
löscht, lässt das zweite Gewinnbild samt QR-Code und Werbecode stehen. Im Livetest
ist das nachgewiesen: **Bild 1 → KEINE, Bild 2 → SPERREN, gelöscht wurden beide.**

**Wer schreibt, zählt mit — und das ist kein Feinschliff.** Ein eingesessenes
Mitglied (≥ 20 Nachrichten in der Gruppe) bekommt −40 Punkte und wird von dieser
Regel **nie** gesperrt, nur vorgelegt. Ein Konto mit höchstens zwei Nachrichten
bekommt +20, ein Konto unter 60 Tagen +15.

**Und einer, der beim ersten Testlauf sofort nötig wurde:** der
Warnkontext-Dämpfer. Ein Mitglied, das vor dem Scam warnt, zitiert ihn — „Achtung,
oben war Spam mit 98 % win rate und Copy Trading". Die erste Fassung hat genau das
getroffen. Der Dämpfer greift **nicht**, wenn gleichzeitig ein Werbecode oder eine
Privatchat-Aufforderung im Text steht, sonst wäre „Achtung" das Wort, mit dem sich
jeder Scam impfen könnte.

### Gemessen

| Messung | Ergebnis |
|---|---|
| Scam-Fassungen erkannt (andere Börse, andere Zahlen, deutsch, Impfversuch) | 7 von 7 |
| Echte Mitglieder-Beiträge über Trading durchgelassen | 8 von 8 |
| **Fehlalarm an echten gespeicherten Texten** | **415 von 416 durchgelassen, 0 gelöscht, 1 gesperrt — und das eine ist der echte Scam** |
| Livetest: Album im echten Telegram | beide Bilder weg, Konto in 55 von 56 Gruppen gesperrt |

Jede dieser Nullen steht neben einer **Positivkontrolle**, die greifen *muss* —
ohne sie wäre „nichts gefunden" auch dann ein grüner Haken, wenn der Erkenner gar
nicht geladen ist.

### Rückwirkend, mit der Grenze davor

In den gespeicherten Texten kommt die Masche **genau einmal** vor: der Fall Koh
Phangan. Werbecode `LHVUGTBO`: 0 weitere Funde. Kennung `@SuitableWinTrade`:
0 weitere. Kennungssuche nach Werber-Handles: ein einziger Treffer, ein echtes
Mitglied, unangetastet.

**Was diese Aussage nicht deckt, und das gehört vor die Zahl:** Der Bot speichert
keine Gruppenverläufe. Durchsucht wurden 416 Texte — die ersten Nachrichten
**neuer** Konten seit dem 11.09.2026, dazu Krypto-Meldungen und
Mitglieder-Meldungen. Was ein **eingesessenes** Konto in einer Gruppe geschrieben
hat, steht nirgends und ist nicht auffindbar. Der Fall vom 27.09. war nur deshalb
zu finden, weil das Konto neu war. „In den gespeicherten Texten nichts" ist nicht
dasselbe wie „dort war nichts".

---

## 2. Der größere Befund: eine Abnahmebedingung, die nicht durchfallen konnte

Beim Anlegen von Auftrag #125 meldete das Auftragsbuch:

> ACHTUNG: Die Abnahmebedingung ist JETZT SCHON erfuellt.

Zu diesem Zeitpunkt existierte keine Zeile des Erkenners. Die Ursache steckte
nicht im Buch, sondern in `/root/.ssh/authorized_keys` auf dem APS-Server:

```
command="docker exec geldhelden-shield-bot ls /app/dist/cryptoBuyRisk.js /app/dist/cryptoBuyGuard.js",…  auftragsbuch-abnahme
```

Der Abnahmeschlüssel war auf **einen festen Befehl** genagelt — ein Überrest der
Krypto-Ankauf-Abnahme. Ein erzwungener Befehl ignoriert, was der Aufrufer wollte.
**Damit hat JEDE Abnahmebedingung, die gegen diesen Server lief, dieselben zwei
Dateinamen ausgegeben und Exit 0 gemeldet** — egal, wonach sie fragte.
`ssh root@77.42.42.65 hostname` antwortete mit zwei Dateipfaden. Das hat in dieser
Sitzung über eine Stunde Fehlersuche gekostet, weil es wie ein kaputtes Werkzeug
aussah und ein falsch gestellter Server war.

**Behoben** mit `/root/.ssh/abnahme-befehle.sh` (0700, Sicherung der alten
`authorized_keys` liegt daneben): Der Schlüssel bleibt gesperrt — kein Shell-Zugang,
keine Weiterleitungen —, kennt aber jetzt mehrere erlaubte Fragen und **scheitert
bei allem anderen laut mit Exit 2**, statt stillschweigend die alte Antwort zu
liefern.

Nachgewiesen, alles drei:

| Probe | Ergebnis |
|---|---|
| alte Krypto-Bedingung | unverändert dieselbe Antwort |
| erfundener Befehl | **Exit 2, mit Begründung** |
| neue Copy-Trading-Bedingung | echter Abnahmebericht |
| Erkenner im Container beiseite gelegt | **Abnahme fällt durch**; zurückgelegt → besteht wieder |

Die letzte Zeile ist die, die zählt: **Die Bedingung kann scheitern.** Vorher
konnte sie das nicht.

### Was daraus folgt, über diesen Server hinaus

Ein erzwungener Befehl in `authorized_keys` ist eine gute Sicherheitsmaßnahme und
ein hervorragendes Versteck für einen blinden Fleck. Wer einen Abnahmeschlüssel
einrichtet, muss **einmal einen Befehl schicken, der scheitern MUSS**, und sehen,
dass er scheitert. Sonst ist das grüne Häkchen nur ein Echo.

**Zu prüfen:** ob dieselbe Verkabelung auch auf den anderen Servern steht, gegen
die das Auftragsbuch messen kann (`pact-prod`, `gobinar-hermes`). Dort gilt dieselbe
Frage — und eine bestandene Abnahme von dort ist bis dahin nur ein Verdacht.

---

## Offene Punkte

1. **In `-1003824357481` („Neue Freie Welt") fehlen dem Bot die Rechte** zum
   Sperren: *„not enough rights to restrict/unrestrict chat member"*. Die Sperre
   ging in 55 von 56 Gruppen durch, diese eine nicht. Betrifft nicht nur
   Copy-Trading, sondern jede Sperre.
2. **Abnahmeschlüssel auf `pact-prod` und `gobinar-hermes` gegenprüfen** (siehe oben).
3. `normalizeText()` in `src/scam.ts` ist **toter Code**: Die Funktion wird in
   `scoreScam()` aufgerufen, ihr Ergebnis aber nie benutzt — geprüft wird gegen
   `text`, nicht gegen `normalizedText`. Die Homoglyphen- und Unicode-Bereinigung
   des alten Erkenners wirkt also nicht. Nicht in dieser Sitzung angefasst, weil es
   ein anderer Erkenner ist und die Änderung eigene Messungen braucht.
