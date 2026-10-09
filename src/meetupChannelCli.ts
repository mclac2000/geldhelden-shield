/**
 * Manueller Versand der Kanal-Ankündigung (gleicher Doppelversand-Schutz wie
 * der Scheduler). Aufruf im Container:
 *   node dist/meetupChannelCli.js preview tag|vortag
 *   node dist/meetupChannelCli.js send tag|vortag
 */
import { Telegraf } from 'telegraf';
import { buildChannelPoll, buildChannelText, nextChannelMeetupDate, sendChannelAnnouncement, ChannelWave } from './meetupChannel';

async function main() {
  const [cmd, waveArg] = process.argv.slice(2);
  const wave = (waveArg === 'vortag' ? 'vortag' : 'tag') as ChannelWave;
  const date = nextChannelMeetupDate();
  if (!date) throw new Error('kein Termin');
  if (cmd === 'preview') {
    console.log(buildChannelText(wave, date, process.env.MEETUP_CHANNEL_LINK || 'https://www.airmeet.com/e/8ca48df0-fd79-11f0-ace7-c7ef52349391'));
    console.log('---');
    console.log(JSON.stringify(buildChannelPoll(wave, date), null, 1));
    return;
  }
  if (cmd !== 'send') throw new Error('Befehl: preview|send');
  const bot = new Telegraf(process.env.BOT_TOKEN as string);
  const r = await sendChannelAnnouncement(bot, wave, date);
  console.log(JSON.stringify(r));
}
main().then(() => process.exit(0)).catch(e => { console.error(e?.message || e); process.exit(1); });
