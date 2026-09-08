/**
 * The phrasebook's contents: every phrase the screen shows, and what the parser
 * must make of each one.
 *
 * The screen is a reference, so its worst possible failure is listing a command
 * the application does not understand. `phrases.test.ts` walks every string in
 * this file through the real grammar for its own language and asserts the
 * intent claimed beside it - not merely that something came back. Tighten a
 * rule and a phrase here stops working, and that test fails before the page
 * lies to anybody.
 *
 * The phrases are written the way a person writes: capitals, accents, question
 * marks, the "¿" on the front of the Spanish ones. `parse` folds and strips all
 * of that before a rule sees it, so the natural form and the flattened form are
 * the same sentence to the parser - and the natural form is the one worth
 * showing. The test runs exactly these strings, so that is checked rather than
 * assumed.
 *
 * The chrome is here rather than in the locales because this screen is
 * trilingual by nature and its own headings can be too. The one string it needs
 * from the locales is the navigation entry that leads to it.
 */
import type { Intent, IntentKind } from '../../voice/intents';
import type { Language } from '../../domain/settings';

/** The same text in every language the application speaks. */
export type Trilingual = Readonly<Record<Language, string>>;

/**
 * An intent with its kind required and every other slot optional.
 *
 * A phrase may claim as much or as little as is worth pinning: "Ajuda" claims
 * only HELP, while "Adiciona cinco latas de feijão" claims the item, the
 * amount, the direction, the transaction and the unit. What a phrase may not do
 * is claim nothing, which is what makes this stronger than "did not come back
 * UNKNOWN".
 */
export type ExpectedIntent = {
  [K in IntentKind]: { readonly kind: K } & Partial<Extract<Intent, { kind: K }>>;
}[IntentKind];

export interface Phrase {
  /** Exactly as the screen shows it, and exactly as the test parses it. */
  readonly text: string;
  readonly expect: ExpectedIntent;
}

export interface PhrasebookEntry {
  readonly id: string;
  /** Asking answers; changing writes. The two are kept apart on the screen. */
  readonly section: 'asking' | 'changing';
  /** What this row of phrases is for, in the reader's own language. */
  readonly label: Trilingual;
  readonly phrases: Readonly<Record<Language, readonly Phrase[]>>;
}

/*
 * A date is deliberately absent from every SET_EXPIRY expectation below. "O
 * leite vence dia 12" resolves against the day the question is asked, so the
 * only claim that stays true tomorrow is the item and that the day was stated
 * rather than inferred. That the date itself is a real one is asserted
 * separately, against a fixed today.
 */
const ASKING: readonly PhrasebookEntry[] = [
  {
    id: 'quantity',
    section: 'asking',
    label: { 'pt-BR': 'Quanto eu tenho', en: 'How much I have', es: 'Cuánto tengo' },
    phrases: {
      'pt-BR': [
        { text: 'Quanto arroz eu tenho?', expect: { kind: 'QUERY_QUANTITY', item: 'arroz' } },
        { text: 'Sobrou arroz?', expect: { kind: 'QUERY_QUANTITY', item: 'arroz' } },
      ],
      en: [
        { text: 'How much rice do I have?', expect: { kind: 'QUERY_QUANTITY', item: 'rice' } },
        { text: 'Any rice left?', expect: { kind: 'QUERY_QUANTITY', item: 'rice' } },
      ],
      es: [
        { text: '¿Cuánto arroz tengo?', expect: { kind: 'QUERY_QUANTITY', item: 'arroz' } },
        { text: '¿Queda arroz?', expect: { kind: 'QUERY_QUANTITY', item: 'arroz' } },
      ],
    },
  },
  {
    id: 'expiring',
    section: 'asking',
    label: { 'pt-BR': 'O que está vencendo', en: 'What is expiring', es: 'Qué está por vencer' },
    phrases: {
      'pt-BR': [
        {
          text: 'O que tá vencendo?',
          expect: { kind: 'QUERY_EXPIRING', withinDays: null, expiredOnly: false },
        },
        {
          text: 'O que já venceu?',
          expect: { kind: 'QUERY_EXPIRING', withinDays: null, expiredOnly: true },
        },
        {
          text: 'O que vence essa semana?',
          expect: { kind: 'QUERY_EXPIRING', withinDays: 7, expiredOnly: false },
        },
      ],
      en: [
        {
          text: 'Is anything expiring?',
          expect: { kind: 'QUERY_EXPIRING', withinDays: null, expiredOnly: false },
        },
        {
          text: "What's already expired?",
          expect: { kind: 'QUERY_EXPIRING', withinDays: null, expiredOnly: true },
        },
        {
          text: 'What expires this week?',
          expect: { kind: 'QUERY_EXPIRING', withinDays: 7, expiredOnly: false },
        },
      ],
      es: [
        {
          text: '¿Qué está por vencer?',
          expect: { kind: 'QUERY_EXPIRING', withinDays: null, expiredOnly: false },
        },
        {
          text: '¿Qué ya venció?',
          expect: { kind: 'QUERY_EXPIRING', withinDays: null, expiredOnly: true },
        },
        {
          text: '¿Qué vence esta semana?',
          expect: { kind: 'QUERY_EXPIRING', withinDays: 7, expiredOnly: false },
        },
      ],
    },
  },
  {
    id: 'missing',
    section: 'asking',
    label: { 'pt-BR': 'O que está faltando', en: 'What is running out', es: 'Qué falta' },
    phrases: {
      'pt-BR': [
        { text: 'O que tá faltando?', expect: { kind: 'QUERY_MISSING' } },
        { text: 'O que preciso repor?', expect: { kind: 'QUERY_MISSING' } },
      ],
      en: [
        { text: 'What am I low on?', expect: { kind: 'QUERY_MISSING' } },
        { text: 'What have I run out of?', expect: { kind: 'QUERY_MISSING' } },
      ],
      es: [
        { text: '¿Qué me hace falta?', expect: { kind: 'QUERY_MISSING' } },
        { text: '¿Qué tengo que reponer?', expect: { kind: 'QUERY_MISSING' } },
      ],
    },
  },
  {
    id: 'where-item',
    section: 'asking',
    label: { 'pt-BR': 'Onde está uma coisa', en: 'Where something is', es: 'Dónde está algo' },
    phrases: {
      'pt-BR': [
        {
          text: 'Onde tá o arroz?',
          expect: { kind: 'QUERY_WHERE', item: 'arroz', location: null },
        },
      ],
      en: [
        {
          text: 'Where is the rice?',
          expect: { kind: 'QUERY_WHERE', item: 'rice', location: null },
        },
      ],
      es: [
        {
          text: '¿Dónde está el arroz?',
          expect: { kind: 'QUERY_WHERE', item: 'arroz', location: null },
        },
      ],
    },
  },
  {
    id: 'where-place',
    section: 'asking',
    label: { 'pt-BR': 'O que tem num lugar', en: 'What is in a place', es: 'Qué hay en un lugar' },
    phrases: {
      'pt-BR': [
        {
          text: 'O que tem na despensa?',
          expect: { kind: 'QUERY_WHERE', item: null, location: 'despensa' },
        },
      ],
      en: [
        {
          text: "What's in the pantry?",
          expect: { kind: 'QUERY_WHERE', item: null, location: 'pantry' },
        },
      ],
      es: [
        {
          text: '¿Qué hay en la despensa?',
          expect: { kind: 'QUERY_WHERE', item: null, location: 'despensa' },
        },
      ],
    },
  },
  {
    id: 'category',
    section: 'asking',
    label: {
      'pt-BR': 'O que tem numa categoria',
      en: 'What is in a category',
      es: 'Qué hay en una categoría',
    },
    phrases: {
      'pt-BR': [
        {
          text: 'O que tem na categoria alimentos?',
          expect: { kind: 'QUERY_CATEGORY', category: 'alimentos' },
        },
      ],
      en: [
        {
          text: "What's in the food category?",
          expect: { kind: 'QUERY_CATEGORY', category: 'food' },
        },
      ],
      es: [
        {
          text: '¿Qué hay en la categoría alimentos?',
          expect: { kind: 'QUERY_CATEGORY', category: 'alimentos' },
        },
      ],
    },
  },
  {
    id: 'expiry-of',
    section: 'asking',
    label: {
      'pt-BR': 'Quando uma coisa vence',
      en: 'When something expires',
      es: 'Cuándo vence algo',
    },
    phrases: {
      'pt-BR': [
        { text: 'Quando vence o leite?', expect: { kind: 'QUERY_EXPIRY_OF', item: 'leite' } },
      ],
      en: [
        { text: 'When does the milk expire?', expect: { kind: 'QUERY_EXPIRY_OF', item: 'milk' } },
      ],
      es: [{ text: '¿Cuándo vence la leche?', expect: { kind: 'QUERY_EXPIRY_OF', item: 'leche' } }],
    },
  },
  {
    id: 'history',
    section: 'asking',
    label: { 'pt-BR': 'Quando eu comprei', en: 'When I last bought it', es: 'Cuándo lo compré' },
    phrases: {
      'pt-BR': [
        { text: 'Quando comprei arroz?', expect: { kind: 'QUERY_HISTORY', item: 'arroz' } },
      ],
      en: [{ text: 'When did I last buy rice?', expect: { kind: 'QUERY_HISTORY', item: 'rice' } }],
      es: [{ text: '¿Cuándo compré arroz?', expect: { kind: 'QUERY_HISTORY', item: 'arroz' } }],
    },
  },
  {
    id: 'contact',
    section: 'asking',
    label: { 'pt-BR': 'Um telefone', en: 'A phone number', es: 'Un teléfono' },
    phrases: {
      'pt-BR': [
        { text: 'Qual o telefone do médico?', expect: { kind: 'QUERY_CONTACT', query: 'medico' } },
      ],
      en: [
        { text: "What's the doctor's number?", expect: { kind: 'QUERY_CONTACT', query: 'doctor' } },
      ],
      es: [
        {
          text: '¿Cuál es el teléfono del médico?',
          expect: { kind: 'QUERY_CONTACT', query: 'medico' },
        },
      ],
    },
  },
  {
    id: 'score',
    section: 'asking',
    label: {
      'pt-BR': 'Como está minha preparação',
      en: 'How prepared I am',
      es: 'Qué tan preparado estoy',
    },
    phrases: {
      'pt-BR': [{ text: 'Como tá minha preparação?', expect: { kind: 'QUERY_SCORE' } }],
      en: [{ text: 'How prepared am I?', expect: { kind: 'QUERY_SCORE' } }],
      es: [{ text: '¿Qué tan preparado estoy?', expect: { kind: 'QUERY_SCORE' } }],
    },
  },
  {
    id: 'total',
    section: 'asking',
    label: {
      'pt-BR': 'Quantos itens ao todo',
      en: 'How many items in all',
      es: 'Cuántos ítems en total',
    },
    phrases: {
      'pt-BR': [{ text: 'Quantos itens eu tenho?', expect: { kind: 'QUERY_TOTAL' } }],
      en: [{ text: 'How many items do I have?', expect: { kind: 'QUERY_TOTAL' } }],
      es: [{ text: '¿Cuántos ítems tengo?', expect: { kind: 'QUERY_TOTAL' } }],
    },
  },
  {
    /*
     * HELP asks what can be said, which is this screen's own question, and it
     * changes nothing - so it belongs among the questions rather than at the
     * end of the writes.
     */
    id: 'help',
    section: 'asking',
    label: { 'pt-BR': 'O que dá para dizer', en: 'What can be said', es: 'Qué se puede decir' },
    phrases: {
      'pt-BR': [
        { text: 'Ajuda', expect: { kind: 'HELP' } },
        { text: 'O que você entende?', expect: { kind: 'HELP' } },
      ],
      en: [
        { text: 'Help', expect: { kind: 'HELP' } },
        { text: 'What can I say?', expect: { kind: 'HELP' } },
      ],
      es: [
        { text: 'Ayuda', expect: { kind: 'HELP' } },
        { text: '¿Qué puedo decir?', expect: { kind: 'HELP' } },
      ],
    },
  },
];

const CHANGING: readonly PhrasebookEntry[] = [
  {
    id: 'adjust',
    section: 'changing',
    label: { 'pt-BR': 'Somar ou tirar', en: 'Add or take away', es: 'Sumar o restar' },
    phrases: {
      'pt-BR': [
        {
          text: 'Adiciona cinco latas de feijão',
          expect: {
            kind: 'ADJUST_QUANTITY',
            item: 'feijao',
            amount: 5,
            direction: 'up',
            transaction: 'add',
            unit: 'latas',
            amountAssumed: false,
          },
        },
        {
          text: 'Usei 3 ovos',
          expect: {
            kind: 'ADJUST_QUANTITY',
            item: 'ovos',
            amount: 3,
            direction: 'down',
            transaction: 'consume',
            amountAssumed: false,
          },
        },
        {
          text: 'Comprei 2 kg de arroz',
          expect: {
            kind: 'ADJUST_QUANTITY',
            item: 'arroz',
            amount: 2,
            direction: 'up',
            transaction: 'purchase',
            unit: 'kg',
            amountAssumed: false,
          },
        },
      ],
      en: [
        {
          text: 'Add five cans of beans',
          expect: {
            kind: 'ADJUST_QUANTITY',
            item: 'beans',
            amount: 5,
            direction: 'up',
            transaction: 'add',
            unit: 'cans',
            amountAssumed: false,
          },
        },
        {
          text: 'I used 3 eggs',
          expect: {
            kind: 'ADJUST_QUANTITY',
            item: 'eggs',
            amount: 3,
            direction: 'down',
            transaction: 'consume',
            amountAssumed: false,
          },
        },
        {
          text: 'I bought 2 kg of rice',
          expect: {
            kind: 'ADJUST_QUANTITY',
            item: 'rice',
            amount: 2,
            direction: 'up',
            transaction: 'purchase',
            unit: 'kg',
            amountAssumed: false,
          },
        },
      ],
      es: [
        {
          text: 'Agrega cinco latas de frijoles',
          expect: {
            kind: 'ADJUST_QUANTITY',
            item: 'frijoles',
            amount: 5,
            direction: 'up',
            transaction: 'add',
            unit: 'latas',
            amountAssumed: false,
          },
        },
        {
          text: 'Usé 3 huevos',
          expect: {
            kind: 'ADJUST_QUANTITY',
            item: 'huevos',
            amount: 3,
            direction: 'down',
            transaction: 'consume',
            amountAssumed: false,
          },
        },
        {
          text: 'Compré 2 kg de arroz',
          expect: {
            kind: 'ADJUST_QUANTITY',
            item: 'arroz',
            amount: 2,
            direction: 'up',
            transaction: 'purchase',
            unit: 'kg',
            amountAssumed: false,
          },
        },
      ],
    },
  },
  {
    id: 'set-quantity',
    section: 'changing',
    label: { 'pt-BR': 'A quantidade exata', en: 'The exact quantity', es: 'La cantidad exacta' },
    phrases: {
      'pt-BR': [
        {
          text: 'Agora tenho 12 latas de feijão',
          expect: { kind: 'SET_QUANTITY', item: 'feijao', amount: 12, unit: 'latas' },
        },
      ],
      en: [
        {
          text: 'Now I have 12 cans of beans',
          expect: { kind: 'SET_QUANTITY', item: 'beans', amount: 12, unit: 'cans' },
        },
      ],
      es: [
        {
          text: 'Ahora tengo 12 latas de frijoles',
          expect: { kind: 'SET_QUANTITY', item: 'frijoles', amount: 12, unit: 'latas' },
        },
      ],
    },
  },
  {
    id: 'set-expiry',
    section: 'changing',
    label: { 'pt-BR': 'A data de validade', en: 'An expiry date', es: 'La fecha de vencimiento' },
    phrases: {
      'pt-BR': [
        {
          text: 'O leite vence dia 12',
          expect: { kind: 'SET_EXPIRY', item: 'leite', dateAssumed: false },
        },
        {
          text: 'O arroz vence em 10 de outubro',
          expect: { kind: 'SET_EXPIRY', item: 'arroz', dateAssumed: false },
        },
      ],
      en: [
        {
          text: 'The milk expires on the 12th',
          expect: { kind: 'SET_EXPIRY', item: 'milk', dateAssumed: false },
        },
        {
          text: 'The rice expires on october 10',
          expect: { kind: 'SET_EXPIRY', item: 'rice', dateAssumed: false },
        },
      ],
      es: [
        {
          text: 'La leche vence el 12',
          expect: { kind: 'SET_EXPIRY', item: 'leche', dateAssumed: false },
        },
        {
          text: 'El arroz vence el 10 de octubre',
          expect: { kind: 'SET_EXPIRY', item: 'arroz', dateAssumed: false },
        },
      ],
    },
  },
  {
    id: 'create',
    section: 'changing',
    label: { 'pt-BR': 'Criar um item', en: 'Create an item', es: 'Crear un ítem' },
    phrases: {
      'pt-BR': [
        {
          text: 'Criar item 10 kg de arroz na despensa',
          expect: {
            kind: 'CREATE_ITEM',
            name: 'arroz',
            amount: 10,
            unit: 'kg',
            location: 'despensa',
            expiresOn: null,
          },
        },
      ],
      en: [
        {
          text: 'Create item 10 kg of rice in the pantry',
          expect: {
            kind: 'CREATE_ITEM',
            name: 'rice',
            amount: 10,
            unit: 'kg',
            location: 'pantry',
            expiresOn: null,
          },
        },
      ],
      es: [
        {
          text: 'Crear ítem 10 kg de arroz en la despensa',
          expect: {
            kind: 'CREATE_ITEM',
            name: 'arroz',
            amount: 10,
            unit: 'kg',
            location: 'despensa',
            expiresOn: null,
          },
        },
      ],
    },
  },
  {
    id: 'move',
    section: 'changing',
    label: { 'pt-BR': 'Mudar de lugar', en: 'Move it somewhere', es: 'Cambiar de lugar' },
    phrases: {
      'pt-BR': [
        {
          text: 'Move o arroz para o porão',
          expect: { kind: 'MOVE_ITEM', item: 'arroz', location: 'porao' },
        },
      ],
      en: [
        {
          text: 'Move the rice to the cellar',
          expect: { kind: 'MOVE_ITEM', item: 'rice', location: 'cellar' },
        },
      ],
      es: [
        {
          text: 'Mueve el arroz al sótano',
          expect: { kind: 'MOVE_ITEM', item: 'arroz', location: 'sotano' },
        },
      ],
    },
  },
  {
    id: 'minimum',
    section: 'changing',
    label: {
      'pt-BR': 'O mínimo para repor',
      en: 'The minimum to restock',
      es: 'El mínimo para reponer',
    },
    phrases: {
      'pt-BR': [
        {
          text: 'O mínimo de arroz é 5 quilos',
          expect: { kind: 'SET_MINIMUM', item: 'arroz', amount: 5, unit: 'quilos' },
        },
      ],
      en: [
        {
          text: 'The minimum for rice is 5 kg',
          expect: { kind: 'SET_MINIMUM', item: 'rice', amount: 5, unit: 'kg' },
        },
      ],
      es: [
        {
          text: 'El mínimo de arroz es 5 kilos',
          expect: { kind: 'SET_MINIMUM', item: 'arroz', amount: 5, unit: 'kilos' },
        },
      ],
    },
  },
  {
    id: 'target',
    section: 'changing',
    label: {
      'pt-BR': 'Quanto eu quero ter',
      en: 'How much I want to have',
      es: 'Cuánto quiero tener',
    },
    phrases: {
      'pt-BR': [
        {
          text: 'Quero ter 20 latas de feijão',
          expect: { kind: 'SET_TARGET', item: 'feijao', amount: 20, unit: 'latas' },
        },
      ],
      en: [
        {
          text: 'I want 20 cans of beans',
          expect: { kind: 'SET_TARGET', item: 'beans', amount: 20, unit: 'cans' },
        },
      ],
      es: [
        {
          text: 'Quiero tener 20 latas de frijoles',
          expect: { kind: 'SET_TARGET', item: 'frijoles', amount: 20, unit: 'latas' },
        },
      ],
    },
  },
];

export const PHRASEBOOK_ENTRIES: readonly PhrasebookEntry[] = [...ASKING, ...CHANGING];

/**
 * The two things that are not phrases: how a number may be said, and how a date
 * may be said.
 *
 * Neither is a sentence, so neither can be parsed on its own - and an example
 * nobody checks is exactly what this screen exists to avoid. So each note
 * carries a whole sentence with a `{}` in it, and the test drops every example
 * into that sentence and parses the result. The fragments are verified the same
 * way the phrases are.
 */
export interface PhrasebookNote {
  readonly id: string;
  readonly title: Trilingual;
  readonly body: Trilingual;
  readonly examples: Readonly<Record<Language, readonly string[]>>;
  /** A whole sentence with `{}` where an example goes. */
  readonly probe: Trilingual;
  /** What that sentence must parse to, with any of the examples in it. */
  readonly probeKind: IntentKind;
}

export const PHRASEBOOK_NOTES: readonly PhrasebookNote[] = [
  {
    id: 'numbers',
    title: { 'pt-BR': 'Números', en: 'Numbers', es: 'Números' },
    body: {
      'pt-BR': 'O número pode ser dito por extenso ou escrito em dígitos.',
      en: 'A number can be spelled out in words or written in digits.',
      es: 'El número puede decirse en palabras o escribirse en dígitos.',
    },
    examples: {
      'pt-BR': ['cinco', 'vinte e cinco', 'meia dúzia', 'meio quilo', 'dois mil', '1,5'],
      en: ['five', 'twenty five', 'half a dozen', 'half a kilo', 'two thousand', '1.5'],
      es: ['cinco', 'veinticinco', 'media docena', 'medio kilo', 'dos mil', '1,5'],
    },
    probe: { 'pt-BR': 'Usei {} de arroz', en: 'I used {} of rice', es: 'Usé {} de arroz' },
    probeKind: 'ADJUST_QUANTITY',
  },
  {
    id: 'dates',
    title: { 'pt-BR': 'Datas', en: 'Dates', es: 'Fechas' },
    body: {
      'pt-BR': 'A data pode ser vaga. Um mês sem dia vale o último dia dele.',
      en: 'A date can be vague. A month with no day means its last day.',
      es: 'La fecha puede ser vaga. Un mes sin día vale su último día.',
    },
    examples: {
      'pt-BR': ['hoje', 'amanhã', 'dia 12', '12 de setembro', 'em março', 'daqui a 30 dias'],
      en: ['today', 'tomorrow', 'on the 12th', 'september 12', 'in march', 'in 30 days'],
      es: ['hoy', 'mañana', 'el 12', '12 de septiembre', 'en marzo', 'en 30 días'],
    },
    probe: { 'pt-BR': 'O leite vence {}', en: 'The milk expires {}', es: 'La leche vence {}' },
    probeKind: 'SET_EXPIRY',
  },
];

/** What each language calls itself: a column heading nobody has to translate. */
export const LANGUAGE_ENDONYM: Trilingual = {
  'pt-BR': 'Português',
  en: 'English',
  es: 'Español',
};

/** The screen's own headings, trilingual like everything else on it. */
export interface PhrasebookChrome {
  readonly title: Trilingual;
  readonly subtitle: Trilingual;
  readonly asking: Trilingual;
  readonly askingHint: Trilingual;
  readonly changing: Trilingual;
  readonly changingHint: Trilingual;
}

export const PHRASEBOOK_CHROME: PhrasebookChrome = {
  title: { 'pt-BR': 'Guia de frases', en: 'Phrasebook', es: 'Guía de frases' },
  subtitle: {
    'pt-BR': 'Tudo o que o aplicativo entende, nos três idiomas.',
    en: 'Everything the application understands, in all three languages.',
    es: 'Todo lo que la aplicación entiende, en los tres idiomas.',
  },
  asking: { 'pt-BR': 'Perguntar', en: 'Asking', es: 'Preguntar' },
  askingHint: {
    'pt-BR': 'Respondido na hora, com os seus próprios dados. Nada muda.',
    en: 'Answered on the spot, from your own data. Nothing is changed.',
    es: 'Se responde al instante, con tus propios datos. No cambia nada.',
  },
  changing: { 'pt-BR': 'Mudar', en: 'Changing', es: 'Cambiar' },
  changingHint: {
    'pt-BR':
      'Estas mudam o estoque. Quando a quantidade, o dia ou o item precisa ser adivinhado, a mudança aparece para você confirmar antes.',
    en: 'These change your stock. When the amount, the day or which item had to be guessed, the change is shown for you to confirm first.',
    es: 'Estas cambian tu inventario. Cuando la cantidad, el día o el ítem tuvo que adivinarse, el cambio se muestra para que lo confirmes antes.',
  },
};

/**
 * The three languages with one of them first.
 *
 * The reader's own language leads, because on a narrow screen the three columns
 * become one stack and whatever is on top is what gets read. The other two keep
 * a fixed order behind it, so the page does not rearrange itself between
 * visits.
 */
export function phrasebookLanguages(primary: Language): readonly Language[] {
  const rest = (['pt-BR', 'en', 'es'] as const).filter((language) => language !== primary);
  return [primary, ...rest];
}
