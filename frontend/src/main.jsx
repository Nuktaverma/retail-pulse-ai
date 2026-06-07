import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import Plot from "react-plotly.js";
import {
  AlertTriangle, ArrowUpRight, Boxes, ChartNoAxesCombined, CloudUpload,
  RefreshCw, Sparkles, Store, FileSpreadsheet, Activity, Lightbulb,
  Gauge, TrendingUp, DollarSign, PackageOpen, LayoutDashboard, Tag, PieChart,
  MessageCircle, Send, X, Bot, Folder, ChevronDown, Check, Plus, Trash2
} from "lucide-react";
import "./styles.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const plotConfig = { displayModeBar: false, responsive: true };
const getPlotLayout = () => ({
  autosize: true,
  margin: { l: 42, r: 18, t: 22, b: 42 },
  paper_bgcolor: "transparent",
  plot_bgcolor: "transparent",
  font: { color: "#94a3b8", family: "Inter, sans-serif", size: 11 },
  xaxis: { gridcolor: "rgba(255,255,255,0.05)", zerolinecolor: "rgba(255,255,255,0.05)" },
  yaxis: { gridcolor: "rgba(255,255,255,0.05)", zerolinecolor: "rgba(255,255,255,0.05)" },
  legend: { orientation: "h", y: 1.12 },
});

const apiFetch = async (url, options) => {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text);
  }
  return await response.json();
};

const emptyAnalytics = {
  has_data: false, kpis: {}, trend: [], stores: [], products: [], categories: [], promotion_impact: [], alerts: [], profile: null,
};

const asArray = (value) => Array.isArray(value) ? value : [];
const toNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const isValidDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) && !value.startsWith("1970-");
const generateId = () => "ws_" + Math.random().toString(36).substring(2, 9);

function App() {
  // --- Workspace & State Management ---
  const [workspaces, setWorkspaces] = useState({
    "default": {
      id: "default",
      name: "Primary Dataset",
      analytics: null,
      forecast: [],
      profile: null,
      uploaded: false,
      generated: false,
      lastValidationReport: null
    }
  });
  const [activeWsId, setActiveWsId] = useState("default");
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
  
  const activeWs = workspaces[activeWsId] || workspaces["default"];
  
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState("Ready for your sales data");
  const [busy, setBusy] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState("");
  const [uploadProgress, setUploadProgress] = useState("");
  const [currentPage, setCurrentPage] = useState("dataset");

  // Forecast Studio Inputs
  const [horizon, setHorizon] = useState(30);
  const [promoLift, setPromoLift] = useState(0);
  const [spike, setSpike] = useState(0);
  const [priceChange, setPriceChange] = useState(0);

  // Assistant State
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [chatHistory, setChatHistory] = useState([{
      role: "assistant",
      answer: "Ask me about products, stores, promotions, forecasts, inventory risk, or revenue trends. I will answer from your active workspace dataset.",
      supporting_metrics: {}, confidence: 1
  }]);

  // --- Workspace Actions ---
  const updateWorkspace = (id, data) => {
      setWorkspaces(prev => ({ ...prev, [id]: { ...prev[id], ...data } }));
  };

  const createWorkspace = () => {
      const name = prompt("Name your new workspace (e.g., Q3 Sales, Region B):", "New Workspace");
      if (!name) return;
      const newId = generateId();
      setWorkspaces(prev => ({
          ...prev,
          [newId]: { id: newId, name, analytics: null, forecast: [], profile: null, uploaded: false, generated: false, lastValidationReport: null }
      }));
      setActiveWsId(newId);
      setFile(null);
      setCurrentPage("dataset");
      setMessage("Ready for your sales data");
      setWsDropdownOpen(false);
  };

  const deleteWorkspace = async (id, e) => {
      e.stopPropagation();
      if (Object.keys(workspaces).length === 1) {
          alert("You must have at least one workspace active.");
          return;
      }
      if (confirm(`Are you sure you want to delete the workspace "${workspaces[id].name}" and all its data?`)) {
          const newWorkspaces = { ...workspaces };
          delete newWorkspaces[id];
          setWorkspaces(newWorkspaces);
          if (activeWsId === id) setActiveWsId(Object.keys(newWorkspaces)[0]);
          try {
              await apiFetch(`${API}/api/reset?workspace_id=${id}`, { method: "POST" });
          } catch (err) {
              console.error("Backend cleanup failed:", err);
          }
      }
  };

  const resetData = async () => {
    if (!confirm(`Are you sure you want to clear all analytics for workspace "${activeWs.name}"?`)) return;
    setBusy(true);
    try {
        await apiFetch(`${API}/api/reset?workspace_id=${activeWsId}`, { method: "POST" });
        updateWorkspace(activeWsId, { analytics: null, forecast: [], profile: null, uploaded: false, generated: false, lastValidationReport: null });
        setFile(null);
        setCurrentPage("dataset");
        setMessage("Workspace cleared. Ready for new data.");
    } catch (e) {
        console.error(e);
    } finally {
        setBusy(false);
    }
  };

  // --- Data Loading & Processing ---
  const buildDatasetProfile = (analyticsData, uploadResult = null) => {
      if (analyticsData.profile) return analyticsData.profile;
      return {
          row_count: uploadResult ? uploadResult.rows_processed : "Unknown",
          store_count: uploadResult ? uploadResult.stores : (analyticsData.stores?.length || 0),
          product_count: uploadResult ? uploadResult.products : (analyticsData.products?.length || 0),
          start_date: analyticsData.trend?.[0]?.date || "N/A",
          end_date: analyticsData.trend?.[analyticsData.trend?.length - 1]?.date || "N/A",
          missing_values: 0, duplicate_records: 0, invalid_records: 0,
          data_quality_score: 100.0, forecast_readiness: 100.0,
          category_count: analyticsData.profile?.category_count || 0,
          promotion_coverage_pct: analyticsData.profile?.promotion_coverage_pct || 0
      };
  };

  const load = async (wsId = activeWsId, navigateToData = false) => {
    setDataLoading(true); setDataError("");
    try {
      const timestamp = Date.now();
      const [analyticsData, forecastData] = await Promise.all([
          apiFetch(`${API}/api/analytics?workspace_id=${wsId}&t=${timestamp}`, { cache: "no-store" }), 
          apiFetch(`${API}/api/forecasts/latest?workspace_id=${wsId}&t=${timestamp}`, { cache: "no-store" })
      ]);
      
      if (analyticsData.success === false) throw new Error(analyticsData.error || "Analytics API failed");
      
      const hasData = analyticsData.has_data || (analyticsData.trend && analyticsData.trend.length > 0);
      
      updateWorkspace(wsId, {
          analytics: analyticsData,
          forecast: asArray(forecastData),
          profile: hasData ? buildDatasetProfile(analyticsData) : null,
          uploaded: hasData,
          generated: hasData
      });

      if (hasData && navigateToData) setCurrentPage("executive");
    } catch (e) {
      console.error(e);
      setDataError(e.message || "Unable to load analytics data");
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => { load(activeWsId, true); }, []);
  useEffect(() => { setFile(null); }, [activeWsId]);

  const upload = async () => {
    if (!file) return setMessage("Error: No file selected. Please choose a CSV file first.");
    setBusy(true); setUploadProgress("Uploading dataset...");
    
    try {
        const validateBody = new FormData();
        validateBody.append("file", file);
        validateBody.append("validate_only", "true");
        validateBody.append("workspace_id", activeWsId);

        setUploadProgress("Validating records...");
        const validationResult = await apiFetch(`${API}/api/upload-sales`, { method: "POST", body: validateBody });
        
        if (!validationResult.success) {
            setMessage(`Upload Error: ${validationResult.error || "Dataset validation failed"}`);
            updateWorkspace(activeWsId, { lastValidationReport: validationResult.validation_report || null });
            return;
        }

        const importBody = new FormData();
        importBody.append("file", file);
        importBody.append("validate_only", "false");
        importBody.append("workspace_id", activeWsId);
        
        setUploadProgress("Importing records...");
        const result = await apiFetch(`${API}/api/upload-sales`, { method: "POST", body: importBody });
        
        if (!result.success) {
            setMessage(`Upload Error: ${result.error || result.detail || 'Database failure'}`);
            return;
        }

        setUploadProgress("Generating analytics engine...");
        const timestamp = Date.now();
        const [analyticsData, forecastData] = await Promise.all([
            apiFetch(`${API}/api/analytics?workspace_id=${activeWsId}&t=${timestamp}`, { cache: "no-store" }),
            apiFetch(`${API}/api/forecasts/latest?workspace_id=${activeWsId}&t=${timestamp}`, { cache: "no-store" })
        ]);
        
        updateWorkspace(activeWsId, {
            analytics: analyticsData,
            forecast: asArray(forecastData),
            profile: buildDatasetProfile(analyticsData, result),
            lastValidationReport: result.validation_report || validationResult.validation_report || null,
            uploaded: true,
            generated: true
        });

        setMessage(`Success! Imported ${result.rows_processed} records to ${activeWs.name}.`);
        setCurrentPage("dataset"); 
        
    } catch (e) {
        console.error(e);
        setMessage("Connection Error: Backend unavailable or database failure.");
    } finally {
        setBusy(false); setUploadProgress("");
    }
  };

  const downloadSample = () => {
    const csvContent = "date,store_id,product_id,sales,price,promotion\n" +
      "2024-01-01,S001,P001,120,15.99,0\n" + "2024-01-02,S001,P001,140,15.99,1\n" +
      "2024-01-03,S001,P001,110,15.99,0\n" + "2024-01-04,S001,P001,160,15.99,1\n" +
      "2024-01-05,S001,P001,90,15.99,0\n" + "2024-01-01,S002,P001,80,15.99,0\n" +
      "2024-01-02,S002,P001,95,15.99,0\n" + "2024-01-01,S001,P002,40,45.00,0\n" +
      "2024-01-02,S001,P002,60,45.00,1\n" + "2024-01-03,S001,P002,45,45.00,0";
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url); link.setAttribute("download", "sample_sales.csv");
    link.style.visibility = 'hidden'; document.body.appendChild(link);
    link.click(); document.body.removeChild(link);
  };

  const generateForecast = async (e) => {
    if (e) e.preventDefault();
    setBusy(true); setDataError("");
    try {
      const result = await apiFetch(`${API}/api/forecasts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
            workspace_id: activeWsId,
            horizon_days: Number(horizon), 
            promotion_lift_pct: Number(promoLift), 
            demand_spike_pct: Number(spike),
            price_change_pct: Number(priceChange)
        }),
      });
      if (result.success === false) throw new Error(result.error || "Forecast generation failed");
      setMessage(`Generated ${result.forecasts_created} forecasts (${result.scenario})`);
      await load(activeWsId, false);
    } catch (error) {
      setMessage(`Forecast Error: ${error.message}`);
      setDataError(error.message);
    } finally {
      setBusy(false);
    }
  };

  const askAssistant = async (questionOverride = null) => {
      const question = (questionOverride || assistantInput).trim();
      if (!question || assistantBusy) return;

      setAssistantOpen(true); setAssistantInput(""); setAssistantBusy(true);
      setChatHistory(prev => [...prev, { role: "user", answer: question }]);

      try {
          const result = await apiFetch(`${API}/api/assistant/chat`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ question, workspace_id: activeWsId })
          });
          if (result.success === false) throw new Error(result.error || "Assistant unavailable");
          setChatHistory(prev => [...prev, { role: "assistant", ...result }]);
      } catch (error) {
          setChatHistory(prev => [...prev, {
              role: "assistant", answer: `**Error:** Could not reach the assistant API. Ensure the backend is running.`,
              supporting_metrics: { error: error.message }, confidence: 0
          }]);
      } finally {
          setAssistantBusy(false);
      }
  };

  // --- Memoized Data specific to Active Workspace ---
  const data = useMemo(() => {
      const source = activeWs.analytics && activeWs.analytics.success !== false ? activeWs.analytics : emptyAnalytics;
      return {
          ...emptyAnalytics, ...source,
          kpis: { ...emptyAnalytics.kpis, ...(source.kpis || {}) },
          trend: asArray(source.trend).filter(row => isValidDate(row.date)).map(row => ({ ...row, units: toNumber(row.units), revenue: toNumber(row.revenue) })),
          stores: asArray(source.stores), products: asArray(source.products), categories: asArray(source.categories),
          promotion_impact: asArray(source.promotion_impact), alerts: asArray(source.alerts),
      };
  }, [activeWs.analytics]);

  const forecastRows = useMemo(() => asArray(activeWs.forecast).filter(row => isValidDate(row.date)), [activeWs.forecast]);
  
  const combinedForecastData = useMemo(() => {
      const byDate = {};
      (data.trend || []).forEach(row => {
          if (!isValidDate(row.date)) return;
          if (!byDate[row.date]) byDate[row.date] = { date: row.date, actual: null, forecast: null, lower: null, upper: null };
          byDate[row.date].actual = (byDate[row.date].actual || 0) + toNumber(row.units);
      });
      forecastRows.forEach(row => {
          if (!isValidDate(row.date)) return;
          if (!byDate[row.date]) byDate[row.date] = { date: row.date, actual: null, forecast: null, lower: null, upper: null };
          byDate[row.date].forecast = (byDate[row.date].forecast || 0) + toNumber(row.predicted_units);
          byDate[row.date].lower = (byDate[row.date].lower || 0) + toNumber(row.lower_bound);
          byDate[row.date].upper = (byDate[row.date].upper || 0) + toNumber(row.upper_bound);
      });
      return Object.values(byDate).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  }, [data.trend, forecastRows]);

  const storeData = useMemo(() => {
      let s = [...(data.stores || [])].map(x => ({ ...x, store_id: x.store_code || x.store_id, revenue: toNumber(x.revenue !== undefined ? x.revenue : x.total_revenue), units: toNumber(x.units) })).filter(x => x.store_id && (x.revenue > 0 || x.units > 0));
      return s.sort((a, b) => b.revenue - a.revenue);
  }, [data.stores]);

  const productData = useMemo(() => {
      let p = [...(data.products || [])].map(x => ({ ...x, product_id: x.product_code || x.product_id, revenue: toNumber(x.revenue !== undefined ? x.revenue : x.total_revenue), units: toNumber(x.units) })).filter(x => x.product_id && (x.revenue > 0 || x.units > 0));
      return p.sort((a, b) => b.revenue - a.revenue);
  }, [data.products]);

  const abcClassification = useMemo(() => {
      const totalRevenue = productData.reduce((s, p) => s + p.revenue, 0);
      if (totalRevenue === 0) return { A: [], B: [], C: [] };
      const res = { A: [], B: [], C: [] };
      let cum = 0;
      for (const p of productData) {
          cum += p.revenue;
          const pct = cum / totalRevenue;
          if (pct <= 0.8 || res.A.length === 0) res.A.push(p);
          else if (pct <= 0.95 || res.B.length === 0) res.B.push(p);
          else res.C.push(p);
      }
      return res;
  }, [productData]);

  const categoryData = useMemo(() => {
      let c = [...(data.categories || [])].map(x => ({ category: x.category, revenue: toNumber(x.revenue) })).filter(x => x.category && x.revenue > 0);
      return c.sort((a,b) => b.revenue - a.revenue);
  }, [data.categories]);

  const averageDailyRevenue = useMemo(() => {
      const uniqueDays = new Set((data.trend || []).map(x => x.date)).size;
      return uniqueDays > 0 ? (Number(data.kpis?.revenue || 0) / uniqueDays) : 0;
  }, [data.trend, data.kpis]);

  const promoKey = (val) => (val === true || val === 1 || String(val).toLowerCase() === "true" || String(val).toLowerCase() === "yes") ? "promo" : "base";

  const promoHeatmap = useMemo(() => {
      const impactData = data.promotion_impact || [];
      const stores = [...new Set(impactData.map((x) => x.store_code))];
      const products = [...new Set(impactData.map((x) => x.product_code))];
      const lookup = {};
      impactData.forEach(x => { lookup[`${x.store_code}|${x.product_code}|${promoKey(x.promotion)}`] = x.avg_units; });

      const flatData = [];
      const z = products.map((product) => stores.map((store) => {
          const base = lookup[`${store}|${product}|base`] || 0;
          const promoted = lookup[`${store}|${product}|promo`] || 0;
          const lift = base ? Math.round(((promoted - base) / base) * 1000) / 10 : 0;
          flatData.push({ store, product, lift });
          return lift;
      }));
      return { stores, products, z, flatData };
  }, [data.promotion_impact]);

  const promoAnalytics = useMemo(() => {
      const impact = data.promotion_impact || [];
      let promoRev = 0, nonPromoRev = 0, promoOrders = 0;

      impact.forEach(x => {
          if (promoKey(x.promotion) === "promo") {
              promoRev += Number(x.total_revenue || 0);
              promoOrders += Number(x.total_units || 0);
          } else {
              nonPromoRev += Number(x.total_revenue || 0);
          }
      });

      let liftSum = 0, liftCount = 0;
      promoHeatmap.flatData.forEach(cell => {
          if (cell.lift !== 0) { liftSum += cell.lift; liftCount++; }
      });
      const avgLift = liftCount > 0 ? (liftSum / liftCount) : 0;

      const byProduct = {};
      impact.forEach(x => {
          const key = x.product_code;
          if (!byProduct[key]) byProduct[key] = { product_code: key, promoUnits: null, baseUnits: null };
          if (promoKey(x.promotion) === "promo") byProduct[key].promoUnits = Number(x.avg_units || 0);
          else byProduct[key].baseUnits = Number(x.avg_units || 0);
      });

      const productLifts = Object.values(byProduct)
          .filter(p => p.baseUnits != null && p.promoUnits != null && p.baseUnits > 0)
          .map(p => ({ product_code: p.product_code, lift_pct: ((p.promoUnits - p.baseUnits) / p.baseUnits) * 100 }))
          .sort((a, b) => b.lift_pct - a.lift_pct);

      return { promoRev, nonPromoRev, promoOrders, avgLift, productLifts };
  }, [data.promotion_impact, promoHeatmap]);

  const formatCurrency = (num) => {
      if (!num || isNaN(num)) return "$0";
      if (num >= 1000000) return `$${(num / 1000000).toFixed(1)}M`;
      if (num >= 1000) return `$${(num / 1000).toFixed(1)}K`;
      return `$${num.toLocaleString()}`;
  };

  const generateInsights = () => {
      if (!activeWs.generated) return null;
      const bullets = [];
      const totalRev = Number(data.kpis.revenue || 0);
      
      if (storeData.length > 0 && totalRev > 0) {
          const topStore = storeData[0];
          const pct = (topStore.revenue / totalRev) * 100;
          bullets.push(`${topStore.store_name || topStore.store_id} contributes ${pct.toFixed(1)}% of revenue. Replicate its inventory mix across lower-performing stores.`);
      }
      if (productData.length > 0 && totalRev > 0) {
          const topProduct = productData[0];
          const pct = (topProduct.revenue / totalRev) * 100;
          bullets.push(`${topProduct.product_name || topProduct.product_id} contributes ${pct.toFixed(1)}% of sales and shows sustained demand. Increase safety stock by 15% to prevent stockouts.`);
      }
      if (promoAnalytics.avgLift > 0) {
          bullets.push(`Promotions increased sales by ${promoAnalytics.avgLift.toFixed(1)}% on average. Expand high-performing promotion strategies to underperforming product categories.`);
      }
      const stockouts = data.alerts ? data.alerts.filter(a => a.status === 'stockout-risk') : [];
      if (stockouts.length > 0) {
          const skus = stockouts.map(a => a.product_code);
          let skuStr = skus.length > 2 ? `${skus[0]}–${skus[skus.length-1]}` : skus.join(', ');
          bullets.push(`${stockouts.length} products are projected to face stockouts within the next forecast period. Place replenishment orders for ${skuStr} immediately.`);
      }
      if (bullets.length === 0) bullets.push("No significant insights could be generated from the current dataset.");
      return bullets;
  };

  const EmptyState = () => (
    <div className="empty-state">
      <div className="hero">
         <Sparkles className="hero-icon" size={48} />
         <h1>Welcome to RetailPulse AI</h1>
         <p>Upload your retail sales dataset to <strong>{activeWs.name}</strong> to generate business intelligence.</p>
         
         <div className="features">
           <div className="feature"><TrendingUp size={16} /> Multiple Workspaces</div>
           <div className="feature"><Boxes size={16} /> Inventory Intelligence</div>
           <div className="feature"><Tag size={16} /> Promotion Analytics</div>
         </div>
         
         <div className="upload-box">
             <div className="upload-zone hero-upload">
                 <CloudUpload size={32} />
                 <strong>{file ? file.name : "Drop your sales dataset here"}</strong>
                 <span>Required CSV fields: date, store, product, sales/units, price. Optional: promotion, category, inventory, brand.</span>
                 <label>Browse Files<input type="file" accept=".csv" onChange={(e) => setFile(e.target.files[0])} /></label>
             </div>
             <button className="primary-btn" onClick={upload} disabled={busy || !file}>
                {busy && <RefreshCw className="spin" size={16} />}
                {busy ? (uploadProgress || "Processing...") : `Upload to ${activeWs.name}`}
             </button>
             <button className="secondary-btn" onClick={downloadSample}>Download Sample Dataset</button>
             {message !== "Ready for your sales data" && (
                 <div style={{ marginTop: "16px", color: message.includes("Error") ? "#f43f5e" : "#2dd4bf", fontSize: "13px", fontWeight: "500" }}>{message}</div>
             )}
         </div>
      </div>
    </div>
  );

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <div className="logo"><ChartNoAxesCombined size={20} /></div>
          <div><strong>RetailPulse</strong><span>BI PLATFORM</span></div>
        </div>

        {/* WORKSPACE SWITCHER */}
        <div className="workspace-selector">
            <button className="ws-active-btn" onClick={() => setWsDropdownOpen(!wsDropdownOpen)}>
                <span style={{display: 'flex', alignItems: 'center', gap: '8px'}}><Folder size={16}/> {activeWs.name}</span>
                <ChevronDown size={16}/>
            </button>
            {wsDropdownOpen && (
                <div className="ws-dropdown">
                    <div style={{maxHeight: '200px', overflowY: 'auto'}}>
                        {Object.values(workspaces).map(ws => (
                            <div key={ws.id} className={`ws-item ${ws.id === activeWsId ? 'active' : ''}`} onClick={() => { setActiveWsId(ws.id); setWsDropdownOpen(false); }}>
                                <span style={{display: 'flex', alignItems: 'center', gap: '8px'}}>{ws.name} {ws.id === activeWsId && <Check size={14}/>}</span>
                                <div className="ws-actions">
                                    <button className="ws-action-btn" onClick={(e) => deleteWorkspace(ws.id, e)}><Trash2 size={14}/></button>
                                </div>
                            </div>
                        ))}
                    </div>
                    <button className="ws-new-btn" onClick={createWorkspace}><Plus size={14}/> New Workspace</button>
                </div>
            )}
        </div>

        <nav style={{ opacity: !activeWs.uploaded ? 0.4 : 1, pointerEvents: !activeWs.uploaded ? 'none' : 'auto' }}>
          <a className={currentPage === "dataset" ? "active" : ""} onClick={() => setCurrentPage("dataset")}><FileSpreadsheet size={17} />Dataset Profiling</a>
          
          {activeWs.generated && (
            <>
              <div className="nav-header">ANALYTICS</div>
              <a className={currentPage === "executive" ? "active" : ""} onClick={() => setCurrentPage("executive")}><Activity size={17} />Executive Dashboard</a>
              <a className={currentPage === "sales" ? "active" : ""} onClick={() => setCurrentPage("sales")}><TrendingUp size={17} />Sales Overview</a>
              <a className={currentPage === "insights" ? "active" : ""} onClick={() => setCurrentPage("insights")}><Lightbulb size={17} />AI Insights</a>
              <a className={currentPage === "products" ? "active" : ""} onClick={() => setCurrentPage("products")}><PackageOpen size={17} />Product Analytics</a>
              <a className={currentPage === "stores" ? "active" : ""} onClick={() => setCurrentPage("stores")}><Store size={17} />Store Comparison</a>
              {data.promotion_impact.length > 0 && (
                 <a className={currentPage === "promotions" ? "active" : ""} onClick={() => setCurrentPage("promotions")}><Tag size={17} />Promotion Analytics</a>
              )}
              
              <div className="nav-header">INTELLIGENCE</div>
              <a className={currentPage === "forecast" ? "active" : ""} onClick={() => setCurrentPage("forecast")}><Sparkles size={17} />Forecast Studio</a>
              <a className={currentPage === "inventory" ? "active" : ""} onClick={() => setCurrentPage("inventory")}><Boxes size={17} />Inventory Intelligence</a>
              <a className={assistantOpen ? "active" : ""} onClick={() => setAssistantOpen(true)}><MessageCircle size={17} />AI Assistant</a>
            </>
          )}
        </nav>
        
        {activeWs.uploaded && (
            <div className="side-note">
               <span style={{display: "block", marginBottom: "8px"}}>System status</span>
               <div style={{display: "flex", alignItems: "center", marginBottom: "12px"}}>
                   <strong><i /> Synced</strong>
               </div>
               <button onClick={resetData} style={{ background: "transparent", border: "1px solid rgba(244, 63, 94, 0.4)", color: "#f43f5e", fontSize: "11px", padding: "8px", borderRadius: "6px", width: "100%", cursor: "pointer", transition: "all 0.2s" }}>
                   Clear Workspace
               </button>
            </div>
        )}
      </aside>

      <main className={!activeWs.uploaded ? "full-width" : ""}>
        {!activeWs.uploaded ? <EmptyState /> : (
          <>
            <header>
                <div>
                    <p className="eyebrow">WORKSPACE: {activeWs.name}</p>
                    <h1>{currentPage === "dataset" ? "Dataset Profiling" : currentPage.charAt(0).toUpperCase() + currentPage.slice(1).replace(/([A-Z])/g, ' $1').trim()}</h1>
                </div>
                <div className="status">{busy && <RefreshCw className="spin" size={15} />}{message}</div>
            </header>

            {currentPage === "dataset" && (
                <div className="fade-in">
                   <div className="kpis">
                      <Kpi title="Total Rows" value={activeWs.profile?.row_count?.toLocaleString() || "0"} detail="Records imported" accent="#60a5fa" />
                      <Kpi title="Data Quality" value={`${activeWs.profile?.data_quality_score || 0}%`} detail="Completeness score" accent="#2dd4bf" />
                      <Kpi title="Missing Values" value={activeWs.profile?.missing_values || 0} detail="Nulls detected" accent={activeWs.profile?.missing_values > 0 ? "#fb7185" : "#2dd4bf"} />
                      <Kpi title="Duplicate Rows" value={activeWs.profile?.duplicate_records || 0} detail="Exact matches" accent={activeWs.profile?.duplicate_records > 0 ? "#fb7185" : "#2dd4bf"} />
                   </div>
                   <section className="grid two">
                       <Card title="Dataset Metadata" subtitle="Core specifications mapped">
                           <div className="meta-grid">
                               <div className="meta-row"><span>Store Count</span><strong>{activeWs.profile?.store_count || 0} Locations</strong></div>
                               <div className="meta-row"><span>Product Count</span><strong>{activeWs.profile?.product_count || 0} SKUs</strong></div>
                               <div className="meta-row"><span>Category Count</span><strong>{activeWs.profile?.category_count || 0} Categories</strong></div>
                               <div className="meta-row"><span>Date Range</span><strong>{activeWs.profile?.start_date || "N/A"} to {activeWs.profile?.end_date || "N/A"}</strong></div>
                               <div className="meta-row"><span>Missing Values</span><strong>{activeWs.profile?.missing_values || 0}</strong></div>
                               <div className="meta-row"><span>Invalid Records</span><strong>{activeWs.profile?.invalid_records || 0}</strong></div>
                               <div className="meta-row"><span>Promotion Coverage</span><strong>{activeWs.profile?.promotion_coverage_pct || 0}%</strong></div>
                               <div className="meta-row"><span>Forecast Readiness</span><strong>{activeWs.profile?.forecast_readiness || 0}%</strong></div>
                           </div>
                           {activeWs.lastValidationReport && (
                              <div className="validation-report">
                                  <strong>Validation Report & Mapping</strong>
                                  <span>{activeWs.lastValidationReport.passed ? "Passed" : "Failed"} · {activeWs.lastValidationReport.row_count?.toLocaleString()} rows</span>
                                  <small>Mapping: {Object.entries(activeWs.lastValidationReport.column_mapping || {}).map(([from, to]) => `${from} ➔ ${to}`).join(" | ") || "No recognized columns"}</small>
                              </div>
                           )}
                       </Card>
                       <Card title="Data Quality Gauge" subtitle="Readiness for forecasting">
                           <div className="gauge-container">
                               <Gauge size={64} color={(activeWs.profile?.data_quality_score || 0) > 90 ? "#2dd4bf" : "#fbbf24"} />
                               <h2>{activeWs.profile?.data_quality_score || 0}%</h2>
                               <p>Quality Score</p>
                           </div>
                      </Card>
                   </section>
                </div>
            )}

            {currentPage === "executive" && (
                <div className="fade-in">
                    <section className="cards-row">
                       <Card title="Revenue Performance" subtitle="Gross tracking">
                           <div className="perf-card">
                               <div className="perf-header" style={{ marginBottom: "16px" }}>
                                   <h2 className="val" style={{fontSize: "24px", color: "#60a5fa"}}>{formatCurrency(data.kpis.revenue)}</h2>
                               </div>
                               <div className="perf-metrics">
                                   <div className="perf-metric"><span className="label">Units Sold</span><span className="val">{Number(data.kpis.units || 0).toLocaleString()}</span></div>
                                   <div className="perf-metric"><span className="label">Daily Pacing</span><span className="val">{formatCurrency(averageDailyRevenue)} / day</span></div>
                               </div>
                           </div>
                       </Card>
                       <Card title="Top Product" subtitle="Best selling SKU">
                           {productData.length > 0 ? (
                               <div className="perf-card">
                                   <div className="perf-header" style={{ marginBottom: "16px" }}>
                                       <h2 className="product-name" style={{fontSize: "18px"}}>{productData[0].product_name || `Product ${productData[0].product_id}`}</h2>
                                       <span className="sub-id">{productData[0].product_id}</span>
                                   </div>
                                   <div className="perf-metrics">
                                       <div className="perf-metric"><span className="label">Contribution</span><span className="val">{((productData[0].revenue / data.kpis.revenue) * 100).toFixed(1)}%</span></div>
                                       <div className="perf-metric"><span className="label">Units</span><span className="val">{productData[0].units.toLocaleString()}</span></div>
                                   </div>
                               </div>
                           ) : <EmptyChart />}
                       </Card>
                       <Card title="Top Store" subtitle="Revenue leader">
                           {storeData.length > 0 ? (
                               <div className="perf-card">
                                   <div className="perf-header" style={{ marginBottom: "16px" }}>
                                       <h2 className="store-name" style={{fontSize: "18px"}}>{storeData[0].store_name || `Store ${storeData[0].store_id}`}</h2>
                                       <span className="sub-id">{storeData[0].store_id}</span>
                                   </div>
                                   <div className="perf-metrics">
                                       <div className="perf-metric"><span className="label">Contribution</span><span className="val">{((storeData[0].revenue / data.kpis.revenue) * 100).toFixed(1)}%</span></div>
                                       <div className="perf-metric"><span className="label">Units</span><span className="val">{storeData[0].units.toLocaleString()}</span></div>
                                   </div>
                               </div>
                           ) : <EmptyChart />}
                       </Card>
                       <Card title="Actionable Alerts" subtitle="Intelligent monitoring">
                           {(() => {
                               if (!data.alerts || data.alerts.length === 0) return <div style={{padding: "16px 0", fontSize: "13px"}}>No active alerts.</div>;
                               const stockouts = data.alerts.filter(a => a.status === 'stockout-risk');
                               return (
                                   <div className="alerts-mini-list" style={{ display: 'grid', gap: '12px', paddingTop: '8px' }}>
                                       {stockouts.slice(0, 1).map(a => (
                                           <div key={a.product_code} style={{fontSize: "13px", lineHeight: "1.4"}}>
                                               🔴 <strong>Critical:</strong> {a.product_code} likely stockout in {a.days_to_stockout} days.
                                           </div>
                                       ))}
                                       {promoAnalytics.avgLift < 0 ? (
                                           <div style={{fontSize: "13px", lineHeight: "1.4"}}>🟡 <strong>Warning:</strong> Promotions caused negative lift ({(promoAnalytics.avgLift).toFixed(1)}%).</div>
                                       ) : promoAnalytics.avgLift > 0 ? (
                                           <div style={{fontSize: "13px", lineHeight: "1.4"}}>ℹ️ <strong>Info:</strong> Promotion campaign increased revenue {promoAnalytics.avgLift.toFixed(1)}%.</div>
                                       ) : null}
                                       {stockouts.length === 0 && promoAnalytics.avgLift === 0 && (
                                           <div style={{fontSize: "13px", lineHeight: "1.4"}}>ℹ️ <strong>Info:</strong> Inventory levels are healthy across tracking.</div>
                                       )}
                                   </div>
                               );
                           })()}
                       </Card>
                    </section>
                </div>
            )}

            {currentPage === "sales" && (
                <div className="fade-in">
                    <section className="kpis">
                      <Kpi title="Total Revenue" value={`$${Number(data.kpis.revenue || 0).toLocaleString()}`} detail="Gross" accent="#60a5fa" />
                      <Kpi title="Units Sold" value={Number(data.kpis.units || 0).toLocaleString()} detail="Volume" accent="#2dd4bf" />
                      <Kpi title="Avg Order Value" value={`$${(data.kpis.units > 0 ? data.kpis.revenue / data.kpis.units : 0).toFixed(2)}`} detail="Per unit" accent="#a78bfa" />
                      <Kpi title="Daily Revenue" value={`$${Math.round(averageDailyRevenue).toLocaleString()}`} detail="Pacing" accent="#38bdf8" />
                    </section>
                    <section className="grid two" style={{ marginTop: "24px" }}>
                        <Card title="Daily Sales Trend" subtitle="Revenue over time">
                            <ChartFrame loading={dataLoading} error={dataError} empty={!data.trend.length}>
                            {data.trend.length > 0 && (
                               <Plot className="plot compact" config={plotConfig} layout={getPlotLayout()} data={[{ x: data.trend.map(t => t.date), y: data.trend.map(t => t.revenue), type: "scatter", mode: "lines", fill: "tozeroy", marker: { color: "#60a5fa" }, line: { shape: "spline" } }]} />
                            )}
                            </ChartFrame>
                        </Card>
                        {(!categoryData || categoryData.length === 0) ? (
                            <div className="missing-category-state glass">
                                <AlertTriangle size={32} className="warning-icon" />
                                <h3>Category Analysis Unavailable</h3>
                                <p>No category column mapped for this workspace.</p>
                            </div>
                        ) : (
                            <Card title="Category Revenue Share" subtitle="Distribution by category">
                                <Plot className="plot compact" config={plotConfig} layout={getPlotLayout()} data={[{ labels: categoryData.map(c => c.category), values: categoryData.map(c => c.revenue), type: "pie", hole: 0.6, marker: { colors: ["#2dd4bf", "#60a5fa", "#a78bfa", "#f472b6"] } }]} />
                            </Card>
                        )}
                    </section>
                </div>
            )}

            {currentPage === "insights" && (
                <div className="fade-in">
                    <Card title="AI Executive Summary" subtitle={`Data-driven intelligence generated for ${activeWs.name}`}>
                        {(() => {
                            const summary = generateInsights();
                            if (!summary) return <EmptyChart />;
                            return (
                                <div className="executive-summary">
                                    <ul className="summary-bullets">
                                        {summary.map((bullet, idx) => (
                                            <li key={idx}>
                                                <span className="bullet-point">•</span>
                                                <span style={{ whiteSpace: "pre-line" }}>{bullet}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            );
                        })()}
                    </Card>
                </div>
            )}

            {currentPage === "products" && (
                <div className="fade-in">
                    <section className="kpis">
                      <Kpi title="Total Products" value={productData.length} detail="Active SKUs" accent="#60a5fa" />
                      <Kpi title="Top Revenue SKU" value={`$${productData.length ? productData[0].revenue.toLocaleString() : 0}`} detail={productData.length ? productData[0].product_id : "-"} accent="#2dd4bf" />
                      <Kpi title="Top Volume SKU" value={productData.length ? [...productData].sort((a,b)=>b.units-a.units)[0].units.toLocaleString() : 0} detail={productData.length ? [...productData].sort((a,b)=>b.units-a.units)[0].product_id : "-"} accent="#a78bfa" />
                      <Kpi title="A-Class SKU Count" value={abcClassification.A.length} detail="80% revenue drivers" accent="#f472b6" />
                    </section>
                    <div className="grid two" style={{ marginTop: "24px" }}>
                        <Card title="Top Products by Revenue" subtitle="Highest grossing SKUs">
                            <ChartFrame loading={dataLoading} error={dataError} empty={!productData.length}>
                            {productData.length > 0 && (
                               <Plot className="plot compact" config={plotConfig} layout={{ ...getPlotLayout(), margin: { ...getPlotLayout().margin, l: 80 } }} data={[{ x: productData.slice(0, 10).map((x) => x.revenue).reverse(), y: productData.slice(0, 10).map((x) => x.product_code).reverse(), type: "bar", orientation: "h", marker: { color: "#60a5fa" } }]} />
                            )}
                            </ChartFrame>
                        </Card>
                        <Card title="ABC Classification" subtitle="Pareto revenue contribution">
                            {productData.length > 0 ? (
                               <div className="abc-list">
                                   {['A', 'B', 'C'].map(cls => {
                                       const clsData = abcClassification[cls];
                                       const clsRev = clsData.reduce((s, x) => s + x.revenue, 0);
                                       const totalRev = Math.max(1, productData.reduce((s, x) => s + x.revenue, 0));
                                       const pct = ((clsRev / totalRev) * 100).toFixed(1);
                                       return (
                                           <div key={cls} className="abc-row">
                                               <div className={`abc-badge ${cls}`}>{cls}</div>
                                               <div className="abc-info">
                                                   <strong>{clsData.length} SKUs</strong>
                                                   <span>${clsRev.toLocaleString(undefined, {maximumFractionDigits: 0})} ({pct}%)</span>
                                               </div>
                                           </div>
                                       );
                                   })}
                               </div>
                            ) : <EmptyChart />}
                        </Card>
                    </div>
                </div>
            )}

            {currentPage === "stores" && (
                <div className="fade-in grid two">
                    <Card title="Store Revenue Ranking" subtitle="Performance across locations">
                        <ChartFrame loading={dataLoading} error={dataError} empty={!storeData.length}>
                        {storeData.length > 0 && (
                            <Plot className="plot compact" config={plotConfig} layout={{ ...getPlotLayout(), margin: { ...getPlotLayout().margin, l: 60 } }} data={[{ x: storeData.map((x) => x.revenue).reverse(), y: storeData.map((x) => x.store_code).reverse(), type: "bar", orientation: "h", marker: { color: "#2dd4bf" } }]} />
                        )}
                        </ChartFrame>
                    </Card>
                    <Card title="Store Unit Volume" subtitle="Units sold per store">
                        <ChartFrame loading={dataLoading} error={dataError} empty={!storeData.length}>
                        {storeData.length > 0 && (
                            <Plot className="plot compact" config={plotConfig} layout={getPlotLayout()} data={[{ labels: storeData.map(x => x.store_code), values: storeData.map(x => x.units), type: "pie", hole: 0.6, marker: { colors: ["#2dd4bf", "#60a5fa", "#a78bfa", "#fb7185", "#f472b6", "#38bdf8"] } }]} />
                        )}
                        </ChartFrame>
                    </Card>
                </div>
            )}

            {currentPage === "promotions" && (
                <div className="fade-in">
                    {activeWs.profile?.promotion_coverage_pct === 0 ? (
                        <div className="missing-category-state glass" style={{marginTop: "24px"}}>
                            <AlertTriangle size={32} className="warning-icon" />
                            <h3>PROMOTION ANALYTICS UNAVAILABLE</h3>
                            <p>This dataset does not contain promotion data to map.</p>
                        </div>
                    ) : (
                      <>
                        <section className="kpis">
                          <Kpi title="Promotion Revenue" value={`$${Math.round(promoAnalytics.promoRev).toLocaleString()}`} detail="Generated with promotion" accent="#60a5fa" />
                          <Kpi title="Non-Promo Revenue" value={`$${Math.round(promoAnalytics.nonPromoRev).toLocaleString()}`} detail="Generated without promotion" accent="#2dd4bf" />
                          <Kpi title="Avg Promotion Lift" value={`${promoAnalytics.avgLift.toFixed(1)}%`} detail="Across catalog" accent="#fb7185" />
                          <Kpi title="Incremental Units" value={Math.round(promoAnalytics.promoOrders).toLocaleString()} detail="Units driven" accent="#a78bfa" />
                        </section>
                        
                        <section className="grid two" style={{ marginTop: "24px" }}>
                            <Card title="Promotion Heatmap" subtitle="Average unit lift by store and product">
                                <Plot className="plot" config={plotConfig} layout={getPlotLayout()} data={[{ 
                                    x: promoHeatmap.stores, y: promoHeatmap.products, z: promoHeatmap.z, type: "heatmap", 
                                    hovertemplate: "Store: %{x}<br>Product: %{y}<br>Promotion Lift: %{z}%<extra></extra>",
                                    hoverlabel: { bgcolor: "#1e293b", bordercolor: "rgba(244, 63, 94, 0.4)", font: { color: "#f8fafc", family: "Inter, sans-serif", size: 13 }, align: "left" },
                                    colorscale: [[0, "rgba(255,255,255,0.05)"], [0.5, "#3b82f6"], [1, "#2dd4bf"]], colorbar: { title: "% lift", thickness: 8 } 
                                }]} />
                            </Card>
                            <Card title="Promotion Performance ROI" subtitle="Lift ranking and evaluation">
                                <div className="perf-metrics" style={{padding: "16px"}}>
                                    <div className="perf-metric"><span className="label">Best Promotion SKU</span><span className="val">{promoAnalytics.productLifts.length === 0 ? "-" : promoAnalytics.productLifts[0].product_code + " (+" + promoAnalytics.productLifts[0].lift_pct.toFixed(1) + "%)"}</span></div>
                                    <div className="perf-metric"><span className="label">Worst Promotion SKU</span><span className="val">{promoAnalytics.productLifts.length === 0 ? "-" : promoAnalytics.productLifts[promoAnalytics.productLifts.length - 1].product_code + " (" + promoAnalytics.productLifts[promoAnalytics.productLifts.length - 1].lift_pct.toFixed(1) + "%)"}</span></div>
                                    <div className="perf-metric"><span className="label">Revenue Contribution</span><span className="val">{promoAnalytics.promoRev > 0 ? ((promoAnalytics.promoRev / (promoAnalytics.promoRev + promoAnalytics.nonPromoRev)) * 100).toFixed(1) + "%" : "0%"}</span></div>
                                </div>
                                <Plot className="plot compact" config={plotConfig} layout={{...getPlotLayout(), height: 160}} data={[{ x: ["Promo", "Non-Promo"], y: [promoAnalytics.promoRev, promoAnalytics.nonPromoRev], type: "bar", marker: { color: ["#60a5fa", "#334155"] } }]} />
                            </Card>
                        </section>
                      </>
                    )}
                </div>
            )}

            {currentPage === "forecast" && (
                <div className="fade-in grid studio">
                  <Card title="What-if Forecast Studio" subtitle={`Model demand changes for ${activeWs.name}`}>
                    <div className="controls">
                      <Control label="Forecast Horizon" value={horizon} set={setHorizon} suffix="days" min="1" max="365" />
                      <Control label="Promotion Lift" value={promoLift} set={setPromoLift} suffix="%" min="-100" max="500" />
                      <Control label="Demand Spike" value={spike} set={setSpike} suffix="%" min="-100" max="500" />
                      <Control label="Price Change" value={priceChange} set={setPriceChange} suffix="%" min="-100" max="500" />
                    </div>
                    <button type="button" onClick={generateForecast} disabled={busy || !data.trend.length} className="primary-btn" style={{ width: "100%", marginTop: "16px" }}><Sparkles size={16} /> Generate Workspace Forecast</button>
                  </Card>
                  
                  <div style={{ gridColumn: "span 2" }}>
                      <Card title="Forecast vs Actuals" subtitle="Confidence bands and future demand">
                        <ChartFrame loading={dataLoading && !forecastRows.length} error={dataError} empty={data.trend.length < 30 || !forecastRows.length} emptyMsg={data.trend.length < 30 ? "Requires at least 30 days of sales history." : "Generate a forecast to view projections."}>
                        {data.trend.length >= 30 && forecastRows.length > 0 && (
                            <Plot className="plot compact" config={plotConfig} layout={getPlotLayout()} data={[
                              { x: combinedForecastData.map((x) => x.date), y: combinedForecastData.map((x) => x.upper), type: "scatter", mode: "lines", name: "Upper Bound", line: { width: 0 }, showlegend: false, hoverinfo: 'skip' },
                              { x: combinedForecastData.map((x) => x.date), y: combinedForecastData.map((x) => x.lower), type: "scatter", mode: "lines", fill: "tonexty", fillcolor: "rgba(167, 139, 250, 0.2)", name: "Confidence Interval", line: { width: 0 } },
                              { x: combinedForecastData.map((x) => x.date), y: combinedForecastData.map((x) => x.actual), type: "scatter", mode: "lines", name: "Actual Units", line: { color: "#2dd4bf", width: 2 } },
                              { x: combinedForecastData.map((x) => x.date), y: combinedForecastData.map((x) => x.forecast), type: "scatter", mode: "lines", name: "Forecast", line: { color: "#a78bfa", width: 3, dash: "dot" } },
                           ]} />
                        )}
                        </ChartFrame>
                      </Card>
                  </div>
                </div>
            )}
            
            {currentPage === "inventory" && (
                <div className="fade-in">
                   <div className="section-title">
                      <div>
                         <p className="eyebrow">INTELLIGENCE ENGINE</p>
                         <h2>Inventory Intelligence</h2>
                      </div>
                   </div>
                   {!data.alerts.length ? (
                      <div className="empty-alert" style={{ marginTop: '24px' }}>
                          <AlertTriangle size={20} /> Generate a forecast to unlock actionable stock recommendations.
                      </div>
                   ) : (
                      <>
                        <div className="grid kpis">
                           <Kpi title="Products at Risk" value={data.alerts.filter(a => a.status === 'stockout-risk').length} detail="High priority stockouts" accent="#ef4444" />
                           <Kpi title="Expected Stockouts" value={data.alerts.filter(a => a.status === 'stockout-risk' && a.current_stock < a.forecast_demand).length} detail="Demand exceeds supply" accent="#ef4444" />
                           <Kpi title="Reorder Recommendations" value={data.alerts.filter(a => a.recommended_order > 0).length} detail="Actionable SKUs" accent="#a78bfa" />
                           <Kpi title="Inventory Health Score" value={`${Math.round(((data.alerts.length - data.alerts.filter(a => a.status === 'stockout-risk').length) / Math.max(1, data.alerts.length)) * 100)}%`} detail="Across all products" accent={Math.round(((data.alerts.length - data.alerts.filter(a => a.status === 'stockout-risk').length) / Math.max(1, data.alerts.length)) * 100) > 80 ? "#2dd4bf" : "#f59e0b"} />
                        </div>
                        <div className="grid">
                           <Card title="AI Recommendations" subtitle="Actionable insights from inventory engine">
                              <div className="insights-list">
                                  {data.alerts.filter(a => a.status === 'stockout-risk').slice(0, 3).map((a, i) => (
                                     <div key={i} className="insight-card">
                                        <Lightbulb size={20} color="#ef4444" />
                                        <p>Product <strong>{a.product_code}</strong> projected to stock out. Current stock is {a.current_stock} but forecast demands {a.forecast_demand}. Increase reorder quantity by at least {a.recommended_order} units.</p>
                                     </div>
                                  ))}
                                  {data.alerts.filter(a => a.status === 'stockout-risk').length === 0 && (
                                     <div className="insight-card">
                                        <Lightbulb size={20} color="#2dd4bf" />
                                        <p>Inventory levels are optimal across all tracked product locations. No immediate reorders are required.</p>
                                     </div>
                                  )}
                              </div>
                           </Card>
                        </div>
                        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                           <Card title="Stockout Risk" subtitle="Risk levels across portfolio">
                               <Plot className="plot compact" config={plotConfig} layout={getPlotLayout()} data={[{ labels: ["High Risk", "Healthy"], values: [data.alerts.filter(a => a.status === 'stockout-risk').length, data.alerts.filter(a => a.status !== 'stockout-risk').length], type: "pie", hole: 0.6, marker: { colors: ["#ef4444", "#2dd4bf"] } }]} />
                           </Card>
                           <Card title="Risk by Product" subtitle="Projected stock deficits">
                               <ChartFrame empty={data.alerts.filter(a => a.status === 'stockout-risk').length === 0} emptyMsg="No products at risk.">
                                  {data.alerts.filter(a => a.status === 'stockout-risk').length > 0 && (
                                      <Plot className="plot compact" config={plotConfig} layout={{ ...getPlotLayout(), margin: { ...getPlotLayout().margin, l: 60 } }} data={[{ x: data.alerts.filter(a => a.status === 'stockout-risk').slice(0, 10).map(a => a.forecast_demand - a.current_stock).reverse(), y: data.alerts.filter(a => a.status === 'stockout-risk').slice(0, 10).map(a => a.product_code).reverse(), type: "bar", orientation: "h", marker: { color: "#ef4444" } }]} />
                                  )}
                               </ChartFrame>
                           </Card>
                           <Card title="Reorder Priority" subtitle="Top SKUs to replenish">
                               <ChartFrame empty={data.alerts.filter(a => a.recommended_order > 0).length === 0} emptyMsg="No reorders needed.">
                                  {data.alerts.filter(a => a.recommended_order > 0).length > 0 && (
                                      <Plot className="plot compact" config={plotConfig} layout={{ ...getPlotLayout(), margin: { ...getPlotLayout().margin, l: 60 } }} data={[{ x: data.alerts.filter(a => a.recommended_order > 0).slice(0, 10).map(a => a.recommended_order).reverse(), y: data.alerts.filter(a => a.recommended_order > 0).slice(0, 10).map(a => a.product_code).reverse(), type: "bar", orientation: "h", marker: { color: "#a78bfa" } }]} />
                                  )}
                               </ChartFrame>
                           </Card>
                        </div>
                        <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
                           <Card title="Inventory Decision Queue" subtitle="Action items based on forecast">
                               <table className="data-table" style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', fontSize: '13px' }}>
                                   <thead>
                                       <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                           <th style={{ padding: '12px' }}>Product</th>
                                           <th style={{ padding: '12px' }}>Current Stock</th>
                                           <th style={{ padding: '12px' }}>Forecast Demand</th>
                                           <th style={{ padding: '12px' }}>Risk Level</th>
                                           <th style={{ padding: '12px' }}>Recommended Action</th>
                                       </tr>
                                   </thead>
                                   <tbody>
                                       {data.alerts.slice(0, 20).map((a, i) => (
                                           <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                               <td style={{ padding: '12px', fontWeight: 'bold' }}>{a.product_code}</td>
                                               <td style={{ padding: '12px' }}>{a.current_stock}</td>
                                               <td style={{ padding: '12px' }}>{a.forecast_demand}</td>
                                               <td style={{ padding: '12px' }}>
                                                  <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold', background: a.status === 'stockout-risk' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(45, 212, 191, 0.2)', color: a.status === 'stockout-risk' ? '#ef4444' : '#2dd4bf' }}>
                                                      {a.status === 'stockout-risk' ? 'High' : 'Low'}
                                                  </span>
                                               </td>
                                               <td style={{ padding: '12px', color: a.recommended_order > 0 ? '#a78bfa' : '#9ca3af' }}>
                                                  {a.recommended_order > 0 ? `Reorder ${a.recommended_order} units` : 'No Action'}
                                               </td>
                                           </tr>
                                       ))}
                                   </tbody>
                               </table>
                           </Card>
                        </div>
                      </>
                   )}
                </div>
            )}
          </>
        )}
      </main>

      {/* Persistent AI Assistant */}
      <div style={{ position: "fixed", zIndex: 10000 }}>
          <button type="button" className="assistant-fab" onClick={() => setAssistantOpen(true)} title="AI Assistant">
              <MessageCircle size={22} />
          </button>
          <div className={`assistant-panel ${assistantOpen ? "open" : ""}`}>
              <div className="assistant-header">
                  <div>
                      <span><Bot size={16} /> Retail Analyst</span>
                      <strong>AI Business Assistant</strong>
                  </div>
                  <button type="button" onClick={() => setAssistantOpen(false)} title="Close assistant"><X size={18} /></button>
              </div>
              <div className="chat-history">
                  {chatHistory.map((msg, index) => (
                      <div key={index} className={`chat-message ${msg.role}`}>
                         <p>{msg.answer}</p>
                      </div>
                  ))}
                  {assistantBusy && <div className="typing"><span></span><span></span><span></span></div>}
              </div>
              <form className="assistant-input" onSubmit={(event) => { event.preventDefault(); askAssistant(); }}>
                  <input value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder={`Ask about ${activeWs.name}...`} />
                  <button type="submit" disabled={assistantBusy || !assistantInput.trim()}><Send size={16} /></button>
              </form>
          </div>
      </div>
    </div>
  );
}

// Utility Components 
function Kpi({ title, value, detail, accent }) { return <div className="kpi glass" style={{ "--accent": accent }}><span>{title}</span><strong>{value}</strong><small>{detail}</small></div>; }
function Card({ title, subtitle, children }) { return <article className="card glass"><div className="card-head"><div><h3>{title}</h3><p>{subtitle}</p></div></div>{children}</article>; }
function Control({ label, value, set, suffix, min, max }) { return <label className="control"><span>{label}</span><div><input type="number" value={value} min={min} max={max} onChange={(e) => set(e.target.value)} /><b>{suffix}</b></div></label>; }
function ChartFrame({ loading, error, empty, emptyMsg, children }) {
    if (loading) return <EmptyChart msg="Loading chart data..." />;
    if (error) return <EmptyChart msg={`Chart error: ${error}`} />;
    if (empty) return <EmptyChart msg={emptyMsg || "No chart data available."} />;
    return children;
}
function EmptyChart({ msg }) {
    return (
        <div className="empty-chart glass">
            <ChartNoAxesCombined size={32} color="rgba(255,255,255,0.2)" />
            <p>{msg || "Not enough data available"}</p>
        </div>
    );
}

createRoot(document.getElementById("root")).render(<App />);