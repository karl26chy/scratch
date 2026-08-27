export interface SelectorInfo {
  key: string;
  label: string;
  description: string;
  placeholder: string;
  required: boolean;
  example: string;
  category: 'required' | 'optional';
}

export const SELECTOR_HELPERS: SelectorInfo[] = [
  {
    key: 'events',
    label: 'Contenedor de eventos *',
    description: 'Elemento HTML que contiene CADA partido completo. Es el contenedor principal que agrupa todos los datos de un encuentro.',
    placeholder: '.match-card, .event-row, div[data-match]',
    required: true,
    category: 'required',
    example: '.match-card',
  },
  {
    key: 'homeTeam',
    label: 'Equipo local *',
    description: 'Nombre del equipo que juega en casa. Busca elementos con texto del equipo local.',
    placeholder: '.team-home, .home-team, .participant-name:first-child',
    required: true,
    category: 'required',
    example: '.team-home',
  },
  {
    key: 'awayTeam',
    label: 'Equipo visitante *',
    description: 'Nombre del equipo que juega fuera de casa. Busca elementos con texto del equipo visitante.',
    placeholder: '.team-away, .away-team, .participant-name:last-child',
    required: true,
    category: 'required',
    example: '.team-away',
  },
  {
    key: 'oddsHome',
    label: 'Cuota local (1) *',
    description: 'Cuota decimal para victoria del equipo local. Normalmente es un número como 1.85, 2.10, etc.',
    placeholder: '.odds-1, .price:first-child, .odds-home',
    required: true,
    category: 'required',
    example: '.odds-1',
  },
  {
    key: 'oddsDraw',
    label: 'Cuota empate (X) *',
    description: 'Cuota decimal para el empate. Normalmente es un número entre 3.00 y 4.50.',
    placeholder: '.odds-x, .price:nth-child(2), .odds-draw',
    required: true,
    category: 'required',
    example: '.odds-x',
  },
  {
    key: 'oddsAway',
    label: 'Cuota visitante (2) *',
    description: 'Cuota decimal para victoria del equipo visitante.',
    placeholder: '.odds-2, .price:last-child, .odds-away',
    required: true,
    category: 'required',
    example: '.odds-2',
  },
  {
    key: 'matchTime',
    label: 'Hora del partido',
    description: 'Horario del encuentro. Puede ser hora exacta (20:00) o fecha completa.',
    placeholder: '.match-time, .event-time, .kickoff',
    required: false,
    category: 'optional',
    example: '.match-time',
  },
  {
    key: 'leagueName',
    label: 'Nombre de la liga',
    description: 'Liga, torneo o competición (Ej: LaLiga, Premier League).',
    placeholder: '.league-name, .tournament, .competition',
    required: false,
    category: 'optional',
    example: '.league-name',
  },
  {
    key: 'matchStatus',
    label: 'Estado del partido',
    description: 'Estado actual: En vivo, Finalizado, Programado.',
    placeholder: '.match-status, .event-status, .game-status',
    required: false,
    category: 'optional',
    example: '.match-status',
  },
  {
    key: 'homeScore',
    label: 'Goles local',
    description: 'Goles actuales del local. Útil para en vivo.',
    placeholder: '.score-home, .home-score, .goals-home',
    required: false,
    category: 'optional',
    example: '.score-home',
  },
  {
    key: 'awayScore',
    label: 'Goles visitante',
    description: 'Goles actuales del visitante.',
    placeholder: '.score-away, .away-score, .goals-away',
    required: false,
    category: 'optional',
    example: '.score-away',
  },
  {
    key: 'overOdds',
    label: 'Over 2.5',
    description: 'Cuota para Over 2.5 goles.',
    placeholder: '.odds-over, .over-price, .over-odds',
    required: false,
    category: 'optional',
    example: '.odds-over',
  },
  {
    key: 'underOdds',
    label: 'Under 2.5',
    description: 'Cuota para Under 2.5 goles.',
    placeholder: '.odds-under, .under-price, .under-odds',
    required: false,
    category: 'optional',
    example: '.odds-under',
  },
  {
    key: 'handicapHome',
    label: 'Handicap local',
    description: 'Handicap asiático local. Ej: -0.5, -1, +0.5',
    placeholder: '.handicap-home, .asian-home',
    required: false,
    category: 'optional',
    example: '.handicap-home',
  },
  {
    key: 'handicapAway',
    label: 'Handicap visitante',
    description: 'Handicap asiático visitante.',
    placeholder: '.handicap-away, .asian-away',
    required: false,
    category: 'optional',
    example: '.handicap-away',
  },
  {
    key: 'bothScoreYes',
    label: 'Ambos marcan - Sí',
    description: 'Cuota para "Ambos equipos marcan" Sí.',
    placeholder: '.both-score-yes, .btts-yes',
    required: false,
    category: 'optional',
    example: '.both-score-yes',
  },
  {
    key: 'bothScoreNo',
    label: 'Ambos marcan - No',
    description: 'Cuota para "Ambos equipos marcan" No.',
    placeholder: '.both-score-no, .btts-no',
    required: false,
    category: 'optional',
    example: '.both-score-no',
  },
];

export function getSelectorInfo(key: string): SelectorInfo | undefined {
  return SELECTOR_HELPERS.find((s) => s.key === key);
}

export function getRequiredSelectors(): SelectorInfo[] {
  return SELECTOR_HELPERS.filter((s) => s.required);
}

export function getOptionalSelectors(): SelectorInfo[] {
  return SELECTOR_HELPERS.filter((s) => !s.required);
}
