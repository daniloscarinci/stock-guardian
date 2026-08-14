/**
 * The system category taxonomy.
 *
 * The first nine are the categories the original application shipped, with their
 * exact Portuguese and Spanish labels preserved. The remaining eleven come from
 * the specification's twenty-category structure and start empty - they are real,
 * usable categories the user can file items under, not placeholders.
 *
 * Two deliberate decisions, recorded here because both are the kind of thing
 * that looks like an accident later:
 *
 *  1. The `power` category displays as "Energy" in English (the specification's
 *     name) while the original app said "Power". The slug did not change, the
 *     Portuguese and Spanish labels did not change, and the legacy importer
 *     accepts both English strings - so no existing data can be orphaned by it.
 *
 *  2. The 194 catalog items keep the category they had in the original app. No
 *     item was silently reclassified, even where a different category now looks
 *     like a better fit (a compass sits in Communication, not Navigation).
 *     Reference data is not ours to quietly rewrite; the user can recategorize.
 */

export interface SeedCategory {
  readonly id: string;
  readonly icon: string;
  readonly color: string;
  readonly names: {
    readonly 'pt-BR': string;
    readonly en: string;
    readonly es: string;
  };
}

export const SEED_CATEGORIES: readonly SeedCategory[] = [
  // --- Shipped with the original application -------------------------------
  { id: 'food', icon: 'wheat', color: 'amber', names: { 'pt-BR': 'Alimentos', en: 'Food', es: 'Alimentos' } },
  { id: 'water', icon: 'droplet', color: 'sky', names: { 'pt-BR': 'Água', en: 'Water', es: 'Agua' } },
  { id: 'medical', icon: 'cross', color: 'rose', names: { 'pt-BR': 'Médico', en: 'Medical', es: 'Médico' } },
  { id: 'power', icon: 'bolt', color: 'yellow', names: { 'pt-BR': 'Energia', en: 'Energy', es: 'Energía' } },
  { id: 'tools', icon: 'wrench', color: 'slate', names: { 'pt-BR': 'Ferramentas', en: 'Tools', es: 'Herramientas' } },
  { id: 'shelter', icon: 'tent', color: 'emerald', names: { 'pt-BR': 'Abrigo', en: 'Shelter', es: 'Refugio' } },
  { id: 'fire', icon: 'flame', color: 'orange', names: { 'pt-BR': 'Fogo', en: 'Fire', es: 'Fuego' } },
  { id: 'hygiene', icon: 'soap', color: 'cyan', names: { 'pt-BR': 'Higiene', en: 'Hygiene', es: 'Higiene' } },
  { id: 'communication', icon: 'radio', color: 'violet', names: { 'pt-BR': 'Comunicação', en: 'Communication', es: 'Comunicación' } },

  // --- Added by the specification's category structure ----------------------
  { id: 'transportation', icon: 'truck', color: 'blue', names: { 'pt-BR': 'Transporte', en: 'Transportation', es: 'Transporte' } },
  { id: 'clothing', icon: 'shirt', color: 'indigo', names: { 'pt-BR': 'Vestuário', en: 'Clothing', es: 'Ropa' } },
  { id: 'cooking', icon: 'pot', color: 'red', names: { 'pt-BR': 'Cozinha', en: 'Cooking', es: 'Cocina' } },
  { id: 'security', icon: 'shield', color: 'stone', names: { 'pt-BR': 'Segurança', en: 'Security', es: 'Seguridad' } },
  { id: 'documents', icon: 'file', color: 'zinc', names: { 'pt-BR': 'Documentos', en: 'Documents', es: 'Documentos' } },
  { id: 'navigation', icon: 'compass', color: 'teal', names: { 'pt-BR': 'Navegação', en: 'Navigation', es: 'Navegación' } },
  { id: 'agriculture', icon: 'sprout', color: 'lime', names: { 'pt-BR': 'Agricultura', en: 'Agriculture', es: 'Agricultura' } },
  { id: 'sanitation', icon: 'trash', color: 'green', names: { 'pt-BR': 'Saneamento', en: 'Sanitation', es: 'Saneamiento' } },
  { id: 'lighting', icon: 'lamp', color: 'fuchsia', names: { 'pt-BR': 'Iluminação', en: 'Lighting', es: 'Iluminación' } },
  { id: 'fuel', icon: 'fuel', color: 'brown', names: { 'pt-BR': 'Combustível', en: 'Fuel', es: 'Combustible' } },
  { id: 'other', icon: 'box', color: 'gray', names: { 'pt-BR': 'Outros', en: 'Other', es: 'Otros' } },
];

/** Categories the original application shipped, in their original order. */
export const ORIGINAL_CATEGORY_IDS: readonly string[] = [
  'food',
  'water',
  'medical',
  'power',
  'tools',
  'shelter',
  'fire',
  'hygiene',
  'communication',
];
