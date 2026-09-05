import { bewerteErstnachricht, entscheideErstnachricht, SCHWELLE_ALARM, SCHWELLE_SPERRE } from '../src/firstMessageRisk';
console.log(`Schwellen: Alarm ab ${SCHWELLE_ALARM}, Sperre ab ${SCHWELLE_SPERRE} Punkten\n`);
for (const [nr, text] of [[1,'Hi'],[2,'I want to make money']] as Array<[number,string]>) {
  const b = bewerteErstnachricht({ text, anzeigename: 'Mehdi', minutenSeitBeitritt: 0.2, nachrichtNr: nr });
  const u = entscheideErstnachricht(b);
  console.log(`Nachricht ${nr}: ${JSON.stringify(text)}`);
  console.log(`  Punkte: ${b.punkte} | inhaltliche Gruppen: ${b.inhaltlicheGruppen} | Massnahme: ${u.massnahme || 'keine'}`);
  console.log(`  Signale: ${b.signale.join(', ') || '(keine)'}`);
  b.belege.forEach(x => console.log(`    - ${x}`));
}
// Auch beide zusammen betrachtet
const zus = bewerteErstnachricht({ text: 'Hi\nI want to make money', anzeigename: 'Mehdi', minutenSeitBeitritt: 0.2, nachrichtNr: 1 });
console.log(`\nBeide zusammen: ${zus.punkte} Punkte, ${zus.inhaltlicheGruppen} inhaltliche Gruppen -> ${entscheideErstnachricht(zus).massnahme || 'keine'}`);
