// server/jsonToSql.js

// --- Helpers de normalisation --- //

// Cast robuste d'un montant texte -> DOUBLE
function AMOUNT_NORM(col) {
  return `TRY_CAST(REPLACE(regexp_replace(CAST(${col} AS VARCHAR), '[^0-9,\\.\\-]', '', 'g'), ',', '.') AS DOUBLE)`;
}

// Cast robuste d'une date (Excel, texte, timestamp) -> DATE
function DATE_NORM(col) {
  return `COALESCE(
    TRY_CAST(${col} AS DATE),
    CAST(TRY_CAST(${col} AS TIMESTAMP) AS DATE),
    CAST(TRY_STRPTIME(CAST(${col} AS VARCHAR), '%Y-%m-%d') AS DATE),
    CAST(TRY_STRPTIME(CAST(${col} AS VARCHAR), '%d/%m/%Y') AS DATE),
    CAST(TRY_STRPTIME(CAST(${col} AS VARCHAR), '%d-%m-%Y') AS DATE),
    DATE '1899-12-30' + CAST(ROUND(CAST(${col} AS DOUBLE)) AS INTEGER)
  )`;
}

// --- Génération SQL principale --- //

export function jsonToSQL(intent, schema) {
  if (!intent?.table) throw new Error("Pas de table dans l'intention");
  const table = intent.table;

  // Cas spécial pour MAX et MIN avec colonnes spécifiques
  if ((intent.intention === "MAX" || intent.intention === "MIN") && 
      intent.groupement && intent.colonnesAfficher?.length) {
    
    const groupCol = intent.groupement;
    const col = intent.calculCol || "montant_règlement";
    const idCol = intent.colonnesAfficher.find(c => c !== col) || groupCol;
    const isMax = intent.intention === "MAX";
    
    // Construire la clause WHERE
    let whereStr = "";
    if (intent.filtres?.length) {
      const conditions = intent.filtres.map(f => {
        switch (f.operateur) {
          case "egale":
            return `"${f.colonne}" = '${f.valeur}'`;
          case "contient":
            return `"${f.colonne}" LIKE '%${f.valeur}%'`;
          case "superieur_a":
            return `${AMOUNT_NORM(`"${f.colonne}"`)}) > ${f.valeur}`;
          case "inferieur_a":
            return `${AMOUNT_NORM(`"${f.colonne}"`)}) < ${f.valeur}`;
          case "entre":
            if (Array.isArray(f.valeur) && f.valeur.length === 2) {
              return `${DATE_NORM(`"${f.colonne}"`)} BETWEEN '${f.valeur[0]}' AND '${f.valeur[1]}'`;
            }
            return "1=1";
          case "annee_egale":
            return `EXTRACT(YEAR FROM ${DATE_NORM(`"${f.colonne}"`)}) = ${Number(f.valeur)}`;
          default:
            return "1=1";
        }
      });
      whereStr = `WHERE ${conditions.join(" AND ")}`;
    }

    // Utiliser une approche plus simple avec ORDER BY et LIMIT
    return `
      SELECT "${idCol}", "${col}" AS montant
      FROM "${table}"
      ${whereStr}
      ORDER BY ${AMOUNT_NORM(`"${col}"`)} ${isMax ? 'DESC' : 'ASC'}
      LIMIT ${Number(intent.limite) || 1}
    `;
  }

  // Cas normal pour les autres requêtes
  let selectClause = "*";
  let whereClause = "";
  let groupByClause = "";
  let orderByClause = "";
  let limitClause = "";

  // Colonnes spécifiques à afficher
  if (intent.colonnesAfficher?.length) {
    selectClause = intent.colonnesAfficher.map(col => `"${col}"`).join(", ");
  }

  // WHERE (filtres)
  if (intent.filtres?.length) {
    const conditions = intent.filtres.map(f => {
      switch (f.operateur) {
        case "egale":
          return `"${f.colonne}" = '${f.valeur}'`;
        case "contient":
          return `"${f.colonne}" LIKE '%${f.valeur}%'`;
        case "superieur_a":
          return `${AMOUNT_NORM(`"${f.colonne}"`)} > ${f.valeur}`;
        case "inferieur_a":
          return `${AMOUNT_NORM(`"${f.colonne}"`)} < ${f.valeur}`;
        case "entre":
          if (Array.isArray(f.valeur) && f.valeur.length === 2) {
            return `${DATE_NORM(`"${f.colonne}"`)} BETWEEN '${f.valeur[0]}' AND '${f.valeur[1]}'`;
          }
          return "1=1";
        case "annee_egale":
          return `EXTRACT(YEAR FROM ${DATE_NORM(`"${f.colonne}"`)} = ${Number(f.valeur)}`;
        default:
          return "1=1";
      }
    });
    whereClause = `WHERE ${conditions.join(" AND ")}`;
  }

  // Intention
  switch (intent.intention) {
    case "SOMMER": {
      const col = intent.calculCol || "montant_règlement";
      selectClause = `SUM(${AMOUNT_NORM(`"${col}"`)}) AS total`;
      break;
    }

    case "MOYENNE": {
      const col = intent.calculCol || "montant_règlement";
      selectClause = `AVG(${AMOUNT_NORM(`"${col}"`)}) AS moyenne`;
      break;
    }

    case "MAX": {
      const groupCol = intent.groupement || null;
      const col = intent.calculCol || "montant_règlement";
      
      if (groupCol) {
        selectClause = `"${groupCol}", MAX(${AMOUNT_NORM(`"${col}"`)}) AS montant`;
        groupByClause = `GROUP BY "${groupCol}"`;
        orderByClause = `ORDER BY montant DESC`;
        limitClause = `LIMIT ${Number(intent.limite) || 1}`;
      } else {
        selectClause = `MAX(${AMOUNT_NORM(`"${col}"`)}) AS max_montant`;
      }
      break;
    }

    case "MIN": {
      const groupCol = intent.groupement || null;
      const col = intent.calculCol || "montant_règlement";
      
      if (groupCol) {
        selectClause = `"${groupCol}", MIN(${AMOUNT_NORM(`"${col}"`)}) AS montant`;
        groupByClause = `GROUP BY "${groupCol}"`;
        orderByClause = `ORDER BY montant ASC`;
        limitClause = `LIMIT ${Number(intent.limite) || 1}`;
      } else {
        selectClause = `MIN(${AMOUNT_NORM(`"${col}"`)}) AS min_montant`;
      }
      break;
    }

    case "TOP_N": {
      const groupCol = intent.groupement || "trigramme";
      const col = intent.calculCol || "montant_règlement";
      
      selectClause = `"${groupCol}", SUM(${AMOUNT_NORM(`"${col}"`)}) AS total`;
      groupByClause = `GROUP BY "${groupCol}"`;
      orderByClause = `ORDER BY total ${intent.ordre === "ascendant" ? "ASC" : "DESC"}`;
      limitClause = `LIMIT ${Number(intent.limite) || 10}`;
      break;
    }

    case "FILTRER": {
      if (intent.colonnesAfficher?.length) {
        selectClause = intent.colonnesAfficher.map(col => `"${col}"`).join(", ");
      } else {
        selectClause = "*";
      }
      break;
    }

    default: {
      if (intent.colonnesAfficher?.length) {
        selectClause = intent.colonnesAfficher.map(col => `"${col}"`).join(", ");
      } else {
        selectClause = "*";
      }
    }
  }

  const sql = `
    SELECT ${selectClause}
    FROM "${table}"
    ${whereClause}
    ${groupByClause}
    ${orderByClause}
    ${limitClause}
  `.trim();

  return sql;
}
  