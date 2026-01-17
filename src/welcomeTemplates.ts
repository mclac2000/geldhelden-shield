/**
 * Welcome Template System
 * 
 * Zentrale Begrüßungslogik mit Brand-spezifischen Templates und Affiliate-Engine
 */

import { getGroup, getGroupProfile } from './db';
import { getDatabase } from './db';
import { RiskLevel } from './db';

export type Brand = 'geldhelden' | 'staatenlos' | 'mixed';

export interface WelcomeTemplate {
  id: number;
  brand: Brand;
  risk_level: RiskLevel;
  template_text: string;
  created_at: number;
  updated_at: number;
}

// Default Templates (werden beim ersten Start eingefügt)
// CLEAN / LOW (Standard)
const DEFAULT_TEMPLATES_CLEAN_LOW: Record<Brand, string> = {
  geldhelden: `Hey {first} 👋

Willkommen bei den Geldhelden{location}!
👉 Stell dich kurz vor und sag, was dich hierher geführt hat.

⚠️ Hinweis:
Admins schreiben dich niemals privat an.

🔗 Mehr Infos: {link}`,

  staatenlos: `Hey {first} 👋

Willkommen beim Staatenlos Meetup{location}!
👉 Stell dich kurz vor und sag, was dich hierher geführt hat.

⚠️ Hinweis:
Admins schreiben dich niemals privat an.

🔗 Mehr Infos: {link}`,

  mixed: `Hey {first} 👋

Willkommen beim Geldhelden × Staatenlos Meetup{location}!
👉 Stell dich kurz vor und sag, was dich hierher geführt hat.

⚠️ Hinweis:
Admins schreiben dich niemals privat an.

🔗 Mehr Infos: {link}`,
};

// MEDIUM (leicht auffällig, neutral)
const DEFAULT_TEMPLATES_MEDIUM: Record<Brand, string> = {
  geldhelden: `Hey {first} 👋

Willkommen bei den Geldhelden{location}!
👉 Stell dich bitte kurz vor.

⚠️ Wichtig:
Bitte achte darauf, keine Links oder privaten Angebote zu posten.
Admins schreiben dich niemals privat an.

🔗 Infos: {link}`,

  staatenlos: `Hey {first} 👋

Willkommen beim Staatenlos Meetup{location}!
👉 Stell dich bitte kurz vor.

⚠️ Wichtig:
Bitte achte darauf, keine Links oder privaten Angebote zu posten.
Admins schreiben dich niemals privat an.

🔗 Infos: {link}`,

  mixed: `Hey {first} 👋

Willkommen beim Geldhelden × Staatenlos Meetup{location}!
👉 Stell dich bitte kurz vor.

⚠️ Wichtig:
Bitte achte darauf, keine Links oder privaten Angebote zu posten.
Admins schreiben dich niemals privat an.

🔗 Infos: {link}`,
};

// HIGH (deutliches Risiko, ohne Anschuldigung)
const DEFAULT_TEMPLATES_HIGH: Record<Brand, string> = {
  geldhelden: `Hey {first} 👋

Willkommen bei den Geldhelden{location}.

⚠️ Kurzer Hinweis:
In dieser Gruppe sind keine Direktnachrichten, Angebote oder Links erlaubt.
Admins schreiben dich niemals privat an.

👉 Stell dich bitte kurz vor, bevor du aktiv wirst.`,

  staatenlos: `Hey {first} 👋

Willkommen beim Staatenlos Meetup{location}.

⚠️ Kurzer Hinweis:
In dieser Gruppe sind keine Direktnachrichten, Angebote oder Links erlaubt.
Admins schreiben dich niemals privat an.

👉 Stell dich bitte kurz vor, bevor du aktiv wirst.`,

  mixed: `Hey {first} 👋

Willkommen beim Geldhelden × Staatenlos Meetup{location}.

⚠️ Kurzer Hinweis:
In dieser Gruppe sind keine Direktnachrichten, Angebote oder Links erlaubt.
Admins schreiben dich niemals privat an.

👉 Stell dich bitte kurz vor, bevor du aktiv wirst.`,
};

/**
 * Initialisiert Default-Templates in der DB
 */
export function initDefaultTemplates(): void {
  const db = getDatabase();
  const now = Date.now();
  
  // CLEAN / LOW Templates
  for (const [brand, templateText] of Object.entries(DEFAULT_TEMPLATES_CLEAN_LOW)) {
    const existing = db.prepare('SELECT id FROM welcome_templates WHERE brand = ? AND risk_level = ?').get(brand, "CLEAN");
    
    if (!existing) {
      const stmt = db.prepare(`
        INSERT INTO welcome_templates (brand, risk_level, template_text, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(brand, "CLEAN", templateText, now, now);
      console.log(`[WELCOME_TEMPLATES] Default template für ${brand} (CLEAN) erstellt`);
    }
  }
  
  // MEDIUM Templates
  for (const [brand, templateText] of Object.entries(DEFAULT_TEMPLATES_MEDIUM)) {
    const existing = db.prepare('SELECT id FROM welcome_templates WHERE brand = ? AND risk_level = ?').get(brand, "MEDIUM");
    
    if (!existing) {
      const stmt = db.prepare(`
        INSERT INTO welcome_templates (brand, risk_level, template_text, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(brand, "MEDIUM", templateText, now, now);
      console.log(`[WELCOME_TEMPLATES] Default template für ${brand} (MEDIUM) erstellt`);
    }
  }
  
  // HIGH Templates
  for (const [brand, templateText] of Object.entries(DEFAULT_TEMPLATES_HIGH)) {
    const existing = db.prepare('SELECT id FROM welcome_templates WHERE brand = ? AND risk_level = ?').get(brand, "HIGH");
    
    if (!existing) {
      const stmt = db.prepare(`
        INSERT INTO welcome_templates (brand, risk_level, template_text, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(brand, "HIGH", templateText, now, now);
      console.log(`[WELCOME_TEMPLATES] Default template für ${brand} (HIGH) erstellt`);
    }
  }
}

/**
 * Holt Template für einen Brand und Risk-Level
 */
export function getTemplateForBrandAndRisk(brand: Brand, riskLevel: RiskLevel): string {
  const db = getDatabase();
  
  // Versuche Template für spezifisches Risk-Level zu finden
  const stmt = db.prepare('SELECT template_text FROM welcome_templates WHERE brand = ? AND risk_level = ?');
  const result = stmt.get(brand, riskLevel) as { template_text: string } | undefined;
  
  if (result) {
    return result.template_text;
  }
  
  // Fallback: CLEAN Template
  const fallbackStmt = db.prepare('SELECT template_text FROM welcome_templates WHERE brand = ? AND risk_level = ?');
  const fallbackResult = fallbackStmt.get(brand, "CLEAN") as { template_text: string } | undefined;
  
  if (fallbackResult) {
    return fallbackResult.template_text;
  }
  
  // Final Fallback: Hardcoded Template
  // Hilfsfunktion für Risk-Level-Vergleich
  const riskLevelOrder: Record<RiskLevel, number> = { "CLEAN": 0, "LOW": 1, "MEDIUM": 2, "HIGH": 3 };
  const currentOrder = riskLevelOrder[riskLevel];
  if (currentOrder >= riskLevelOrder["HIGH"]) {
    return DEFAULT_TEMPLATES_HIGH[brand];
  } else if (currentOrder >= riskLevelOrder["MEDIUM"]) {
    return DEFAULT_TEMPLATES_MEDIUM[brand];
  } else {
    return DEFAULT_TEMPLATES_CLEAN_LOW[brand];
  }
}

/**
 * Rendert Welcome-Text mit Platzhaltern
 */
export function renderWelcomeText(
  template: string,
  variables: {
    first: string;
    location?: string;
    brand?: string;
    link: string;
    admins?: string;
  }
): string {
  let text = template;
  
  // {first}
  text = text.replace(/{first}/g, variables.first || 'Freund');
  
  // {location}
  if (variables.location) {
    text = text.replace(/{location}/g, ` in ${variables.location}`);
  } else {
    text = text.replace(/{location}/g, '');
  }
  
  // {brand}
  if (variables.brand) {
    text = text.replace(/{brand}/g, variables.brand);
  } else {
    text = text.replace(/{brand}/g, 'Geldhelden');
  }
  
  // {link}
  text = text.replace(/{link}/g, variables.link);
  
  // {admins}
  const adminsText = variables.admins || 'Admins schreiben dich niemals privat an';
  text = text.replace(/{admins}/g, adminsText);
  
  return text;
}

/**
 * Generiert Location-String für Welcome
 */
export function formatLocation(location: string | null): string {
  if (!location || location.trim().length === 0) {
    return '';
  }
  
  // Normalisiere Location (entferne führende/trailing Leerzeichen)
  return location.trim();
}
