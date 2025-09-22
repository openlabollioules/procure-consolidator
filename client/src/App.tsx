import { useEffect, useMemo, useRef, useState } from "react";
import {
    Database,
    FileSpreadsheet,
    UploadCloud,
    MessageSquare,
    Send,
    PlayCircle,
    Cpu,
    CheckCircle2,
    AlertTriangle,
    Table,
    Loader2,
    Copy,
    Download,
    RefreshCw,
    FolderTree,
    Wand2,
    Building2,
    Bug,
  } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";

/**
 * Procure Chat — Frontend (complet)
 * - Onglets Chat / Catalogue
 * - Upload Excel + Schéma
 * - Chat analytique (LLM => SQL)
 * - Catalogue: build, sélection Cat/SC/Fournisseur
 * - Profil: bar chart + quartiles + panneau debug
 * - Export/Import JSON du catalogue
 */

const API = (import.meta as any).env?.VITE_API_URL || "http://localhost:8787";

type ChatItem = { role: "user" | "assistant"; content: string };
type Row = Record<string, any>;
type Health = { ok?: boolean; model?: string };
type TaxoNode = { category: string; subcategories: string[] };

type CatalogSummary = {
  taxonomy: TaxoNode[];
  suppliers: string[];
  byCategory: Record<string, string[]>;
  bySubcategorySupplier: Record<string, string[]>;
  counts?: Record<string, number>;
};

type ProfileResp = {
  points: { delay_days: number; montant: number; payment_date: string; order_no: string; line_no: string }[];
  series: { delay_days: number; montant_total: number }[];
  cumulative: { delay_days: number; cum_amount: number; share: number }[];
  stats: { n_payments: number; total: number; median_delay: number; p25: number; p75: number };
  quartiles?: Record<string, { delay_days: number; cum_amount: number }>;
  debug?: {
    totalPaymentsAll: number;
    totalPaymentsWithDelay: number;
    sampleSeriesHead: { delay_days: number; montant_total: number }[];
  };
};

function Badge({ color = "#e5e7eb", text }: { color?: string; text: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        padding: "4px 8px",
        borderRadius: 999,
        background: color,
        color: "#111827",
        fontWeight: 600,
      }}
    >
      {text}
    </span>
  );
}

function subtleShadow(alpha = 0.08) {
  return `0 1px 2px rgba(0,0,0,${alpha}), 0 8px 24px rgba(0,0,0,${alpha})`;
}

function ChatResponse({ response }) {
  if (!response) return null;

  // Vérifier si la réponse contient du markdown (tableaux, listes, etc.)
  const hasMarkdown = response.includes('|') || response.includes('*') || response.includes('#');
  
  // Fonction pour rendre le texte en HTML simple
  const renderText = (text) => {
    // Mettre en gras les nombres et montants
    return text.replace(/(\d{1,3}(?:\s?\d{3})*(?:,\d{1,2})?\s?€)/g, '<strong>$1</strong>')
              .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
              .replace(/\n/g, '<br/>');
  };
  
  // Fonction pour rendre un tableau markdown simple
  const renderTable = (text) => {
    if (!text.includes('|')) return renderText(text);
    
    const lines = text.split('\n');
    let inTable = false;
    let tableHtml = '<div class="table-container"><table>';
    
    for (const line of lines) {
      if (line.includes('|')) {
        if (!inTable) {
          inTable = true;
          // C'est un en-tête de tableau
          const headers = line.split('|').filter(cell => cell.trim());
          tableHtml += '<thead><tr>';
          headers.forEach(header => {
            tableHtml += `<th>${header.trim()}</th>`;
          });
          tableHtml += '</tr></thead><tbody>';
        } else if (line.includes('---')) {
          // C'est un séparateur, on l'ignore
          continue;
        } else {
          // C'est une ligne de données
          const cells = line.split('|').filter(cell => cell.trim());
          tableHtml += '<tr>';
          cells.forEach(cell => {
            tableHtml += `<td>${renderText(cell.trim())}</td>`;
          });
          tableHtml += '</tr>';
        }
      } else if (inTable) {
        inTable = false;
        tableHtml += '</tbody></table></div>';
        tableHtml += `<p>${renderText(line)}</p>`;
      } else {
        tableHtml += `<p>${renderText(line)}</p>`;
      }
    }
    
    if (inTable) {
      tableHtml += '</tbody></table></div>';
    }
    
    return tableHtml;
  };

  return (
    <div className="chat-response">
      <div style={{ 
        background: "#f0f9ff", 
        border: "1px solid #bae6fd",
        borderRadius: "12px",
        padding: "16px",
        marginTop: "16px"
      }}>
        <div style={{ 
          display: "flex", 
          alignItems: "center", 
          marginBottom: "8px",
          borderBottom: "1px solid #bae6fd",
          paddingBottom: "8px"
        }}>
          <Database size={18} style={{ marginRight: "8px" }} />
          <span style={{ fontWeight: "600", color: "#0369a1" }}>Réponse analytique</span>
        </div>
        {hasMarkdown ? (
          <div dangerouslySetInnerHTML={{ __html: renderTable(response) }} />
        ) : (
          <div dangerouslySetInnerHTML={{ __html: renderText(response) }} />
        )}
      </div>
      <style>{`
        .chat-response table {
          border-collapse: collapse;
          width: 100%;
          margin: 10px 0;
          font-size: 14px;
        }
        .chat-response th, .chat-response td {
          border: 1px solid #ddd;
          padding: 8px;
          text-align: left;
        }
        .chat-response th {
          background-color: #e0f2fe;
          color: #0369a1;
          font-weight: 600;
        }
        .chat-response tr:nth-child(even) {
          background-color: #f8fafc;
        }
        .chat-response .table-container {
          overflow-x: auto;
          margin: 10px 0;
        }
        .chat-response strong {
          color: #0369a1;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}

export default function App() {
  // Health + schema
  const [health, setHealth] = useState<Health>({});
  const [schema, setSchema] = useState<any>({});

  // Tabs
  const [tab, setTab] = useState<"chat" | "catalog" | "analytics">("chat");

  // Chat state
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [lastSQL, setLastSQL] = useState<string>("");
  const [loadingChat, setLoadingChat] = useState(false);

  // Upload state
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<{ name: string; status: "idle" | "ok" | "err"; msg?: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Catalog state
  const [building, setBuilding] = useState(false);
  const [summary, setSummary] = useState<CatalogSummary | null>(null);
  const [cat, setCat] = useState<string>("");
  const [sub, setSub] = useState<string>("");
  const [sup, setSup] = useState<string>("");
  const [profile, setProfile] = useState<ProfileResp | null>(null);

  // Import JSON ref (⚠️ une seule déclaration)
  const jsonRef = useRef<HTMLInputElement>(null);

  // Analytics state
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [analyticsData, setAnalyticsData] = useState({
    topSuppliers: [{name: "Aucune donnée", value: 0}],
    monthlySpend: [{month: "Aucune donnée", amount: 0}],
    categoryDistribution: [{name: "Aucune donnée", value: 100}],
    paymentDelays: [{category: "Aucune donnée", avgDelay: 0}],
    kpis: {
      totalSpend: 0,
      avgOrderValue: 0,
      totalOrders: 0,
      avgPaymentDelay: 0
    }
  });

  // ----------------- Health + schema + summary init -----------------
  async function refreshSchema() {
    const r = await fetch(`${API}/schema`);
    const j = await r.json();
    setSchema(j.tables || {});
  }
  async function getHealth() {
    try {
      const r = await fetch(`${API}/health`);
      const j = await r.json();
      setHealth(j);
    } catch {
      setHealth({ ok: false });
    }
  }
  useEffect(() => {
    getHealth();
    refreshSchema();
    // fetchSummary(); // Commentez cette ligne
  }, []);

  // ----------------- CHAT -----------------
  async function onSend() {
    if (!input.trim() || loadingChat) return;
    const question = input.trim();
    setInput("");
    setLoadingChat(true);
    const newMessages = [...messages, { role: "user" as const, content: question }];
    setMessages(newMessages);

    try {
      const r = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question, history: messages }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setLastSQL(j.sql || "");
      setRows(j.rows || null);
      
      // Utiliser la réponse générée par le LLM si disponible
      const responseText = j.response || (j.sql ? `SQL exécuté:\n${j.sql}` : "Requête exécutée.");
      setMessages((m) => [...m, { role: "assistant", content: responseText }]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", content: `Erreur: ${e?.message || e}` }]);
    } finally {
      setLoadingChat(false);
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files || []).filter((f) => /\.xlsx?$/i.test(f.name));
    if (files.length) handleUpload(files);
  }
  function onFilesPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length) handleUpload(files);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleUpload(files: File[]) {
    setUploads((u) => [...u, ...files.map((f) => ({ name: f.name, status: "idle" as const }))]);

    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("table", file.name.replace(/\.xlsx?$/i, ""));
      try {
        const r = await fetch(`${API}/upload`, { method: "POST", body: fd });
        const j = await r.json();
        if (j.error) throw new Error(j.error);
        setUploads((u) =>
          u.map((it) => (it.name === file.name ? { ...it, status: "ok", msg: `Table ${j.table} (${j.columns?.length || 0} colonnes)` } : it))
        );
      } catch (e: any) {
        setUploads((u) => u.map((it) => (it.name === file.name ? { ...it, status: "err", msg: e?.message || String(e) } : it)));
      }
    }

    await refreshSchema();
    await fetchSummary();
  }

  const csv = useMemo(() => {
    if (!rows || !rows.length) return "";
    const headers = Object.keys(rows[0]);
    const esc = (v: any) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const body = rows.map((r) => headers.map((h) => esc(r[h])).join(",")).join("\n");
    return `${headers.join(",")}\n${body}`;
  }, [rows]);

  function copyCSV() {
    if (!csv) return;
    navigator.clipboard.writeText(csv);
  }

  function downloadCSV() {
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "resultats.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ----------------- CATALOGUE -----------------
  async function buildCatalog() {
    setBuilding(true);
    try {
      const r = await fetch(`${API}/catalog/build`, { method: "POST" });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      await fetchSummary();
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setBuilding(false);
    }
  }

  async function fetchSummary() {
    try {
      const r = await fetch(`${API}/catalog/summary`);
      const j: CatalogSummary = await r.json();
      if ((j as any).error) throw new Error((j as any).error);
      setSummary(j);
      // reset sélections si obsolètes
      if (j && cat && !(j.byCategory[cat]?.length)) {
        setCat(""); setSub(""); setSup(""); setProfile(null);
      }
    } catch {
      // pas encore construit : ignorer
    }
  }

  async function fetchProfile() {
    if (!sub || !sup) return;
    const q = new URLSearchParams({ subcategory: sub, supplier: sup });
    const r = await fetch(`${API}/catalog/profile?${q.toString()}`);
    const j: any = await r.json();
    if (j.error) { alert(j.error); return; }

    // Debug client
    try {
      console.log("[catalog/profile] stats:", j.stats);
      console.log("[catalog/profile] series.len:", Array.isArray(j.series) ? j.series.length : 0);
      if (Array.isArray(j.series) && !j.series.length) {
        console.log("[catalog/profile] series empty -> check order_date / delay_days on server");
      }
      if (j.quartiles) console.log("[catalog/profile] quartiles:", j.quartiles);
      if (j.debug) console.log("[catalog/profile] debug:", j.debug);
    } catch {}

    setProfile(j as ProfileResp);
  }

  useEffect(() => {
    if (sub && sup) fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub, sup]);

  const subcats = useMemo(() => (cat && summary ? summary.byCategory[cat] || [] : []), [cat, summary]);
  const suppliers = useMemo(() => {
    if (!sub || !summary) return [];
    const list = summary.bySubcategorySupplier[sub] || [];
    return ["ALL", ...list];
  }, [sub, summary]);

  // Export / Import JSON du catalogue
  async function exportCatalogJSON() {
    try {
      const r = await fetch(`${API}/catalog/export`);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      const blob = new Blob([JSON.stringify(j, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "catalogue.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e?.message || String(e));
    }
  }

  async function importCatalogJSON(file: File) {
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const r = await fetch(`${API}/catalog/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      await fetchSummary();
      if (sub && sup) await fetchProfile();
      alert("Catalogue importé.");
    } catch (e: any) {
      alert(e?.message || String(e));
    }
  }

  // ----------------- ANALYTICS -----------------
  async function fetchAnalyticsData() {
    setLoadingAnalytics(true);
    try {
      // Utiliser directement les requêtes au chatbot pour obtenir des données réelles
      // Requête pour les top fournisseurs
      const topSuppliersQuery = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Top 5 des fournisseurs par montant total" }),
      });
      const topSuppliersData = await topSuppliersQuery.json();
      
      // Requête pour les dépenses mensuelles
      const monthlySpendQuery = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Montant total des règlements par mois" }),
      });
      const monthlySpendData = await monthlySpendQuery.json();
      
      // Requête pour la distribution par catégorie
      const categoryQuery = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Montant total par catégorie de dépense" }),
      });
      const categoryData = await categoryQuery.json();
      
      // Requête pour les délais de paiement
      const delaysQuery = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Délai moyen de paiement par catégorie" }),
      });
      const delaysData = await delaysQuery.json();
      
      // Requête pour les KPIs
      const kpisQuery = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Montant total des dépenses, valeur moyenne des commandes, nombre total de commandes et délai moyen de paiement" }),
      });
      const kpisData = await kpisQuery.json();
      
      // Transformer les données des requêtes en format utilisable pour les graphiques
      const topSuppliers = topSuppliersData.rows?.map(row => ({
        name: row.trigramme || row.fournisseur || "Inconnu",
        value: parseFloat(row.montant_total || row.total || 0)
      })) || [];
      
      const monthlySpend = monthlySpendData.rows?.map(row => ({
        month: row.mois || row.month || "Inconnu",
        amount: parseFloat(row.montant_total || row.total || 0)
      })) || [];
      
      const categoryDistribution = categoryData.rows?.map(row => ({
        name: row.categorie || row.category || "Inconnu",
        value: parseFloat(row.montant_total || row.total || 0)
      })) || [];
      
      const paymentDelays = delaysData.rows?.map(row => ({
        category: row.categorie || row.category || "Inconnu",
        avgDelay: parseFloat(row.delai_moyen || row.avg_delay || 0)
      })) || [];
      
      // Extraire les KPIs des résultats
      let kpis = {
        totalSpend: 0,
        avgOrderValue: 0,
        totalOrders: 0,
        avgPaymentDelay: 0
      };
      
      if (kpisData.rows && kpisData.rows.length > 0) {
        const kpiRow = kpisData.rows[0];
        kpis = {
          totalSpend: parseFloat(kpiRow.montant_total || kpiRow.total_spend || 0),
          avgOrderValue: parseFloat(kpiRow.valeur_moyenne || kpiRow.avg_order_value || 0),
          totalOrders: parseInt(kpiRow.nombre_commandes || kpiRow.total_orders || 0),
          avgPaymentDelay: parseFloat(kpiRow.delai_moyen || kpiRow.avg_payment_delay || 0)
        };
      }
      
      setAnalyticsData({
        topSuppliers: topSuppliers.length > 0 ? topSuppliers : [{name: "Aucune donnée", value: 0}],
        monthlySpend: monthlySpend.length > 0 ? monthlySpend : [{month: "Aucune donnée", amount: 0}],
        categoryDistribution: categoryDistribution.length > 0 ? categoryDistribution : [{name: "Aucune donnée", value: 100}],
        paymentDelays: paymentDelays.length > 0 ? paymentDelays : [{category: "Aucune donnée", avgDelay: 0}],
        kpis
      });
    } catch (e) {
      console.error("Erreur lors de la récupération des données d'analytics:", e);
      // En cas d'erreur, définir des données minimales pour éviter les erreurs de rendu
      setAnalyticsData({
        topSuppliers: [{name: "Erreur de chargement", value: 0}],
        monthlySpend: [{month: "Erreur", amount: 0}],
        categoryDistribution: [{name: "Erreur", value: 100}],
        paymentDelays: [{category: "Erreur", avgDelay: 0}],
        kpis: {
          totalSpend: 0,
          avgOrderValue: 0,
          totalOrders: 0,
          avgPaymentDelay: 0
        }
      });
    } finally {
      setLoadingAnalytics(false);
    }
  }

  useEffect(() => {
    if (tab === "analytics") {
      fetchAnalyticsData();
    }
  }, [tab]); // Supprimez analyticsData de la dépendance pour éviter les appels en boucle

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f8fafc 0%, #ffffff 40%)",
        color: "#0f172a",
        fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial, \"Apple Color Emoji\", \"Segoe UI Emoji\"",
      }}
    >
      {/* HEADER */}
      <header
        style={{ position: "sticky", top: 0, zIndex: 10, backdropFilter: "saturate(180%) blur(6px)", background: "rgba(255,255,255,0.7)", borderBottom: "1px solid #e5e7eb" }}
      >
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "12px 20px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Database size={22} />
            <strong style={{ fontSize: 16 }}>Procure Chat</strong>
          </div>
          <nav style={{ marginLeft: 24, display: "flex", gap: 8 }}>
            <button onClick={() => setTab("chat")} style={{ padding: "8px 10px", borderRadius: 10, border: 0, background: tab === "chat" ? "#111827" : "transparent", color: tab === "chat" ? "#fff" : "#111827", cursor: "pointer" }}>Chat</button>
            <button onClick={() => setTab("catalog")} style={{ padding: "8px 10px", borderRadius: 10, border: 0, background: tab === "catalog" ? "#111827" : "transparent", color: tab === "catalog" ? "#fff" : "#111827", cursor: "pointer" }}>Catalogue</button>
            <button onClick={() => setTab("analytics")} style={{ padding: "8px 10px", borderRadius: 10, border: 0, background: tab === "analytics" ? "#111827" : "transparent", color: tab === "analytics" ? "#fff" : "#111827", cursor: "pointer" }}>Analytics</button>
          </nav>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <Badge color={health?.ok ? "#dcfce7" : "#fee2e2"} text={health?.ok ? "Backend OK" : "Backend KO"} />
            {health?.model && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#475569" }}>
                <Cpu size={16} /> {health.model}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* MAIN */}
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 20px", display: "grid", gap: 16 }}>
        {tab === "chat" && (
          <>
            {/* UPLOAD + SCHEMA ROW */}
            <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {/* Upload card */}
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
                style={{ border: `2px dashed ${isDragging ? "#2563eb" : "#cbd5e1"}`, background: isDragging ? "#eff6ff" : "#ffffff", padding: 20, borderRadius: 16, boxShadow: subtleShadow(), transition: "all .15s ease" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <UploadCloud />
                  <div>
                    <div style={{ fontWeight: 700 }}>Importer vos Excel</div>
                    <div style={{ fontSize: 13, color: "#475569" }}>Glissez-déposez ou choisissez des fichiers *.xlsx (Achats, Commandes, Décaissements)</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => fileRef.current?.click()} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#111827", color: "white", border: 0, borderRadius: 10, padding: "10px 14px", cursor: "pointer" }}>
                    <FileSpreadsheet size={18} /> Choisir des fichiers
                  </button>
                  <button onClick={refreshSchema} title="Rafraîchir schéma" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#e5e7eb", color: "#111827", border: 0, borderRadius: 10, padding: "10px 14px", cursor: "pointer" }}>
                    <RefreshCw size={16} /> Schéma
                  </button>
                  <input ref={fileRef} type="file" accept=".xlsx" multiple onChange={onFilesPicked} style={{ display: "none" }} />
                </div>
                {!!uploads.length && (
                  <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
                    {uploads.map((u, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: "#f8fafc", border: "1px solid #e2e8f0", padding: 10, borderRadius: 10 }}>
                        <FileSpreadsheet size={16} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{u.name}</div>
                          {u.msg && <div style={{ fontSize: 12, color: u.status === "err" ? "#b91c1c" : "#334155" }}>{u.msg}</div>}
                        </div>
                        {u.status === "ok" && <CheckCircle2 color="#16a34a" size={18} />}
                        {u.status === "err" && <AlertTriangle color="#b91c1c" size={18} />}
                        {u.status === "idle" && <Loader2 className="spin" size={18} />}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Schema card */}
              <div style={{ background: "#ffffff", borderRadius: 16, boxShadow: subtleShadow(), border: "1px solid #e5e7eb", padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <Table />
                  <div style={{ fontWeight: 700 }}>Schéma détecté</div>
                </div>
                <div style={{ maxHeight: 260, overflow: "auto", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(schema, null, 2)}</pre>
                </div>
              </div>
            </section>

            {/* CHAT */}
            <section style={{ background: "#ffffff", borderRadius: 16, boxShadow: subtleShadow(), border: "1px solid #e5e7eb", padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <MessageSquare />
                <div style={{ fontWeight: 700 }}>Chat analytique</div>
                <div style={{ marginLeft: "auto" }}>
                  <button onClick={() => { setMessages([]); setRows(null); setLastSQL(""); }} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#e5e7eb", color: "#111827", border: 0, borderRadius: 10, padding: "8px 10px", cursor: "pointer", fontSize: 13 }}>
                    <RefreshCw size={16} /> Nouvelle conversation
                  </button>
                </div>
              </div>

              <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                {messages.map((m, i) => (
                  <div key={i} style={{ background: m.role === "user" ? "#eff6ff" : "#f8fafc", border: "1px solid #e2e8f0", padding: 12, borderRadius: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.7, marginBottom: 4 }}>{m.role.toUpperCase()}</div>
                    <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
                  </div>
                ))}
                {loadingChat && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#475569" }}>
                    <Loader2 className="spin" size={16} /> Génération de la requête…
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ position: "relative", flex: 1 }}>
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ex: Top 20 des décaissements 2024 par fournisseur avec n° de commande"
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) onSend(); }}
                    style={{ 
                      width: "100%", 
                      padding: "12px 44px 12px 12px", 
                      border: "1px solid #e5e7eb", 
                      borderRadius: 12, 
                      outline: "none", 
                      fontSize: 14,
                      boxSizing: "border-box"
                    }}
                  />
                  <button
                    type="button"
                    onClick={onSend}
                    aria-label="Envoyer"
                    style={{
                      position: "absolute",
                      right: 8,
                      top: 6,
                      background: "transparent",
                      border: 0,
                      padding: 6,
                      cursor: "pointer",
                    }}
                  >
                    <Send size={18} />
                  </button>
                </div>
              </div>
            </section>

            {/* SQL & RESULTS */}
            <section style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
              {lastSQL && (
                <div style={{ background: "#ffffff", borderRadius: 16, boxShadow: subtleShadow(), border: "1px solid #e5e7eb", padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <Badge color="#dbeafe" text="SQL" />
                  </div>
                  <pre style={{ whiteSpace: "pre-wrap", margin: 0, background: "#0b1220", color: "#e2e8f0", padding: 12, borderRadius: 12, overflow: "auto" }}>{lastSQL}</pre>
                </div>
              )}

              {/* Ajout de la réponse en langage naturel */}
              {messages.length > 0 && messages[messages.length - 1].role === "assistant" && (
                <ChatResponse response={messages[messages.length - 1].content} />
              )}

              {rows && (
                <div style={{ background: "#ffffff", borderRadius: 16, boxShadow: subtleShadow(), border: "1px solid #e5e7eb", padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <Table />
                    <div style={{ fontWeight: 700 }}>Résultats ({rows.length})</div>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                      <button onClick={copyCSV} title="Copier CSV" style={{ background: "#e5e7eb", border: 0, borderRadius: 10, padding: "8px 10px", cursor: "pointer" }}>
                        <Copy size={16} />
                      </button>
                      <button onClick={downloadCSV} title="Télécharger CSV" style={{ background: "#e5e7eb", border: 0, borderRadius: 10, padding: "8px 10px", cursor: "pointer" }}>
                        <Download size={16} />
                      </button>
                    </div>
                  </div>

                  <div style={{ overflow: "auto", border: "1px solid #e5e7eb", borderRadius: 12 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                      <thead style={{ position: "sticky", top: 0, zIndex: 1, background: "#f8fafc" }}>
                        <tr>
                          {Object.keys(rows[0] || {}).map((k) => (
                            <th key={k} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i}>
                            {Object.keys(rows[0] || {}).map((k) => (
                              <td key={k} style={{ padding: 8, borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" }}>{String(r[k])}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        {tab === "catalog" && (
          <>
            {/* BUILD */}
            <section style={{ background: "#ffffff", borderRadius: 16, boxShadow: subtleShadow(), border: "1px solid #e5e7eb", padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <FolderTree />
                <div style={{ fontWeight: 700 }}>Catalogue de catégories</div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  <button onClick={buildCatalog} disabled={building} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: building ? "#94a3b8" : "#111827", color: "#fff", border: 0, borderRadius: 10, padding: "10px 14px", cursor: building ? "not-allowed" : "pointer" }}>
                    <Wand2 size={16} /> {building ? "Construction…" : "Construire / Mettre à jour"}
                  </button>
                  <button onClick={exportCatalogJSON} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#e5e7eb", color: "#111827", border: 0, borderRadius: 10, padding: "10px 14px", cursor: "pointer" }}>
                    <Download size={16} /> Exporter le catalogue
                  </button>
                  <button onClick={() => jsonRef.current?.click()} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#e5e7eb", color: "#111827", border: 0, borderRadius: 10, padding: "10px 14px", cursor: "pointer" }}>
                    <UploadCloud size={16} /> Importer le catalogue
                  </button>
                  <input
                    ref={jsonRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) importCatalogJSON(f);
                      if (jsonRef.current) jsonRef.current.value = "";
                    }}
                    style={{ display: "none" }}
                  />
                </div>
              </div>
              <div style={{ marginTop: 10, fontSize: 13, color: "#475569" }}>
                Le LLM analyse l'historique Achats (type ligne, description commande, description ligne), crée une hiérarchie catégories → sous-catégories, et associe les lignes. Les profils de décaissement sont ensuite calculés par sous-catégorie × fournisseur à partir des Décaissements (liens par N° commande et N° ligne commande).
              </div>
            </section>

            {/* PICKERS */}
            <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: "#ffffff", borderRadius: 16, boxShadow: subtleShadow(), border: "1px solid #e5e7eb", padding: 16 }}>
                <div style={{ display: "grid", gap: 10 }}>
                  <label style={{ fontWeight: 700 }}>Catégorie</label>
                  <select value={cat} onChange={(e) => { setCat(e.target.value); setSub(""); setSup(""); setProfile(null); }} style={{ padding: 10, border: "1px solid #e5e7eb", borderRadius: 10 }}>
                    <option value="">— choisir —</option>
                    {summary?.taxonomy.map((t) => (
                      <option key={t.category} value={t.category}>{t.category}</option>
                    ))}
                  </select>

                  <label style={{ fontWeight: 700 }}>Sous-catégorie</label>
                  <select value={sub} onChange={(e) => { setSub(e.target.value); setSup(""); setProfile(null); }} style={{ padding: 10, border: "1px solid #e5e7eb", borderRadius: 10 }}>
                    <option value="">— choisir —</option>
                    {subcats.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>

                  <label style={{ fontWeight: 700 }}>Fournisseur</label>
                  <select value={sup} onChange={(e) => setSup(e.target.value)} style={{ padding: 10, border: "1px solid #e5e7eb", borderRadius: 10 }}>
                    <option value="">— choisir —</option>
                    {suppliers.map((s) => (
                      s === "ALL"
                        ? <option key="ALL" value="ALL">— tous fournisseurs —</option>
                        : <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ background: "#ffffff", borderRadius: 16, boxShadow: subtleShadow(), border: "1px solid #e5e7eb", padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <Building2 />
                  <div style={{ fontWeight: 700 }}>Aperçu du catalogue</div>
                </div>
                <div style={{ maxHeight: 280, overflow: "auto", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
                  {!summary ? (
                    <div style={{ color: "#64748b" }}>Aucun catalogue encore construit.</div>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {summary.taxonomy.map((t) => (
                        <li key={t.category}>
                          <b>{t.category}</b>
                          <ul>
                            {t.subcategories.map((s) => (
                              <li key={s}>{s} {summary.counts && summary.counts[s] ? <span style={{ color: "#64748b" }}>({summary.counts[s]})</span> : null}</li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>

            {/* CHART */}
            <section style={{ background: "#ffffff", borderRadius: 16, boxShadow: subtleShadow(), border: "1px solid #e5e7eb", padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <Badge color="#dcfce7" text="Profils de décaissement" />
                {!!profile && (
                  <div style={{ marginLeft: "auto", display: "flex", gap: 16, color: "#334155", fontSize: 13 }}>
                    <div>Obs: <b>{profile.stats.n_payments}</b></div>
                    <div>Total: <b>{profile.stats.total.toLocaleString()}</b></div>
                    <div>Md: <b>{profile.stats.median_delay} j</b></div>
                    <div>P25/P75: <b>{profile.stats.p25} / {profile.stats.p75} j</b></div>
                    {profile.quartiles?.["1.0"] && <div>100%: <b>{profile.quartiles["1.0"].delay_days} j</b></div>}
                  </div>
                )}
              </div>

              {!sub || !sup ? (
                <div style={{ color: "#64748b" }}>Sélectionnez une sous-catégorie et un fournisseur pour visualiser le profil.</div>
              ) : !profile ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#475569" }}>
                  <Loader2 className="spin" size={16} /> Chargement du profil…
                </div>
              ) : (
                <>
                  <div style={{ height: 360 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={profile.series} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="delay_days" label={{ value: "Délai (jours)", position: "insideBottom", offset: -5 }} />
                        <YAxis label={{ value: "Montant", angle: -90, position: "insideLeft" }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="montant_total" name="Montant par délai" />

                        {/* Repères quartiles */}
                        {profile.quartiles?.["0.25"] && (
                          <ReferenceLine
                            x={profile.quartiles["0.25"].delay_days}
                            strokeDasharray="4 2"
                            label={{ value: "P25", position: "top" }}
                          />
                        )}
                        {profile.quartiles?.["0.5"] && (
                          <ReferenceLine
                            x={profile.quartiles["0.5"].delay_days}
                            strokeDasharray="4 2"
                            label={{ value: "Med", position: "top" }}
                          />
                        )}
                        {profile.quartiles?.["0.75"] && (
                          <ReferenceLine
                            x={profile.quartiles["0.75"].delay_days}
                            strokeDasharray="4 2"
                            label={{ value: "P75", position: "top" }}
                          />
                        )}
                        {profile.quartiles?.["1.0"] && (
                          <ReferenceLine
                            x={profile.quartiles["1.0"].delay_days}
                            strokeDasharray="4 2"
                            label={{ value: "100%", position: "top" }}
                          />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* DEBUG PANEL */}
                  <div style={{ marginTop: 12, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, color: "#334155", fontWeight: 600 }}>
                      <Bug size={16} /> Debug profil
                    </div>
                    <div style={{ fontSize: 13, color: "#334155", display: "grid", gap: 6 }}>
                      <div>
                        Séries (bars): <b>{profile.series?.length || 0}</b> | Paiements (delay != NULL): <b>{(profile.debug?.totalPaymentsWithDelay ?? profile.series.length) || 0}</b>
                      </div>
                      {profile.debug?.sampleSeriesHead?.length ? (
                        <div>
                          Exemples: {profile.debug.sampleSeriesHead.map((r, i) => (
                            <span key={i} style={{ marginRight: 8 }}>{`(d=${r.delay_days}, m=${r.montant_total})`}</span>
                          ))}
                        </div>
                      ) : (
                        <div>Aucun exemple (probable: tous les <i>delay_days</i> sont NULL — vérifier la date de commande côté source).</div>
                      )}
                      {profile.quartiles && (
                        <div>
                          Quartiles: {Object.entries(profile.quartiles).map(([k, v]) => (
                            <span key={k} style={{ marginRight: 12 }}>{k}: <b>{v.delay_days} j</b> (cum={v.cum_amount})</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </section>
          </>
        )}

        {tab === "analytics" && (
          <>
            <section style={{ background: "#ffffff", borderRadius: 16, boxShadow: subtleShadow(), border: "1px solid #e5e7eb", padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <PlayCircle />
                <div style={{ fontWeight: 700 }}>Analyse des données</div>
                <div style={{ marginLeft: "auto" }}>
                  <button onClick={() => setTab("chat")} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#e5e7eb", color: "#111827", border: 0, borderRadius: 10, padding: "8px 10px", cursor: "pointer", fontSize: 13 }}>
                    <MessageSquare size={16} /> Retour au chat
                  </button>
                </div>
              </div>

              <div style={{ display: "grid", gap: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div style={{ background: "#ffffff", borderRadius: 16, boxShadow: subtleShadow(), border: "1px solid #e5e7eb", padding: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <BarChart />
                      <div style={{ fontWeight: 700 }}>Top Fournisseurs par Montant Total</div>
                    </div>
                    <div style={{ height: 200 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={analyticsData.topSuppliers}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" />
                          <YAxis label={{ value: "Montant (€)", angle: -90, position: "insideLeft" }} />
                          <Tooltip />
                          <Bar dataKey="value" fill="#22c55e" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div style={{ background: "#ffffff", borderRadius: 16, boxShadow: subtleShadow(), border: "1px solid #e5e7eb", padding: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <BarChart />
                      <div style={{ fontWeight: 700 }}>Montant Total des Règlements Mensuels</div>
                    </div>
                    <div style={{ height: 200 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={analyticsData.monthlySpend}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="month" />
                          <YAxis label={{ value: "Montant (€)", angle: -90, position: "insideLeft" }} />
                          <Tooltip />
                          <Bar dataKey="amount" fill="#3b82f6" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div style={{ background: "#ffffff", borderRadius: 16, boxShadow: subtleShadow(), border: "1px solid #e5e7eb", padding: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <BarChart />
                      <div style={{ fontWeight: 700 }}>Distribution des Dépenses par Catégorie</div>
                    </div>
                    <div style={{ height: 200 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={analyticsData.categoryDistribution}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" />
                          <YAxis label={{ value: "Montant (€)", angle: -90, position: "insideLeft" }} />
                          <Tooltip />
                          <Bar dataKey="value" fill="#ef4444" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div style={{ background: "#ffffff", borderRadius: 16, boxShadow: subtleShadow(), border: "1px solid #e5e7eb", padding: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <BarChart />
                      <div style={{ fontWeight: 700 }}>Délai Moyen de Paiement par Catégorie</div>
                    </div>
                    <div style={{ height: 200 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={analyticsData.paymentDelays}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="category" />
                          <YAxis label={{ value: "Délai (jours)", angle: -90, position: "insideLeft" }} />
                          <Tooltip />
                          <Bar dataKey="avgDelay" fill="#8b5cf6" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                <div style={{ background: "#ffffff", borderRadius: 16, boxShadow: subtleShadow(), border: "1px solid #e5e7eb", padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <Cpu />
                    <div style={{ fontWeight: 700 }}>KPIs Généraux</div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Badge color="#dcfce7" text="Total Dépenses" />
                      <div style={{ fontSize: 13, color: "#334155" }}>{analyticsData.kpis.totalSpend.toLocaleString()} €</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Badge color="#fef3c7" text="Valeur Moyenne Commande" />
                      <div style={{ fontSize: 13, color: "#334155" }}>{analyticsData.kpis.avgOrderValue.toLocaleString()} €</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Badge color="#d1fae5" text="Nombre de Commandes" />
                      <div style={{ fontSize: 13, color: "#334155" }}>{analyticsData.kpis.totalOrders.toLocaleString()}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Badge color="#e0f2fe" text="Délai Moyen de Paiement" />
                      <div style={{ fontSize: 13, color: "#334155" }}>{analyticsData.kpis.avgPaymentDelay.toLocaleString()} jours</div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}
      </main>

      {/* tiny CSS helpers */}
      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
        ::selection { background: #bfdbfe; }
      `}</style>
    </div>
  );
}
