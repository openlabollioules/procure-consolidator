import OpenAI from "openai";

function listTables(schema) {
  return Object.keys(schema || {}).sort();
}

function listColumns(schema) {
  const columns = new Set();
  for (const table of Object.values(schema)) {
    for (const col of table) {
      columns.add(col.name);
    }
  }
  return Array.from(columns).sort();
}

// Fonction pour obtenir les informations de date actuelles
function getCurrentDateInfo() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;
  
  // Premier jour du mois courant
  const firstDayCurrentMonth = new Date(currentYear, currentMonth - 1, 1);
  // Dernier jour du mois courant
  const lastDayCurrentMonth = new Date(currentYear, currentMonth, 0);
  
  // Premier jour du mois précédent
  const firstDayLastMonth = new Date(lastMonthYear, lastMonth - 1, 1);
  // Dernier jour du mois précédent
  const lastDayLastMonth = new Date(lastMonthYear, lastMonth, 0);
  
  // Format YYYY-MM-DD
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  return {
    currentYear,
    lastYear: currentYear - 1,
    currentMonth: {
      start: formatDate(firstDayCurrentMonth),
      end: formatDate(lastDayCurrentMonth)
    },
    lastMonth: {
      start: formatDate(firstDayLastMonth),
      end: formatDate(lastDayLastMonth)
    }
  };
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "ollama",
  baseURL: process.env.OPENAI_BASE_URL || "http://127.0.0.1:11434/v1",
});

const MODEL = process.env.OLLAMA_MODEL || "mistral";

export async function askLLM({ schema, question }) {
  // Extraire les tables et colonnes disponibles
  const allowedTables = listTables(schema);
  const allowedColumns = listColumns(schema);
  
  // Déterminer les colonnes de dates et montants
  const dateColumns = allowedColumns.filter(col => 
    col.toLowerCase().includes('date') || 
    col.toLowerCase().includes('règlement') ||
    col.toLowerCase().includes('reglement')
  );
  
  const montantColumns = allowedColumns.filter(col => 
    col.toLowerCase().includes('montant') || 
    col.toLowerCase().includes('règlement') ||
    col.toLowerCase().includes('reglement')
  );
  
  const idColumns = allowedColumns.filter(col =>
    col.toLowerCase().includes('id') ||
    col.toLowerCase().includes('n°') ||
    col.toLowerCase().includes('numero') ||
    col.toLowerCase().includes('référence') ||
    col.toLowerCase().includes('reference') ||
    col.toLowerCase().includes('facture') ||
    col.toLowerCase().includes('commande')
  );
  
  const tablesHint = `NOMS DE TABLE AUTORISÉS (utilisation OBLIGATOIRE, exactement comme écrits) :
- ${allowedTables.join("\n- ")}`;

  const columnsHint = `COLONNES DISPONIBLES (utilisation OBLIGATOIRE, exactement comme écrites) :
- ${allowedColumns.join("\n- ")}`;

  const dateColumnsHint = dateColumns.length > 0 ? 
    `COLONNES DE DATE DISPONIBLES :
- ${dateColumns.join("\n- ")}` : "";

  const montantColumnsHint = montantColumns.length > 0 ? 
    `COLONNES DE MONTANT DISPONIBLES :
- ${montantColumns.join("\n- ")}` : "";

  const idColumnsHint = idColumns.length > 0 ?
    `COLONNES D'IDENTIFIANTS DISPONIBLES :
- ${idColumns.join("\n- ")}` : "";
  
  const dateInfo = getCurrentDateInfo();
  
  const system = `Tu es un assistant qui traduit une question utilisateur en JSON structuré.
Réponds UNIQUEMENT avec du JSON valide, rien d'autre.

RÈGLES IMPORTANTES:
- Si la question mentionne une année (ex: "en 2024"), ajoute un filtre:
  {"colonne":"<colonne_date>","operateur":"annee_egale","valeur":"<année>"}
- Si la question contient "ce mois-ci", "le mois dernier", "cette année", "l'année dernière",
  renvoie un ou plusieurs filtres de type:
  {"colonne":"<colonne_date>","operateur":"entre","valeur":["YYYY-MM-DD","YYYY-MM-DD"]}
- Utilise UNIQUEMENT des colonnes présentes dans le schéma fourni.
- Si la question parle de "fournisseur", privilégie des colonnes comme "trigramme", "fournisseur", "vendor", etc.
- Si l'utilisateur demande un "top N", mets "intention":"TOP_N", "ordre":"descendant" par défaut et "limite":N.
- Si l'utilisateur demande le "plus grand", "plus élevé", "maximum", utilise "intention":"MAX".
- Si l'utilisateur demande le "plus petit", "minimum", "moins cher", utilise "intention":"MIN".
- Pour les montants, utilise UNIQUEMENT les colonnes de montant disponibles.
- Pour les dates, utilise UNIQUEMENT les colonnes de date disponibles.
- Pour les identifiants (numéro de commande, facture, etc.), utilise les colonnes d'ID appropriées.
- N'invente JAMAIS de colonnes ou de tables qui ne sont pas dans la liste fournie.

Format attendu:
{
  "intention": "FILTRER|SOMMER|TOP_N|MOYENNE|MAX|MIN",
  "table": "nom_table",
  "filtres": [{"colonne":"...","operateur":"egale|contient|superieur_a|inferieur_a|entre|annee_egale","valeur":"... ou [..,..]"}],
  "groupement": "colonne_ou_null",
  "calculCol": "colonne_pour_calcul_ou_null",
  "ordre": "ascendant|descendant|null",
  "limite": 10,
  "colonnesAfficher": ["colonne1", "colonne2", ...] // colonnes spécifiques à afficher
}

Exemple A (année explicite):
Question: "Top 5 des fournisseurs en 2024 par montant_règlement"
Réponse:
{
  "intention": "TOP_N",
  "table": "decaissements_2024",
  "filtres": [
    {"colonne": "date_règlement", "operateur": "annee_egale", "valeur": "2024"}
  ],
  "groupement": "trigramme",
  "calculCol": "montant_règlement",
  "ordre": "descendant",
  "limite": 5,
  "colonnesAfficher": ["trigramme", "montant_règlement"]
}

Exemple B (maximum):
Question: "Quelle est la facture avec le montant le plus élevé?"
Réponse:
{
  "intention": "MAX",
  "table": "decaissements_2024",
  "filtres": [],
  "groupement": "n°_facture",
  "calculCol": "montant_règlement",
  "ordre": "descendant",
  "limite": 1,
  "colonnesAfficher": ["n°_facture", "montant_règlement"]
}

Exemple C (minimum):
Question: "Quel fournisseur a le montant le moins élevé?"
Réponse:
{
  "intention": "MIN",
  "table": "decaissements_2024",
  "filtres": [],
  "groupement": "trigramme",
  "calculCol": "montant_règlement",
  "ordre": "ascendant",
  "limite": 1,
  "colonnesAfficher": ["trigramme", "montant_règlement"]
}

Exemple D (numéro de commande):
Question: "Donne-moi le numéro de commande qui a coûté le plus cher"
Réponse:
{
  "intention": "MAX",
  "table": "decaissements_2024",
  "filtres": [],
  "groupement": "n°_commande",
  "calculCol": "montant_règlement",
  "ordre": "descendant",
  "limite": 1,
  "colonnesAfficher": ["n°_commande", "montant_règlement"]
}

IMPORTANT :
- Utilise UNIQUEMENT les noms de table et colonnes listés.
- Ne JAMAIS inventer un nom.
- Pour les références temporelles comme "ce mois-ci", utilise ces dates :
  - Mois courant: du ${dateInfo.currentMonth.start} au ${dateInfo.currentMonth.end}
  - Mois dernier: du ${dateInfo.lastMonth.start} au ${dateInfo.lastMonth.end}
  - Année courante: ${dateInfo.currentYear}
  - Année dernière: ${dateInfo.lastYear}

`;

  const user = `Question: ${question}
Schéma disponible:
${tablesHint}

${columnsHint}

${dateColumnsHint}

${montantColumnsHint}

${idColumnsHint}`;

  const resp = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    temperature: 0,
  });

  let txt = resp.choices?.[0]?.message?.content?.trim() || "{}";
  const m = txt.match(/```json([\s\S]*?)```/i);
  if (m) txt = m[1].trim();

  return JSON.parse(txt);
}

export async function generateResponse({ intent, rows, schema }) {
  const system = `Tu es un assistant analytique qui génère des réponses claires et professionnelles basées sur des données.
  
RÈGLES IMPORTANTES:
- Ton but est de présenter les résultats de manière claire et directe.
- Utilise un ton professionnel et orienté business.
- Mets en évidence les chiffres clés et les identifiants importants.
- Sois concis mais précis.
- N'invente JAMAIS de données qui ne sont pas dans les résultats fournis.
- Si les résultats sont vides, indique-le clairement.
- Utilise le format monétaire approprié pour les montants (ex: 10 234,56 €).
- Présente les dates au format français (JJ/MM/AAAA).

Exemple A (top fournisseurs):
Résultat: [{"trigramme":"ABC", "total": 123456.78}, {"trigramme":"XYZ", "total": 98765.43}]
Réponse: "Les principaux fournisseurs sont ABC (123 456,78 €) et XYZ (98 765,43 €)."

Exemple B (facture maximum):
Résultat: [{"n°_facture":"F12345", "montant_règlement": 987654.32}]
Réponse: "La facture F12345 présente le montant le plus élevé avec 987 654,32 €."

Exemple C (minimum):
Résultat: [{"trigramme":"XYZ", "montant_règlement": 123.45}]
Réponse: "Le fournisseur XYZ a le montant le plus faible avec 123,45 €."
`;

  const user = `Intention: ${JSON.stringify(intent)}
Résultats: ${JSON.stringify(rows)}`;

  const resp = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    temperature: 0.2,
  });

  return resp.choices?.[0]?.message?.content?.trim() || "";
}
