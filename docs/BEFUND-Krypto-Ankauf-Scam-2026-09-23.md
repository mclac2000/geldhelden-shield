# Krypto-Ankauf-Betrug: warum er durchkam (23.09.2026)

Marco meldete einen Post, der in einer Gruppe stand und von keiner Regel
erfasst wurde: ein angebliches Handelshaus kauft große Mengen USDT/ETH/BTC,
verspricht 10–25 % garantierte Provision, zahlt angeblich vor, und bittet in
den Privatchat zu einer @-Kennung.

## 1. Warum es nicht gegriffen hat — gemessen, nicht geraten

Marcos Auflage war, zwei Fälle zu unterscheiden: nie geprüft, oder geprüft und
durchgelassen. **Beides trifft zu, und nur eines davon ist an den Regeln zu
beheben.**

### Der Text war in keiner Regel nah an der Schwelle

| Regelwerk | Ergebnis | Schwelle |
|---|---:|---:|
| Erstnachrichten-Prüfung (`firstMessageRisk`) | **30 Punkte** | 70 |
| Scam-Erkennung (`scam.ts`) | **10 Punkte** | 70 |
| Profilprüfung (`profileRisk`) | keine Maßnahme | — |

Die Erstnachrichten-Regel fand nur `kontakt_aufforderung`,
`englisch_in_deutscher_gruppe` und `sofort_nach_beitritt`. Ihr Wortschatz
deckt den **Handel mit Zahlungskonten** ab (Stripe, Square, KYC-Dokumente) —
dieser Fall ist ein anderer Betrugstyp, und für den war nichts da.

**Selbst bei perfekter Zustellung wäre der Post also durchgelaufen.** Das ist
der behebbare Teil und der Grund für `cryptoBuyRisk.ts`.

### Der Post ist im Bestand nicht auffindbar

Weder der Text noch der Absender stehen in der Datenbank. Das hat einen
Grund, der wichtiger ist als der Einzelfall — siehe Abschnitt 4.

### Zwei Dinge, die ich geprüft und ausgeschlossen habe

**Privacy Mode:** `getMe` meldet `can_read_all_group_messages: false`. Das
klingt zunächst nach der Erklärung — ein Bot mit Privacy Mode sieht in Gruppen
nur Kommandos und Erwähnungen. **Es ist aber keine:** Telegram hebt die
Einschränkung für Administratoren auf, und der Bot ist in **allen 56**
verwalteten Gruppen Administrator (`bot_is_admin = 1`, keine Ausnahme). Dort
sieht er alles.

**Nicht verwaltete Gruppen:** Acht Gruppen stehen auf `disabled`, darunter
`TRADING 212 PLATFORM LLC.`, `Wahrheits-Community - Gruppe (Krypto-Investition)`
und `Jjhhh` — offensichtlich Gruppen, in die der Bot hineingezogen wurde. Dort
greift keine Regel. Falls der Post dort stand, ist das kein Erkennungsfehler,
sondern eine bewusste Grenze.

## 2. Was jetzt greift

`src/cryptoBuyRisk.ts` erkennt die **Struktur** des Angebots, nicht seinen
Wortlaut. Firmennamen, Städte und Prozentzahlen stehen in keinem Muster.

| Gruppe | Woran sie erkennt | tragend |
|---|---|:---:|
| **A Ankauf** | „wir kaufen/erwerben", große Mengen, dringender Bedarf, Ansprache von Haltern | ja |
| **B Ertrag** | garantierte Provision, Prozentsatz, Spanne, „je Transaktion" | ja |
| **C Vorkasse** | Vorabzahlung, „wir zahlen zuerst", Coins erst nach Geldeingang, „risikofrei" | ja |
| **D Abwanderung** | Kontakt zu @-Kennung, Sofortkontakt, ausdrücklich privat | ja |
| **E Fassade** | Co./Ltd./GmbH, Sitzangabe, „weltweit" | **nein** |

**Für eine Sperre müssen drei Bedingungen zusammenkommen:** 90 Punkte,
mindestens 3 der 4 tragenden Gruppen — **und Gruppe A muss dabei sein.**

Die letzte Bedingung ist die wichtigste. Ohne sie träfe die Regel jeden, der
über Renditen, Provisionen und Vorkasse schreibt; in Gruppen, die „Geldhelden"
und „Bitcoin & alternative Währungen" heißen, ist das die halbe Unterhaltung.
Erst das Angebot, **große Mengen Coins anzukaufen**, macht aus einem
Finanzgespräch dieses Betrugsmuster.

Die Firmenfassade zählt nie als tragende Gruppe. Eine Firma, die sich
vorstellt, ist kein Betrüger.

Der gemeldete Post erreicht **375 Punkte bei 4 von 4** tragenden Gruppen.

## 3. Fehlalarme — die Zahl, ohne die die Regel nicht fertig ist

Gemessen am ausgelieferten Stand im Container, nicht lokal:

| Quelle | geprüfte Texte | Sperre | Meldung |
|---|---:|---:|---:|
| Gruppennachrichten seit 11.09. | 296 | 0 | 0 |
| Profil-Bios echter Mitglieder | 84 | 0 | 0 |
| **gesamt** | **380** (243 Konten) | **0** | **0** |

**Positivkontrolle:** Derselbe Messlauf bewertet den bekannten Betrugstext mit
375 Punkten und „sperren". Die Null ist also ein Befund und kein kaputtes
Skript — die Messstrecke kann treffen.

In den 23 Testfällen stehen zwölf Gegenbeispiele aus echten Krypto-Gesprächen:
privater Nachkauf, Kursgespräch, Börsenfrage, Renditegespräch, Botschafter mit
20 % Provision, Steuerfrage — und, als der Fall, den man leicht übersieht,
**eine Warnung vor genau diesem Betrug**. Wer andere warnt, darf nicht gesperrt
werden. Alle zwölf gehen durch.

## 4. Die Dunkelziffer — nicht bezifferbar, und das ist der eigentliche Befund

| | |
|---|---|
| Tage mit gespeichertem Nachrichtentext | **11** |
| Tage seit Bestehen | 254 |
| durchsuchbarer Anteil der Zeit | **rund 4 %** |
| und dort nur | die ersten fünf Nachrichten je Konto und Gruppe |

`scam_events` hat 2.116 Zeilen von 914 Konten seit Januar — **ohne Wortlaut**,
nur Punktzahl und Gründe. Alle übrigen Nachrichten aus 56 Gruppen und von
7.557 Mitgliedern existieren nirgends.

Telegram hilft dabei nicht: **Ein Bot kann keine Nachrichtenhistorie einer
Gruppe nachladen.** Es gibt keine Schnittstelle dafür.

Die Dunkelziffer ist also nicht durch mehr Rechenzeit zu ermitteln, sondern
grundsätzlich verloren. Ab heute schreibt die Krypto-Erkennung jeden Treffer
mit Wortlaut in `crypto_events` — in vier Wochen ist die Frage beantwortbar,
rückwirkend nie.

## 5. Betriebsart: meldet, sperrt nicht

```
CRYPTO_BUY_CHECK_ENABLED=true
CRYPTO_BUY_AUTO_BAN=false
```

Marcos Vorgabe war eindeutig: nichts löschen, niemanden sperren, Entscheidung
vorlegen. Jede Meldung geht mit dem Wortlaut und zwei Knöpfen in den
Admin-Chat — `🔴 KONTO SPERREN` und `✅ HARMLOS`. Bei drei oder mehr tragenden
Merkmalen trägt sie die Überschrift **„bitte entscheiden"**.

**Diesen Schalter legt keine Sitzung um.** Er steht hier nur, damit Marco ihn
findet, wenn er ihn will.

Ansehen mit `/krypto`. Die Zahlen dort sind `COUNT(DISTINCT user_id)`.

## 6. Ein Unterschied zu allen anderen Prüfungen

Die Erstnachrichten-Regel prüft nur die ersten fünf Nachrichten eines Kontos.
**Diese hier prüft jede Nachricht** — der Scam kommt auch von Konten, die
monatelang still mitgelesen haben. Genau deshalb ist die Fehlalarmfrage hier
schärfer gestellt und die Sperrbedingung enger.
