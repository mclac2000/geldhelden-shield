import sys

NEW_COMMANDS = r'''
// Command: /help oder /menu - Zeigt alle verfuegbaren Befehle
bot.command(['help', 'menu', 'start'], async (ctx: Context) => {
  await handleAdminCommand(ctx, 'help', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);
    const section = parts[0]?.toLowerCase();

    if (section === 'mod' || section === 'moderation') {
      await ctx.reply(
        `\u{1f6ab} <b>Moderation</b>\n\n` +
        `<code>/ban @username</code> \u2013 User global bannen\n` +
        `<code>/ban &lt;user_id&gt;</code> \u2013 User per ID bannen\n` +
        `<code>/unban @username</code> \u2013 User global entbannen\n` +
        `<code>/allow @username</code> \u2013 User auf Whitelist setzen\n` +
        `<code>/unrestrict @username</code> \u2013 Einschraenkungen entfernen\n` +
        `<code>/pardon @username</code> \u2013 Komplett-Begnadigung\n` +
        `<code>/status @username</code> \u2013 User-Status anzeigen\n\n` +
        `\u{1f4a1} Alle Commands funktionieren mit <code>@username</code> oder <code>user_id</code>`,
        { parse_mode: 'HTML' }
      );
    } else if (section === 'team') {
      await ctx.reply(
        `\u{1f465} <b>Team-Management</b>\n\n` +
        `<code>/team add @username</code> \u2013 Zum Team hinzufuegen\n` +
        `<code>/team remove @username</code> \u2013 Aus Team entfernen\n` +
        `<code>/team list</code> \u2013 Team-Mitglieder anzeigen\n` +
        `<code>/team import</code> \u2013 Bulk-Import`,
        { parse_mode: 'HTML' }
      );
    } else if (section === 'group' || section === 'gruppen') {
      await ctx.reply(
        `\u{1f4ca} <b>Gruppen-Verwaltung</b>\n\n` +
        `<code>/groups</code> \u2013 Alle verwalteten Gruppen\n` +
        `<code>/manage</code> \u2013 Gruppe als managed markieren\n` +
        `<code>/disable</code> \u2013 Gruppe deaktivieren\n` +
        `<code>/unmanage</code> \u2013 Aus Verwaltung entfernen\n` +
        `<code>/group status</code> \u2013 Gruppen-Konfiguration\n` +
        `<code>/groupconfig</code> \u2013 Komplette Konfiguration\n` +
        `<code>/whereami</code> \u2013 Chat-ID anzeigen`,
        { parse_mode: 'HTML' }
      );
    } else if (section === 'scam') {
      await ctx.reply(
        `\u{1f50d} <b>Scam-Erkennung</b>\n\n` +
        `<code>/scam on</code> / <code>off</code> \u2013 Ein/Ausschalten\n` +
        `<code>/scam action &lt;ban|restrict|warn&gt;</code> \u2013 Aktion\n` +
        `<code>/scam threshold &lt;0-100&gt;</code> \u2013 Schwellenwert\n` +
        `<code>/scamtest &lt;text&gt;</code> \u2013 Text testen`,
        { parse_mode: 'HTML' }
      );
    } else if (section === 'stats' || section === 'statistik') {
      await ctx.reply(
        `\u{1f4c8} <b>Statistiken & Diagnose</b>\n\n` +
        `<code>/stats</code> \u2013 Globale Statistiken\n` +
        `<code>/stats group</code> \u2013 Gruppen-Statistiken\n` +
        `<code>/weekly</code> \u2013 Wochenbericht\n` +
        `<code>/diag</code> \u2013 Diagnose\n` +
        `<code>/dbcheck</code> \u2013 Datenbank pruefen\n` +
        `<code>/health</code> \u2013 Health-Check`,
        { parse_mode: 'HTML' }
      );
    } else if (section === 'system' || section === 'config') {
      await ctx.reply(
        `\u{2699}\u{fe0f} <b>System & Konfiguration</b>\n\n` +
        `<code>/shield status</code> \u2013 Bot-Status\n` +
        `<code>/dryrun</code> \u2013 Dry-Run Modus\n` +
        `<code>/panic on</code>/<code>off</code> \u2013 Notfall-Modus\n` +
        `<code>/scan baseline</code> \u2013 Member-Scan\n` +
        `<code>/setref &lt;code&gt;</code> \u2013 Ref-Code setzen\n` +
        `<code>/setpartner &lt;type&gt;</code> \u2013 Partner-Typ\n` +
        `<code>/setlocation &lt;ort&gt;</code> \u2013 Standort`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply(
        `\u{1f6e1}\u{fe0f} <b>Geldhelden Shield Bot</b>\n` +
        `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n` +
        `<b>\u26a1 Schnellbefehle:</b>\n` +
        `<code>/ban @username</code> \u2013 User bannen\n` +
        `<code>/unban @username</code> \u2013 User entbannen\n` +
        `<code>/status @username</code> \u2013 User-Info\n` +
        `<code>/allow @username</code> \u2013 User erlauben\n\n` +
        `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
        `<b>\u{1f4d6} Detail-Hilfe nach Kategorie:</b>\n\n` +
        `<code>/help mod</code> \u2013 \u{1f6ab} Moderation\n` +
        `<code>/help team</code> \u2013 \u{1f465} Team-Management\n` +
        `<code>/help group</code> \u2013 \u{1f4ca} Gruppen-Verwaltung\n` +
        `<code>/help scam</code> \u2013 \u{1f50d} Scam-Erkennung\n` +
        `<code>/help stats</code> \u2013 \u{1f4c8} Statistiken\n` +
        `<code>/help system</code> \u2013 \u{2699}\u{fe0f} System\n\n` +
        `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
        `\u{1f916} <i>Geldhelden Shield v1.0</i>`,
        { parse_mode: 'HTML' }
      );
    }
  });
});

// Command: /ban <user_id|@username> - Bannt User global in allen managed Groups
bot.command('ban', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'ban', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);

    if (parts.length < 1) {
      await ctx.reply(
        '\u274c Ungueltige Verwendung.\n\n' +
        'Format:\n' +
        '\u2022 /ban @username\n' +
        '\u2022 /ban <user_id>\n\n' +
        'Beispiel: /ban @scammer123'
      );
      return;
    }

    await handleBanCommand(ctx, parts[0]);
  });
});

// Command: /allow <user_id|@username> - Erlaubt User (Whitelist)
bot.command('allow', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'allow', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);

    if (parts.length < 1) {
      await ctx.reply('\u274c Ungueltige Verwendung. Format: /allow <user_id|@username>');
      return;
    }

    await handleAllowCommand(ctx, parts[0]);
  });
});

// Command: /status <user_id|@username> - Zeigt User-Status
bot.command('status', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'status', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);

    if (parts.length < 1) {
      await ctx.reply('\u274c Ungueltige Verwendung. Format: /status <user_id|@username>');
      return;
    }

    const { handleStatusCommand } = await import('./admin');
    await handleStatusCommand(ctx, parts[0]);
  });
});

// Command: /unrestrict <user_id|@username> - Entfernt Einschraenkungen
bot.command('unrestrict', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'unrestrict', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);

    if (parts.length < 1) {
      await ctx.reply('\u274c Ungueltige Verwendung. Format: /unrestrict <user_id|@username>');
      return;
    }

    await handleUnrestrictCommand(ctx, parts[0]);
  });
});

// Command: /pardon <user_id|@username> - Begnadigt User
bot.command('pardon', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'pardon', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);

    if (parts.length < 1) {
      await ctx.reply('\u274c Ungueltige Verwendung. Format: /pardon <user_id|@username>');
      return;
    }

    await handlePardonCommand(ctx, parts[0]);
  });
});

// Command: /groups - Zeigt alle verwalteten Gruppen
bot.command('groups', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'groups', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);
    await handleGroupsCommand(ctx, parts[0]);
  });
});

// Command: /manage - Gruppe als managed markieren
bot.command('manage', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'manage', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);
    await handleManageCommand(ctx, parts[0] || '');
  });
});

// Command: /disable - Gruppe deaktivieren
bot.command('disable', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'disable', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);
    await handleDisableCommand(ctx, parts[0] || '');
  });
});

// Command: /unmanage - Gruppe aus Verwaltung entfernen
bot.command('unmanage', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'unmanage', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);
    await handleUnmanageCommand(ctx, parts[0] || '');
  });
});

// Command: /stats - Zeigt Statistiken
bot.command('stats', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'stats', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);

    if (parts.length > 0 && parts[0] === 'group') {
      await handleStatsGroupCommand(ctx, parts[1]);
    } else {
      await handleStatsCommand(ctx, parts[0]);
    }
  });
});

// Command: /weekly - Wochenbericht
bot.command('weekly', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'weekly', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);

    if (parts[0] === 'last') {
      await handleWeeklyLastCommand(ctx, parts);
    } else {
      await handleWeeklyPreviewCommand(ctx, parts);
    }
  });
});

// Command: /diag - Diagnose
bot.command('diag', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'diag', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);
    await handleDiagCommand(ctx, parts);
  });
});

// Command: /dbcheck - Datenbank-Integritaetspruefung
bot.command('dbcheck', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'dbcheck', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);
    await handleDbCheckCommand(ctx, parts);
  });
});

// Command: /whereami - Zeigt Chat-ID und Gruppe
bot.command('whereami', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'whereami', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);
    await handleWhereAmICommand(ctx, parts);
  });
});

// Command: /myref - Zeigt eigenen Referral-Code
bot.command('myref', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'myref', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);
    await handleMyRefCommand(ctx, parts[0]);
  });
});

// Command: /clearref - Loescht Referral-Code
bot.command('clearref', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'clearref', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);
    await handleClearRefCommand(ctx, parts);
  });
});
'''

filepath = '/root/Geldhelden Shield/src/index.ts'
marker = '// Command: /unban <user_id|@username>'

with open(filepath, 'r') as f:
    content = f.read()

if marker in content:
    content = content.replace(marker, NEW_COMMANDS.rstrip() + '\n\n' + marker)
    with open(filepath, 'w') as f:
        f.write(content)
    print('SUCCESS: All commands inserted before /unban')
else:
    print('ERROR: Marker not found')
    sys.exit(1)
