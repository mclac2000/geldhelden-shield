# Verhaltenskodex & Verwarnsystem der Meetup-Gruppen

Seit 27.11.2026 (Auftrag Marco). Code: `src/meetupKodex.ts`, Test: `npm run test:kodex`,
Abnahme gegen echtes Telegram: `scripts/livetest-kodex.ts`.

## Schalter
- `KODEX_AKTIV=1` (in `.env`, seit 27.11.2026 an) — alle Meetup-Gruppen: Titel mit „Meetup", Eintrag in
  `meetup_group_mapping` oder Lokalgruppe (Köln und Umland, Raum Hannover, Pattaya). 48 Gruppen.
- `KODEX_TESTCHAT=<chat_id>` — Testgruppe; Strafen wirken dort nur dort, Admins gelten als Mitglieder.

## Beitritt per Beitrittsanfrage (seit 28.11.2026)
- Je Meetup-Gruppe ein Einladungslink mit `creates_join_request` (Tabelle `kodex_einladung`). Eingetragen im
  Meetup-Backend `wp_ghclub_meetups.telegram_url` und auf /freiheits-meetup (Sicherung vorher:
  `~/_backups/vor-meetup-joinrequest-20261128-0155.sql` auf Hostpoint).
- Anfrage -> Bot schreibt PRIVAT (Kodex-Knopf `kjr:`, anonym zusaetzlich Vorstellung) -> erst dann
  `approveChatJoinRequest`. Bots/Gesperrte: abgelehnt. 48 Std. ohne Antwort: abgelehnt (Cron `kodex-anfragen`).
- Gruppe bleibt still: keine Begruessung, „X ist beigetreten" wird geloescht.
- Direktbeitritt (alte Links, oeffentlicher @Name ohne Anfrage): sofort stumm, Kodex privat bzw.
  60-s-Hinweis mit Deep-Link `/start kx_<gruppe>`.
- Alte Hauptlinks wurden NICHT widerrufen (stehen evtl. noch in alten Mails) — dafuer gibt es den Direktbeitritt-Weg.

## Kodex
„Ich verkaufe oder vermittle in den Gruppen und per Privatnachricht an Mitglieder keine Investments bzw.
Finanzprodukte und werbe nicht für eigene Angebote. Verstöße führen zum Ausschluss."
- Neue Mitglieder: ohne Schreibrecht bis zum Knopf. Anonyme Konten (Name < 3 Buchstaben oder weder @Name
  noch Profilbild) stellen sich danach im Privatchat vor (`/start vs_<gruppe>`).
- Bestandsmitglieder: angepinnter Aufruf (27.11.2026 in allen 48 Gruppen), Frist 14 Tage, dann eine
  Erinnerung (Cron `kodex-erinnerung`, 10:00). Niemand wird stummgeschaltet.

## Verwarnsystem (gemeinsame Zählung über alle Meetup-Gruppen)
| Stufe | Folge |
|---|---|
| 1 | Verwarnung |
| 2 | 7 Tage stumm in allen Meetup-Gruppen |
| 3 | **Ausschluss in allen GeldHelden-Gruppen** (`banUserGlobally`, wie Admin-Bann, inkl. Sperrliste MeinCEO) |

Werbung/Investment-Verkauf mit Beleg startet bei Stufe 2.
**Stufe 3 gilt bewusst für alle GeldHelden-Gruppen — Entscheidung Marco 28.11.2026. Nicht ändern.**

Kein Schritt ohne Beleg: `/verwarnen` bzw. `/werbung` nur als Antwort auf die Nachricht (wird in den
Admin-Log weitergeleitet) oder mit Meldungsnummer `M123` (Meldeweg: weitergeleitete Privatnachricht,
Screenshot). Rücknahme: `/aufheben V12` (Bot-Admins). Stand: `/verwarnstatus`.
