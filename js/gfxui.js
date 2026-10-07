// Pair Sum — Graphics section of the Settings screen.
// Quality preset, render scale, per-effect overrides, adaptive resolution,
// frame-rate readout and a live cost summary. Strings are localized from the
// browser language (the rest of the game is English-only).

import { CATEGORIES, PRESETS, presetTier, choosePreset } from './gfx.js';

const en = {
  sh: { signIn: 'Sign in with StarHermit', signInHint: 'Sync your progress and settings.', invite: 'Invite a friend', inviteHint: 'Copy your invite link.', copied: 'Invite link copied to the clipboard.', copyFailed: 'Could not copy the invite link.', signedOut: 'Signed out — playing locally.', lbPosting: "Posting score to the leaderboard…", lbRank: "Leaderboard rank: #{rank}", lbPosted: "Score posted to the leaderboard.", lbNotPosted: "Score not posted to the leaderboard." },
  section: 'Graphics', quality: 'Quality', auto: 'Auto (detected: {tier})',
  low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra',
  scale: 'Render scale', fromPreset: 'From preset ({tier})',
  adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
  postFailed: 'Post-processing is unavailable on this device; the board renders without it.',
  noGpu: 'unknown GPU', no3d: '3D view unavailable — effects are off.',
  cat: { shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Colour grade', antialias: 'Anti-aliasing',
    particles: 'Particles', background: 'Ambient motion', detail: 'Surface detail' },
  tier: { off: 'Off', on: 'On', low: 'Low', medium: 'Medium', high: 'High', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
    plain: 'Plain', detailed: 'Detailed', static: 'Static', animated: 'Animated' },
  cost: { noShadows: 'no shadows', shadows: '{n}² shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion',
    bloom: 'bloom', grade: 'colour grade', noAA: 'no anti-aliasing', particles: 'dense particles', animated: 'ambient motion' },
};

const STRINGS = {
  'en-US': { ...en, cat: { ...en.cat, grade: 'Color grade' }, cost: { ...en.cost, grade: 'color grade' } },
  'en-GB': { ...en, sh: { signIn: 'Sign in with StarHermit', signInHint: 'Sync your progress and settings.', invite: 'Invite a friend', inviteHint: 'Copy your invite link.', copied: 'Invite link copied to the clipboard.', copyFailed: 'Couldn’t copy the invite link.', signedOut: 'Signed out — playing locally.', lbPosting: "Posting score to the leaderboard…", lbRank: "Leaderboard rank: #{rank}", lbPosted: "Score posted to the leaderboard.", lbNotPosted: "Score not posted to the leaderboard." } },
  'es-419': {
    sh: { signIn: 'Iniciar sesión con StarHermit', signInHint: 'Sincroniza tu progreso y tus ajustes.', invite: 'Invitar a un amigo', inviteHint: 'Copia tu enlace de invitación.', copied: 'Enlace de invitación copiado al portapapeles.', copyFailed: 'No se pudo copiar el enlace de invitación.', signedOut: 'Sesión cerrada: juegas en modo local.', lbPosting: "Enviando la puntuación a la clasificación…", lbRank: "Puesto en la clasificación: #{rank}", lbPosted: "Puntuación enviada a la clasificación.", lbNotPosted: "No se envió la puntuación a la clasificación." },
    section: 'Gráficos', quality: 'Calidad', auto: 'Automática (detectada: {tier})',
    low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
    scale: 'Escala de render', fromPreset: 'Según calidad ({tier})',
    adaptive: 'Resolución adaptativa', showFps: 'Mostrar FPS',
    postFailed: 'El posprocesado no está disponible en este dispositivo; el tablero se muestra sin él.',
    noGpu: 'GPU desconocida', no3d: 'Vista 3D no disponible: efectos desactivados.',
    cat: { shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Corrección de color', antialias: 'Antialiasing',
      particles: 'Partículas', background: 'Movimiento ambiental', detail: 'Detalle de superficies' },
    tier: { off: 'No', on: 'Sí', low: 'Baja', medium: 'Media', high: 'Alta', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
      plain: 'Simple', detailed: 'Detallado', static: 'Estático', animated: 'Animado' },
    cost: { noShadows: 'sin sombras', shadows: 'sombras {n}²', ao: 'oclusión ambiental', aoHigh: 'oclusión ambiental completa',
      bloom: 'resplandor', grade: 'corrección de color', noAA: 'sin antialiasing', particles: 'muchas partículas', animated: 'movimiento ambiental' },
  },
  'de-DE': {
    sh: { signIn: 'Mit StarHermit anmelden', signInHint: 'Fortschritt und Einstellungen synchronisieren.', invite: 'Freund einladen', inviteHint: 'Einladungslink kopieren.', copied: 'Einladungslink in die Zwischenablage kopiert.', copyFailed: 'Einladungslink konnte nicht kopiert werden.', signedOut: 'Abgemeldet – du spielst lokal weiter.', lbPosting: "Punktzahl wird an die Bestenliste gesendet …", lbRank: "Platz in der Bestenliste: #{rank}", lbPosted: "Punktzahl an die Bestenliste gesendet.", lbNotPosted: "Punktzahl nicht an die Bestenliste gesendet." },
    section: 'Grafik', quality: 'Qualität', auto: 'Automatisch (erkannt: {tier})',
    low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra',
    scale: 'Renderskalierung', fromPreset: 'Laut Voreinstellung ({tier})',
    adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
    postFailed: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar; das Spielfeld wird ohne sie dargestellt.',
    noGpu: 'unbekannte GPU', no3d: '3D-Ansicht nicht verfügbar – Effekte sind aus.',
    cat: { shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Leuchteffekt', grade: 'Farbkorrektur', antialias: 'Kantenglättung',
      particles: 'Partikel', background: 'Umgebungsbewegung', detail: 'Oberflächendetails' },
    tier: { off: 'Aus', on: 'An', low: 'Niedrig', medium: 'Mittel', high: 'Hoch', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
      plain: 'Schlicht', detailed: 'Detailliert', static: 'Statisch', animated: 'Animiert' },
    cost: { noShadows: 'keine Schatten', shadows: '{n}²-Schatten', ao: 'Umgebungsverdeckung', aoHigh: 'volle Umgebungsverdeckung',
      bloom: 'Leuchteffekt', grade: 'Farbkorrektur', noAA: 'keine Kantenglättung', particles: 'viele Partikel', animated: 'Umgebungsbewegung' },
  },
  'fr-FR': {
    sh: { signIn: 'Se connecter avec StarHermit', signInHint: 'Synchronisez progression et réglages.', invite: 'Inviter un ami', inviteHint: 'Copier votre lien d’invitation.', copied: 'Lien d’invitation copié dans le presse-papiers.', copyFailed: 'Impossible de copier le lien d’invitation.', signedOut: 'Déconnecté — vous jouez en local.', lbPosting: "Envoi du score au classement…", lbRank: "Rang au classement : #{rank}", lbPosted: "Score envoyé au classement.", lbNotPosted: "Score non envoyé au classement." },
    section: 'Graphismes', quality: 'Qualité', auto: 'Auto (détectée : {tier})',
    low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra',
    scale: 'Échelle de rendu', fromPreset: 'Selon le préréglage ({tier})',
    adaptive: 'Résolution adaptative', showFps: 'Afficher les IPS',
    postFailed: 'Le post-traitement est indisponible sur cet appareil ; le plateau s’affiche sans.',
    noGpu: 'GPU inconnu', no3d: 'Vue 3D indisponible : effets désactivés.',
    cat: { shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Halo lumineux', grade: 'Étalonnage des couleurs', antialias: 'Anticrénelage',
      particles: 'Particules', background: 'Mouvement d’ambiance', detail: 'Détail des surfaces' },
    tier: { off: 'Non', on: 'Oui', low: 'Basse', medium: 'Moyenne', high: 'Haute', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
      plain: 'Simple', detailed: 'Détaillé', static: 'Statique', animated: 'Animé' },
    cost: { noShadows: 'sans ombres', shadows: 'ombres {n}²', ao: 'occlusion ambiante', aoHigh: 'occlusion ambiante complète',
      bloom: 'halo', grade: 'étalonnage', noAA: 'sans anticrénelage', particles: 'particules denses', animated: 'mouvement d’ambiance' },
  },
  'pt-BR': {
    sh: { signIn: 'Entrar com StarHermit', signInHint: 'Sincronize seu progresso e suas configurações.', invite: 'Convidar um amigo', inviteHint: 'Copie seu link de convite.', copied: 'Link de convite copiado para a área de transferência.', copyFailed: 'Não foi possível copiar o link de convite.', signedOut: 'Sessão encerrada — jogando localmente.', lbPosting: "Enviando a pontuação para o ranking…", lbRank: "Posição no ranking: #{rank}", lbPosted: "Pontuação enviada para o ranking.", lbNotPosted: "A pontuação não foi enviada para o ranking." },
    section: 'Gráficos', quality: 'Qualidade', auto: 'Automática (detectada: {tier})',
    low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
    scale: 'Escala de renderização', fromPreset: 'Conforme a qualidade ({tier})',
    adaptive: 'Resolução adaptativa', showFps: 'Mostrar FPS',
    postFailed: 'O pós-processamento não está disponível neste aparelho; o tabuleiro é exibido sem ele.',
    noGpu: 'GPU desconhecida', no3d: 'Visão 3D indisponível — efeitos desligados.',
    cat: { shadows: 'Sombras', ao: 'Oclusão ambiente', bloom: 'Brilho', grade: 'Correção de cor', antialias: 'Antisserrilhamento',
      particles: 'Partículas', background: 'Movimento ambiente', detail: 'Detalhe das superfícies' },
    tier: { off: 'Desligado', on: 'Ligado', low: 'Baixa', medium: 'Média', high: 'Alta', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
      plain: 'Simples', detailed: 'Detalhado', static: 'Estático', animated: 'Animado' },
    cost: { noShadows: 'sem sombras', shadows: 'sombras {n}²', ao: 'oclusão ambiente', aoHigh: 'oclusão ambiente completa',
      bloom: 'brilho', grade: 'correção de cor', noAA: 'sem antisserrilhamento', particles: 'muitas partículas', animated: 'movimento ambiente' },
  },
  'it-IT': {
    sh: { signIn: 'Accedi con StarHermit', signInHint: 'Sincronizza progressi e impostazioni.', invite: 'Invita un amico', inviteHint: 'Copia il tuo link di invito.', copied: 'Link di invito copiato negli appunti.', copyFailed: 'Impossibile copiare il link di invito.', signedOut: 'Disconnesso: giochi in locale.', lbPosting: "Invio del punteggio alla classifica…", lbRank: "Posizione in classifica: #{rank}", lbPosted: "Punteggio inviato alla classifica.", lbNotPosted: "Punteggio non inviato alla classifica." },
    section: 'Grafica', quality: 'Qualità', auto: 'Automatica (rilevata: {tier})',
    low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra',
    scale: 'Scala di rendering', fromPreset: 'Da preimpostazione ({tier})',
    adaptive: 'Risoluzione adattiva', showFps: 'Mostra FPS',
    postFailed: 'La post-elaborazione non è disponibile su questo dispositivo; il tabellone viene mostrato senza.',
    noGpu: 'GPU sconosciuta', no3d: 'Vista 3D non disponibile: effetti disattivati.',
    cat: { shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore', grade: 'Correzione colore', antialias: 'Antialiasing',
      particles: 'Particelle', background: 'Movimento ambientale', detail: 'Dettaglio superfici' },
    tier: { off: 'No', on: 'Sì', low: 'Bassa', medium: 'Media', high: 'Alta', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
      plain: 'Semplice', detailed: 'Dettagliato', static: 'Statico', animated: 'Animato' },
    cost: { noShadows: 'senza ombre', shadows: 'ombre {n}²', ao: 'occlusione ambientale', aoHigh: 'occlusione ambientale completa',
      bloom: 'bagliore', grade: 'correzione colore', noAA: 'senza antialiasing', particles: 'molte particelle', animated: 'movimento ambientale' },
  },
};
STRINGS['es-ES'] = {
  ...STRINGS['es-419'],
  sh: { signIn: 'Iniciar sesión con StarHermit', signInHint: 'Sincroniza tu progreso y tus ajustes.', invite: 'Invitar a un amigo', inviteHint: 'Copia tu enlace de invitación.', copied: 'Enlace de invitación copiado al portapapeles.', copyFailed: 'No se ha podido copiar el enlace de invitación.', signedOut: 'Sesión cerrada: juegas en local.', lbPosting: "Enviando la puntuación a la clasificación…", lbRank: "Puesto en la clasificación: #{rank}", lbPosted: "Puntuación enviada a la clasificación.", lbNotPosted: "No se ha enviado la puntuación a la clasificación." },
  scale: 'Escala de renderizado', showFps: 'Mostrar fotogramas por segundo',
  postFailed: 'El posprocesado no está disponible en este dispositivo; el tablero se muestra sin él.',
  cat: { ...STRINGS['es-419'].cat, antialias: 'Suavizado de bordes' },
  cost: { ...STRINGS['es-419'].cost, noAA: 'sin suavizado' },
};
STRINGS['fr-CA'] = {
  ...STRINGS['fr-FR'],
  sh: { signIn: 'Se connecter avec StarHermit', signInHint: 'Synchronisez votre progression et vos paramètres.', invite: 'Inviter un ami', inviteHint: 'Copier votre lien d’invitation.', copied: 'Lien d’invitation copié dans le presse-papiers.', copyFailed: 'Impossible de copier le lien d’invitation.', signedOut: 'Déconnecté — vous jouez en local.', lbPosting: "Envoi du pointage au classement…", lbRank: "Rang au classement : #{rank}", lbPosted: "Pointage envoyé au classement.", lbNotPosted: "Pointage non envoyé au classement." },
  showFps: 'Afficher les images/s',
  cat: { ...STRINGS['fr-FR'].cat, background: 'Mouvement ambiant' },
  cost: { ...STRINGS['fr-FR'].cost, animated: 'mouvement ambiant' },
};

export const GFX_LOCALES = Object.keys(STRINGS);

/** Pick the closest supported locale for a BCP-47 tag (default en-US). */
export function pickLocale(tag) {
  const t = String(tag || '').replace('_', '-');
  const exact = GFX_LOCALES.find((l) => l.toLowerCase() === t.toLowerCase());
  if (exact) return exact;
  const lang = t.split('-')[0].toLowerCase();
  const region = (t.split('-')[1] || '').toUpperCase();
  if (lang === 'en') return ['GB', 'IE', 'AU', 'NZ', 'ZA', 'IN'].includes(region) ? 'en-GB' : 'en-US';
  if (lang === 'es') return region === 'ES' ? 'es-ES' : 'es-419';
  if (lang === 'fr') return region === 'CA' ? 'fr-CA' : 'fr-FR';
  if (lang === 'pt') return 'pt-BR';
  if (lang === 'de') return 'de-DE';
  if (lang === 'it') return 'it-IT';
  return 'en-US';
}

export function gfxStrings(tag = typeof navigator !== 'undefined' ? navigator.language : 'en-US') {
  const loc = pickLocale(tag);
  return { locale: loc, ...STRINGS[loc] };
}

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
}

/**
 * Render the Graphics section into `host`.
 * api: { saved(): object, set(saved), info(labels): {gpu, detected, resolved, summary, postFailed} | null, detected(): tier }
 */
export function renderGraphicsSection(host, api) {
  const L = gfxStrings();
  const tierName = (p) => L[p] || p;
  host.innerHTML = '';
  host.setAttribute('lang', L.locale);
  const saved = api.saved() || {};
  const info = api.info(L.cost);
  const detected = info?.detected || api.detected();
  const current = info?.resolved || null;
  const activePreset = current?.preset || (PRESETS.includes(saved.preset) ? saved.preset : detected);
  const commit = (next) => {
    const focusId = document.activeElement?.id;
    api.set(next);
    renderGraphicsSection(host, api);
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  };
  const row = (id, label, control, extra) => el('div', { class: 'set-row gfx-row' }, el('label', { for: id, text: label }), control, extra);

  // Quality preset: choosing one clears the per-effect overrides.
  const presetSel = el('select', {
    id: 'gfx-preset', 'data-gfx': 'preset',
    onchange: (e) => commit(choosePreset(api.saved(), e.target.value)),
  });
  presetSel.append(el('option', { value: 'auto', selected: !PRESETS.includes(saved.preset) }, L.auto.replace('{tier}', tierName(detected))));
  for (const p of PRESETS) presetSel.append(el('option', { value: p, selected: saved.preset === p }, tierName(p)));

  const scalePct = Math.round((Number(saved.render_scale) || 1) * 100);
  const scaleOut = el('output', { id: 'gfx-scale-value', for: 'gfx-scale', class: 'gfx-scale-value', text: `${scalePct}%` });
  const scale = el('input', {
    id: 'gfx-scale', 'data-gfx': 'render_scale', type: 'range', min: '50', max: '200', step: '10', value: String(scalePct),
    oninput: (e) => { scaleOut.textContent = `${e.target.value}%`; },
    onchange: (e) => commit({ ...api.saved(), render_scale: Number(e.target.value) / 100 }),
  });

  host.append(
    el('div', { class: 'set-group', id: 'gfx-heading', text: L.section }),
    row('gfx-preset', L.quality, presetSel),
    row('gfx-scale', L.scale, el('span', { class: 'gfx-scale-wrap' }, scale, scaleOut)),
  );

  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    const sel = el('select', {
      id: `gfx-cat-${cat}`, 'data-gfx': cat,
      onchange: (e) => {
        const next = { ...api.saved() };
        if (e.target.value === 'preset') delete next[cat];
        else next[cat] = e.target.value;
        commit(next);
      },
    });
    const own = presetTier(activePreset, cat);
    sel.append(el('option', { value: 'preset', selected: !tiers.includes(saved[cat]) }, L.fromPreset.replace('{tier}', L.tier[own] || own)));
    for (const t of tiers) sel.append(el('option', { value: t, selected: saved[cat] === t }, L.tier[t] || t));
    host.append(row(`gfx-cat-${cat}`, L.cat[cat], sel));
  }

  const check = (id, key, on, label) => row(id, label, el('input', {
    id, type: 'checkbox', 'data-gfx': key, checked: on,
    onchange: (e) => commit({ ...api.saved(), [key]: e.target.checked }),
  }));
  host.append(
    check('gfx-adaptive', 'adaptive', saved.adaptive !== false, L.adaptive),
    check('gfx-fps', 'show_fps', !!saved.show_fps, L.showFps),
  );

  const summary = el('p', { id: 'gfx-summary', class: 'gfx-summary', 'aria-live': 'polite' });
  const note = el('p', { id: 'gfx-note', class: 'gfx-note', hidden: true });
  host.append(summary, note);
  const refresh = () => {
    const i = api.info(L.cost);
    if (!i) {
      summary.textContent = L.no3d;
      return;
    }
    summary.textContent = `${i.gpu || L.noGpu} · ${i.summary}`;
    note.hidden = !i.postFailed;
    note.textContent = i.postFailed ? L.postFailed : '';
  };
  refresh();
  // The chain is (re)built on the next frame: refresh once it has run.
  requestAnimationFrame(() => requestAnimationFrame(refresh));
}
