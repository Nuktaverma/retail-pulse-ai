import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import Plot from "react-plotly.js";
import {
  AlertTriangle, ArrowUpRight, Boxes, ChartNoAxesCombined, CloudUpload,
  RefreshCw, Sparkles, Store, FileSpreadsheet, Activity, Lightbulb,
  Gauge, TrendingUp, DollarSign, PackageOpen, LayoutDashboard, Tag, PieChart,
  MessageCircle, Send, X, Bot
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
    console.log("API URL:", API);
    console.log("Status:", response.status);
    console.log("Response:", text);
    throw new Error(text);
  }
  const data = await response.json();
  return data;
};

const emptyAnalytics = {
  has_data: false,
  kpis: {},
  trend: [],
  stores: [],
  products: [],
  categories: [],
  promotion_impact: [],
  alerts: [],
  profile: null,
};

const asArray = (value) => Array.isArray(value) ? value : [];
const toNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const isValidDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) && !value.startsWith("1970-");

function App() {
  const [analytics, setAnalytics] = useState(null);
  const [forecast, setForecast] = useState([]);
  const [file, setFile] = useState(null);
  
  // Forecast Studio Inputs
  const [horizon, setHorizon] = useState(30);
  const [promoLift, setPromoLift] = useState(0);
  const [spike, setSpike] = useState(0);
  const [priceChange, setPriceChange] = useState(0);
  
  const [message, setMessage] = useState("Ready for your sales data");
  const [busy, setBusy] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState("");
  const [lastValidationReport, setLastValidationReport] = useState(null);
  const [uploadProgress, setUploadProgress] = useState("");
  const [datasetProfile, setDatasetProfile] = useState(null);
  
  // Phase 2: State Machine Architecture
  const [datasetUploaded, setDatasetUploaded] = useState(false);
  const [analyticsGenerated, setAnalyticsGenerated] = useState(false);
  const [currentPage, setCurrentPage] = useState("dataset");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [chatHistory, setChatHistory] = useState([
      {
          role: "assistant",
          answer: "Ask me about products, stores, promotions, forecasts, inventory risk, or revenue trends. I will answer from the uploaded dataset.",
          supporting_metrics: {},
          confidence: 1
      }
  ]);

  const buildDatasetProfile = (analyticsData, uploadResult = null) => {
      let profile;
      if (analyticsData.profile) {
          profile = analyticsData.profile;
      } else {
          profile = {
              row_count: uploadResult ? uploadResult.rows_processed : "Unknown",
              store_count: uploadResult ? uploadResult.stores : (analyticsData.stores?.length || 0),
              product_count: uploadResult ? uploadResult.products : (analyticsData.products?.length || 0),
              start_date: analyticsData.trend?.[0]?.date || "N/A",
              end_date: analyticsData.trend?.[analyticsData.trend?.length - 1]?.date || "N/A",
              missing_values: 0,
              duplicate_records: 0,
              invalid_records: 0,
              data_quality_score: 100.0,
              forecast_readiness: 100.0,
              category_count: analyticsData.profile?.category_count || 0,
              promotion_coverage_pct: analyticsData.profile?.promotion_coverage_pct || 0
          };
      }
      setDatasetProfile(profile);
      return profile;
  };

  const load = async ({ navigateToData = false } = {}) => {
    setDataLoading(true);
    setDataError("");
    try {
      const timestamp = Date.now();
      const [analyticsData, forecastData] = await Promise.all([
          apiFetch(`${API}/api/analytics?t=${timestamp}`, { cache: "no-store" }), 
          apiFetch(`${API}/api/forecasts/latest?t=${timestamp}`, { cache: "no-store" })
      ]);
      if (analyticsData.success === false) {
          throw new Error(analyticsData.error || "Analytics API failed");
      }
      if (forecastData.success === false) {
          throw new Error(forecastData.error || "Forecast API failed");
      }
      setAnalytics(analyticsData);
      setForecast(asArray(forecastData));
      
      if (analyticsData.has_data || (analyticsData.trend && analyticsData.trend.length > 0)) {
          buildDatasetProfile(analyticsData);
          setDatasetUploaded(true);
          setAnalyticsGenerated(true);
          if (navigateToData) setCurrentPage("executive");
      }
    } catch (e) {
      console.error(e);
      setDataError(e.message || "Unable to load analytics data");
      setMessage("Start the API to connect the dashboard");
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => { load({ navigateToData: true }); }, []);

  const upload = async () => {
    if (!file) {
        setMessage("Error: No file selected. Please choose a CSV file first.");
        return;
    }
    
    setBusy(true);
    setUploadProgress("Uploading dataset...");
    
    try {
        const body = new FormData();
        body.append("file", file);
        
        setUploadProgress("Validating records...");
        body.append("validate_only", "true");
        const validationResult = await apiFetch(`${API}/api/upload-sales`, { method: "POST", body });
        setLastValidationReport(validationResult.validation_report || null);
        if (!validationResult.success) {
            setMessage(`Upload Error: ${validationResult.error || "Dataset validation failed"}`);
            setBusy(false);
            setUploadProgress("");
            return;
        }

        const importBody = new FormData();
        importBody.append("file", file);
        importBody.append("validate_only", "false");
        setUploadProgress("Importing records...");
        const result = await apiFetch(`${API}/api/upload-sales`, { method: "POST", body: importBody });
        setLastValidationReport(result.validation_report || validationResult.validation_report || null);
        
        if (!result.success) {
            const errDetail = result.error || result.detail || 'Backend unavailable or database failure';
            const rowInfo = result.row ? ` (Row: ${result.row})` : '';
            setMessage(`Upload Error: ${errDetail}${rowInfo}`);
            setBusy(false);
            setUploadProgress("");
            return;
        }

        setDatasetUploaded(true);
        setCurrentPage("dataset");
        
        setUploadProgress("Generating analytics...");
        const timestamp = Date.now();
        const analyticsData = await apiFetch(`${API}/api/analytics?t=${timestamp}`, { cache: "no-store" });
        
        setAnalytics(analyticsData);
        buildDatasetProfile(analyticsData, result);
        
        const forecastData = await apiFetch(`${API}/api/forecasts/latest?t=${timestamp}`, { cache: "no-store" });
        setForecast(asArray(forecastData));
        
        setAnalyticsGenerated(true);
        setUploadProgress("Building dashboard...");
        await new Promise(r => setTimeout(r, 600));
        
        setMessage(`Success! Imported ${result.rows_processed} records. Detected ${result.stores} stores and ${result.products} products.`);
        setCurrentPage("dataset"); // Keep on dataset profiling right after upload
        
    } catch (e) {
        console.error(e);
        setMessage("Connection Error: Backend unavailable or database failure.");
    } finally {
        setBusy(false);
        setUploadProgress("");
    }
  };

  const downloadSample = () => {
    const csvContent = "date,store_id,product_id,sales,price,promotion\n" +
      "2024-01-01,S001,P001,120,15.99,0\n" +
      "2024-01-02,S001,P001,140,15.99,1\n" +
      "2024-01-03,S001,P001,110,15.99,0\n" +
      "2024-01-04,S001,P001,160,15.99,1\n" +
      "2024-01-05,S001,P001,90,15.99,0\n" +
      "2024-01-01,S002,P001,80,15.99,0\n" +
      "2024-01-02,S002,P001,95,15.99,0\n" +
      "2024-01-01,S001,P002,40,45.00,0\n" +
      "2024-01-02,S001,P002,60,45.00,1\n" +
      "2024-01-03,S001,P002,45,45.00,0";
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "sample_sales.csv");
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const resetData = async () => {
    if (!confirm("Are you sure you want to clear all current analytics and upload a new dataset?")) return;
    setBusy(true);
    try {
        await apiFetch(`${API}/api/reset`, { method: "POST" });
        setAnalytics(null);
        setForecast([]);
        setFile(null);
        setDatasetProfile(null);
        setLastValidationReport(null);
        setDatasetUploaded(false);
        setAnalyticsGenerated(false);
        setCurrentPage("dataset");
        setMessage("Ready for your sales data");
    } catch (e) {
        console.error(e);
    } finally {
        setBusy(false);
    }
  };

  const generate = async (e) => {
    if (e) e.preventDefault();
    setBusy(true);
    setDataError("");
    try {
      const result = await apiFetch(`${API}/api/forecasts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
            horizon_days: Number(horizon), 
            promotion_lift_pct: Number(promoLift), 
            demand_spike_pct: Number(spike),
            price_change_pct: Number(priceChange)
        }),
      });
      if (result.success === false) {
          throw new Error(result.error || result.detail || "Forecast generation failed");
      }
      setMessage(`Generated ${result.forecasts_created} forecasts (${result.scenario})`);
      await load({ navigateToData: false });
      setCurrentPage("forecast");
    } catch (error) {
      setMessage(`Forecast Error: ${error.message}`);
      setDataError(error.message);
    } finally {
      setBusy(false);
    }
  };

  const suggestedQuestions = [
      "Best selling product?",
      "Top performing store?",
      "Inventory risks?",
      "Forecast next month demand?",
      "Promotion effectiveness?",
      "Explain today's insights."
  ];

  const askAssistant = async (questionOverride = null) => {
      const question = (questionOverride || assistantInput).trim();
      if (!question || assistantBusy) return;

      setAssistantOpen(true);
      setAssistantInput("");
      setAssistantBusy(true);
      setChatHistory(prev => [...prev, { role: "user", answer: question }]);

      try {
          const result = await apiFetch(`${API}/api/assistant/chat`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ question })
          });
          if (result.success === false) {
              throw new Error(result.error || "Assistant unavailable");
          }
          setChatHistory(prev => [...prev, { role: "assistant", ...result }]);
      } catch (error) {
          setChatHistory(prev => [...prev, {
              role: "assistant",
              answer: `**Observation:** I could not reach the assistant API.\n\n**Impact:** I cannot safely answer without dataset access.\n\n**Recommendation:** Check that the backend is running and try again.`,
              supporting_metrics: { error: error.message },
              confidence: 0.2
          }]);
      } finally {
          setAssistantBusy(false);
      }
  };

  const data = useMemo(() => {
      const source = analytics && analytics.success !== false ? analytics : emptyAnalytics;
      return {
          ...emptyAnalytics,
          ...source,
          kpis: { ...emptyAnalytics.kpis, ...(source.kpis || {}) },
          trend: asArray(source.trend).filter(row => isValidDate(row.date)).map(row => ({ ...row, units: toNumber(row.units), revenue: toNumber(row.revenue) })),
          stores: asArray(source.stores),
          products: asArray(source.products),
          categories: asArray(source.categories),
          promotion_impact: asArray(source.promotion_impact),
          alerts: asArray(source.alerts),
      };
  }, [analytics]);

  const forecastRows = useMemo(() => asArray(forecast).filter(row => isValidDate(row.date)), [forecast]);

  const forecastTotal = useMemo(() => forecastRows.reduce((sum, row) => sum + toNumber(row.predicted_units), 0), [forecastRows]);
  const combinedForecastData = useMemo(() => {
      const byDate = {};
      (data.trend || []).forEach(row => {
          const d = row.date;
          if (!isValidDate(d)) return;
          if (!byDate[d]) byDate[d] = { date: d, actual: null, forecast: null, lower: null, upper: null };
          byDate[d].actual = (byDate[d].actual || 0) + toNumber(row.units);
      });
      forecastRows.forEach(row => {
          const d = row.date;
          if (!isValidDate(d)) return;
          if (!byDate[d]) byDate[d] = { date: d, actual: null, forecast: null, lower: null, upper: null };
          byDate[d].forecast = (byDate[d].forecast || 0) + toNumber(row.predicted_units);
          byDate[d].lower = (byDate[d].lower || 0) + toNumber(row.lower_bound);
          byDate[d].upper = (byDate[d].upper || 0) + toNumber(row.upper_bound);
      });
      return Object.values(byDate).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  }, [data.trend, forecastRows]);

  const promoHeatmap = useMemo(() => {
    const impactData = data.promotion_impact || [];
    const stores = [...new Set(impactData.map((x) => x.store_code))];
    const products = [...new Set(impactData.map((x) => x.product_code))];
    const lookup = Object.fromEntries(impactData.map((x) => [`${x.store_code}|${x.product_code}|${x.promotion}`, x.avg_units]));
    
    const flatData = [];
    const z = products.map((product) => stores.map((store) => {
      const base = lookup[`${store}|${product}|false`] || lookup[`${store}|${product}|0`] || lookup[`${store}|${product}|False`] || 0;
      const promoted = lookup[`${store}|${product}|true`] || lookup[`${store}|${product}|1`] || lookup[`${store}|${product}|True`] || 0;
      const lift = base ? Math.round(((promoted - base) / base) * 1000) / 10 : 0;
      flatData.push({ store, product, lift });
      return lift;
    }));
    return { stores, products, z, flatData };
  }, [data.promotion_impact]);

  const storeData = useMemo(() => {
      let stores = [...(data.stores || [])].map(s => ({
          ...s,
          store_id: s.store_code || s.store_id,
          revenue: toNumber(s.revenue !== undefined ? s.revenue : s.total_revenue),
          units: toNumber(s.units)
      })).filter(s => s.store_id && (s.revenue > 0 || s.units > 0));
      stores.sort((a, b) => b.revenue - a.revenue);
      return stores;
  }, [data.stores]);

  const productData = useMemo(() => {
      let products = [...(data.products || [])].map(p => ({
          ...p,
          product_id: p.product_code || p.product_id,
          revenue: toNumber(p.revenue !== undefined ? p.revenue : p.total_revenue),
          units: toNumber(p.units)
      })).filter(p => p.product_id && (p.revenue > 0 || p.units > 0));
      products.sort((a, b) => b.revenue - a.revenue);
      return products;
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

  const averageDailyRevenue = useMemo(() => {
      const uniqueDays = new Set((data.trend || []).map(x => x.date)).size;
      const totalRev = Number(data.kpis?.revenue || 0);
      return uniqueDays > 0 ? (totalRev / uniqueDays) : 0;
  }, [data.trend, data.kpis]);
  
  const categoryData = useMemo(() => {
      let cats = [...(data.categories || [])].map(c => ({
          category: c.category,
          revenue: toNumber(c.revenue)
      })).filter(c => c.category && c.revenue > 0);
      cats.sort((a,b) => b.revenue - a.revenue);
      return cats;
  }, [data.categories]);

  const promoAnalytics = useMemo(() => {
      const impact = data.promotion_impact || [];
      let promoRev = 0;
      let nonPromoRev = 0;
      let promoOrders = 0;
      
      impact.forEach(x => {
          const isPromo = String(x.promotion).toLowerCase() === "true" || x.promotion === 1;
          if (isPromo) {
              promoRev += Number(x.total_revenue || 0);
              promoOrders += Number(x.total_units || 0); // treating units as proxy if order count isn't there
          } else {
              nonPromoRev += Number(x.total_revenue || 0);
          }
      });
      
      // Calculate average lift
      let liftSum = 0, liftCount = 0;
      promoHeatmap.flatData.forEach(cell => {
          if (cell.lift !== 0) {
              liftSum += cell.lift;
              liftCount++;
          }
      });
      const avgLift = liftCount > 0 ? (liftSum / liftCount) : 0;

      return { promoRev, nonPromoRev, promoOrders, avgLift };
  }, [data.promotion_impact, promoHeatmap]);

  const formatCurrency = (num) => {
      if (num >= 1000000) return `$${(num / 1000000).toFixed(1)}M`;
      if (num >= 1000) return `$${(num / 1000).toFixed(1)}K`;
      return `$${num.toLocaleString()}`;
  };

  const generateInsights = () => {
    if (!analyticsGenerated) return null;
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
    
    if (bullets.length === 0) {
        bullets.push("No significant insights could be generated from the current dataset.");
    }
    
    return bullets;
  };

  const EmptyState = () => (
    <div className="empty-state">
      <div className="hero">
         <Sparkles className="hero-icon" size={48} />
         <h1>Welcome to RetailPulse AI</h1>
         <p>Upload your retail sales dataset to generate AI-powered business intelligence.</p>
         
         <div className="features">
           <div className="feature"><TrendingUp size={16} /> Demand Forecasts</div>
           <div className="feature"><Boxes size={16} /> Inventory Intelligence</div>
           <div className="feature"><Tag size={16} /> Promotion Analytics</div>
           <div className="feature"><LayoutDashboard size={16} /> Executive Dashboard</div>
         </div>
         
         <div className="upload-box">
             <div className="upload-zone hero-upload">
                 <CloudUpload size={32} />
                 <strong>{file ? file.name : "Drop your sales dataset here"}</strong>
                 <span>Required CSV fields: date, store, product, sales/units, price. Optional: promotion, category, inventory, brand, supplier.</span>
                 <label>Browse Files<input type="file" accept=".csv" onChange={(e) => setFile(e.target.files[0])} /></label>
             </div>
             <button className="primary-btn" onClick={upload} disabled={busy || !file}>
                {busy && <RefreshCw className="spin" size={16} />}
                {busy ? (uploadProgress || "Processing...") : "Upload Dataset"}
             </button>
             <button className="secondary-btn" onClick={downloadSample}>
                Download Sample Dataset
             </button>
             {message !== "Ready for your sales data" && (
                 <div style={{ marginTop: "16px", color: message.includes("Error") ? "#f43f5e" : "#2dd4bf", fontSize: "13px", fontWeight: "500", textAlign: "center" }}>
                     {message}
                 </div>
             )}
         </div>
      </div>
    </div>
  );

  return (
    <div className="shell">
      {datasetUploaded && (
          <aside>
            <div className="brand">
              <div className="logo"><ChartNoAxesCombined size={20} /></div>
              <div><strong>RetailPulse</strong><span>BI PLATFORM</span></div>
            </div>
            <nav>
              <a className={currentPage === "dataset" ? "active" : ""} onClick={() => setCurrentPage("dataset")}><FileSpreadsheet size={17} />Dataset Profiling</a>
              
              {analyticsGenerated && (
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
            <div className="side-note">
               <span style={{display: "block", marginBottom: "8px"}}>System status</span>
               <div style={{display: "flex", alignItems: "center", marginBottom: "12px"}}>
                   <strong><i /> Synced</strong>
               </div>
               <button onClick={resetData} style={{ background: "transparent", border: "1px solid rgba(244, 63, 94, 0.4)", color: "#f43f5e", fontSize: "11px", padding: "8px", borderRadius: "6px", width: "100%", cursor: "pointer", transition: "all 0.2s" }}>
                   Clear Workspace
               </button>
            </div>
          </aside>
      )}

      <main className={!datasetUploaded ? "full-width" : ""}>
        {!datasetUploaded ? <EmptyState /> : (
          <>
            <header>
                <div>
                    <p className="eyebrow">RETAIL INTELLIGENCE PLATFORM</p>
                    <h1>{currentPage === "dataset" ? "Dataset Profiling" : currentPage.charAt(0).toUpperCase() + currentPage.slice(1).replace(/([A-Z])/g, ' $1').trim()}</h1>
                    <p>Powered by RetailPulse AI Engine.</p>
                </div>
                <div className="status">{busy && <RefreshCw className="spin" size={15} />}{message}</div>
            </header>

            {currentPage === "dataset" && (
                <div className="fade-in">
                   <div className="kpis">
                      <Kpi title="Total Rows" value={datasetProfile?.row_count?.toLocaleString() || "0"} detail="Records imported" accent="#60a5fa" />
                      <Kpi title="Data Quality" value={`${datasetProfile?.data_quality_score || 0}%`} detail="Completeness score" accent="#2dd4bf" />
                      <Kpi title="Missing Values" value={datasetProfile?.missing_values || 0} detail="Nulls detected" accent={datasetProfile?.missing_values > 0 ? "#fb7185" : "#2dd4bf"} />
                      <Kpi title="Duplicate Rows" value={datasetProfile?.duplicate_records || 0} detail="Exact matches" accent={datasetProfile?.duplicate_records > 0 ? "#fb7185" : "#2dd4bf"} />
                   </div>
                   <section className="grid two">
                       <Card title="Dataset Metadata" subtitle="Core specifications">
                           <div className="meta-grid">
                               <div className="meta-row"><span>Total Rows</span><strong>{datasetProfile?.row_count?.toLocaleString() || 0}</strong></div>
                               <div className="meta-row"><span>Column Count</span><strong>{datasetProfile?.column_count || 0}</strong></div>
                               <div className="meta-row"><span>Store Count</span><strong>{datasetProfile?.store_count || 0} locations</strong></div>
                               <div className="meta-row"><span>Product Count</span><strong>{datasetProfile?.product_count || 0} SKUs</strong></div>
                               <div className="meta-row"><span>Category Count</span><strong>{datasetProfile?.category_count || 0} Categories</strong></div>
                               <div className="meta-row"><span>Date Range</span><strong>{datasetProfile?.start_date || "N/A"} to {datasetProfile?.end_date || "N/A"}</strong></div>
                               <div className="meta-row"><span>Missing Values</span><strong>{datasetProfile?.missing_values || 0}</strong></div>
                               <div className="meta-row"><span>Duplicate Records</span><strong>{datasetProfile?.duplicate_records || 0}</strong></div>
                               <div className="meta-row"><span>Invalid Records</span><strong>{datasetProfile?.invalid_records || 0}</strong></div>
                               <div className="meta-row"><span>Promotion Coverage</span><strong>{datasetProfile?.promotion_coverage_pct || 0}%</strong></div>
                               <div className="meta-row"><span>Forecast Readiness</span><strong>{datasetProfile?.forecast_readiness || 0}%</strong></div>
                           </div>
                           {lastValidationReport && (
                              <div className="validation-report">
                                  <strong>Validation Report</strong>
                                  <span>{lastValidationReport.passed ? "Passed" : "Failed"} · {lastValidationReport.row_count?.toLocaleString()} rows · {lastValidationReport.duplicate_rows || 0} duplicates</span>
                                  <small>Column mapping: {Object.entries(lastValidationReport.column_mapping || {}).map(([from, to]) => `${from} -> ${to}`).join(", ") || "No recognized columns"}</small>
                              </div>
                           )}
                       </Card>
                       <Card title="Data Quality Gauge" subtitle="Penalty-calculated health">
                           <div className="gauge-container">
                               <Gauge size={64} color={(datasetProfile?.data_quality_score || 0) > 90 ? "#2dd4bf" : "#fbbf24"} />
                               <h2>{datasetProfile?.data_quality_score || 0}%</h2>
                               <p>Quality Score</p>
                               {!analyticsGenerated && (
                                 <button className="primary-btn" style={{ marginTop: "24px", width: "100%" }} onClick={() => setCurrentPage("executive")}>
                                     Generate Analytics Engine <ArrowUpRight size={16} />
                                 </button>
                               )}
                           </div>
                      </Card>
                   </section>
                </div>
            )}

            {currentPage === "executive" && (
                <div className="fade-in">
                    <section className="kpis cards-row">
                       <Card title="Revenue Performance" subtitle="Gross vs pacing">
                           {(() => {
                               const currentWeekRev = data.trend?.length >= 7 ? data.trend.slice(-7).reduce((a, b) => a + b.revenue, 0) : 0;
                               const prevWeekRev = data.trend?.length >= 14 ? data.trend.slice(-14, -7).reduce((a, b) => a + b.revenue, 0) : 0;
                               const revGrowth = prevWeekRev > 0 ? ((currentWeekRev - prevWeekRev) / prevWeekRev) * 100 : 0;
                               const trendIndicator = revGrowth > 0 ? "📈" : revGrowth < 0 ? "📉" : "➖";
                               return (
                                   <div className="perf-card">
                                       <div className="perf-header" style={{ marginBottom: "16px" }}>
                                           <h2 className="val" style={{fontSize: "24px", color: "#60a5fa"}}>{formatCurrency(data.kpis.revenue)}</h2>
                                           {revGrowth !== 0 && <span className="sub-id">{trendIndicator} {Math.abs(revGrowth).toFixed(1)}%</span>}
                                       </div>
                                       <div className="perf-metrics">
                                           <div className="perf-metric"><span className="label">Units Sold</span><span className="val">{Number(data.kpis.units || 0).toLocaleString()}</span></div>
                                           <div className="perf-metric"><span className="label">Daily Pacing</span><span className="val">{formatCurrency(averageDailyRevenue)} / day</span></div>
                                       </div>
                                   </div>
                               );
                           })()}
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
                                               🔴 <strong>Critical:</strong> {a.product_code} likely stockout in {a.days_to_stockout} days. <em>Order now.</em>
                                           </div>
                                       ))}
                                       {promoAnalytics.avgLift < 0 ? (
                                           <div style={{fontSize: "13px", lineHeight: "1.4"}}>
                                               🟡 <strong>Warning:</strong> Promotions caused negative lift ({(promoAnalytics.avgLift).toFixed(1)}%).
                                           </div>
                                       ) : promoAnalytics.avgLift > 0 ? (
                                           <div style={{fontSize: "13px", lineHeight: "1.4"}}>
                                               ℹ️ <strong>Info:</strong> Promotion campaign increased revenue {promoAnalytics.avgLift.toFixed(1)}%.
                                           </div>
                                       ) : null}
                                       {stockouts.length === 0 && promoAnalytics.avgLift === 0 && (
                                           <div style={{fontSize: "13px", lineHeight: "1.4"}}>
                                               ℹ️ <strong>Info:</strong> Inventory levels are healthy across all tracked product locations.
                                           </div>
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
                            <ChartFrame loading={dataLoading} error={dataError} empty={!data.trend.length} emptyMsg="No valid dated sales rows are available for the trend chart.">
                            {data.trend.length > 0 && (
                               <Plot className="plot compact" config={plotConfig} layout={getPlotLayout()} data={[{ x: data.trend.map(t => t.date), y: data.trend.map(t => t.revenue), type: "scatter", mode: "lines", fill: "tozeroy", marker: { color: "#60a5fa" }, line: { shape: "spline" } }]} />
                            )}
                            </ChartFrame>
                        </Card>
                        {(!categoryData || categoryData.length === 0) ? (
                            <div className="missing-category-state glass">
                                <AlertTriangle size={32} className="warning-icon" />
                                <h3>Category Analysis Unavailable</h3>
                                <p>This dataset does not contain a category column.</p>
                                
                                <div className="missing-details">
                                    <div>
                                        <strong>Required field:</strong>
                                        <ul>
                                            <li>category</li>
                                        </ul>
                                    </div>
                                    <div>
                                        <strong>Example values:</strong>
                                        <ul>
                                            <li>Electronics</li>
                                            <li>Clothing</li>
                                            <li>Furniture</li>
                                            <li>Footwear</li>
                                        </ul>
                                    </div>
                                </div>
                                
                                <p className="missing-footer">Upload enriched product metadata to unlock category-level analytics.</p>
                            </div>
                        ) : (
                            <Card title="Category Revenue Share" subtitle="Distribution by category">
                                <Plot className="plot compact" config={plotConfig} layout={getPlotLayout()} data={[{ labels: categoryData.map(c => c.category), values: categoryData.map(c => c.revenue), type: "pie", hole: 0.6, marker: { colors: ["#2dd4bf", "#60a5fa", "#a78bfa", "#f472b6"] } }]} />
                            </Card>
                        )}
                    </section>
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
                            <ChartFrame loading={dataLoading} error={dataError} empty={!productData.length} emptyMsg="No product revenue rows are available. Check that product and sales columns were mapped during upload.">
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

            {currentPage === "insights" && (
                <div className="fade-in">
                    <Card title="AI Executive Summary" subtitle="Data-driven intelligence generated from actual dataset calculations">
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
            
            {currentPage === "stores" && (
                <div className="fade-in">
                    <section className="grid two">
                        <Card title="Store Revenue Ranking" subtitle="Performance across locations">
                            <ChartFrame loading={dataLoading} error={dataError} empty={!storeData.length} emptyMsg="No store revenue rows are available. Check that store and sales columns were mapped during upload.">
                            {storeData.length > 0 && (
                                <Plot className="plot compact" config={plotConfig} layout={{ ...getPlotLayout(), margin: { ...getPlotLayout().margin, l: 60 } }} data={[{ x: storeData.map((x) => x.revenue).reverse(), y: storeData.map((x) => x.store_code).reverse(), type: "bar", orientation: "h", marker: { color: "#2dd4bf" } }]} />
                            )}
                            </ChartFrame>
                        </Card>
                        <Card title="Store Unit Volume" subtitle="Units sold per store">
                            <ChartFrame loading={dataLoading} error={dataError} empty={!storeData.length} emptyMsg="No store unit-volume rows are available.">
                            {storeData.length > 0 && (
                               <Plot className="plot compact" config={plotConfig} layout={getPlotLayout()} data={[{ labels: storeData.map(x => x.store_code), values: storeData.map(x => x.units), type: "pie", hole: 0.6, marker: { colors: ["#2dd4bf", "#60a5fa", "#a78bfa", "#fb7185", "#f472b6", "#38bdf8"] } }]} />
                            )}
                            </ChartFrame>
                        </Card>
                    </section>
                </div>
            )}

            {currentPage === "promotions" && (
                <div className="fade-in">
                    {datasetProfile?.promotion_coverage_pct === 0 ? (
                        <div className="missing-category-state glass" style={{marginTop: "24px"}}>
                            <AlertTriangle size={32} className="warning-icon" />
                            <h3>PROMOTION ANALYTICS UNAVAILABLE</h3>
                            <p>This dataset does not contain promotion data.</p>
                            <div className="missing-details">
                                <div><strong>Required field:</strong><ul><li>promotion</li></ul></div>
                                <div><strong>Example values:</strong><ul><li>true / false</li><li>1 / 0</li><li>yes / no</li></ul></div>
                            </div>
                            <p className="missing-footer">Upload a dataset with promotion flags to unlock lift and ROI analysis.</p>
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
                                    x: promoHeatmap.stores, 
                                    y: promoHeatmap.products, 
                                    z: promoHeatmap.z, 
                                    type: "heatmap", 
                                    hovertemplate: "Store: %{x}<br>Product: %{y}<br>Promotion Lift: %{z}%<extra></extra>",
                                    hoverlabel: { bgcolor: "#1e293b", bordercolor: "rgba(244, 63, 94, 0.4)", font: { color: "#f8fafc", family: "Inter, sans-serif", size: 13 }, align: "left" },
                                    colorscale: [[0, "rgba(255,255,255,0.05)"], [0.5, "#3b82f6"], [1, "#2dd4bf"]], 
                                    colorbar: { title: "% lift", thickness: 8 } 
                                }]} />
                                <div style={{padding: "0 16px 16px", fontSize: "13px", color: "var(--text-muted)"}}>
                                   Visualizes the effectiveness of promotions across different store and product combinations. Darker cyan indicates higher percentage lift over baseline.
                                </div>
                            </Card>
                            <Card title="Promotion Performance ROI" subtitle="Lift ranking and evaluation">
                                <div className="perf-metrics" style={{padding: "16px"}}>
                                    <div className="perf-metric"><span className="label">Best Performing Promotion</span><span className="val">{(() => {
                                       if (data.promotion_impact.length === 0) return "-";
                                       const sorted = [...data.promotion_impact].sort((a,b) => b.promo_lift_pct - a.promo_lift_pct);
                                       return sorted[0].product_code + " (+" + sorted[0].promo_lift_pct.toFixed(1) + "%)";
                                    })()}</span></div>
                                    <div className="perf-metric"><span className="label">Worst Performing Promotion</span><span className="val">{(() => {
                                       if (data.promotion_impact.length === 0) return "-";
                                       const sorted = [...data.promotion_impact].sort((a,b) => a.promo_lift_pct - b.promo_lift_pct);
                                       return sorted[0].product_code + " (" + sorted[0].promo_lift_pct.toFixed(1) + "%)";
                                    })()}</span></div>
                                    <div className="perf-metric"><span className="label">Revenue Contribution</span><span className="val">{promoAnalytics.promoRev > 0 ? ((promoAnalytics.promoRev / (promoAnalytics.promoRev + promoAnalytics.nonPromoRev)) * 100).toFixed(1) + "%" : "0%"}</span></div>
                                    <div className="perf-metric"><span className="label">Estimated ROI</span><span className="val">{promoAnalytics.avgLift > 0 ? "Positive" : "Negative / Zero"}</span></div>
                                </div>
                                <Plot className="plot compact" config={plotConfig} layout={{...getPlotLayout(), height: 160}} data={[{ x: ["Promo", "Non-Promo"], y: [promoAnalytics.promoRev, promoAnalytics.nonPromoRev], type: "bar", marker: { color: ["#60a5fa", "#334155"] } }]} />
                                <div style={{padding: "0 16px 16px", fontSize: "13px", color: "var(--text-muted)"}}>
                                   Compares the total revenue generated during active promotions versus baseline non-promotional periods to evaluate overall return on investment.
                                </div>
                            </Card>
                        </section>
                      </>
                    )}
                </div>
            )}

            {currentPage === "forecast" && (
                <div className="fade-in grid studio">
                  <Card title="What-if Forecast Studio" subtitle="Model demand changes">
                    <div className="controls">
                      <Control label="Forecast Horizon" value={horizon} set={setHorizon} suffix="days" min="1" max="365" />
                      <Control label="Promotion Lift" value={promoLift} set={setPromoLift} suffix="%" min="-100" max="500" />
                      <Control label="Demand Spike" value={spike} set={setSpike} suffix="%" min="-100" max="500" />
                      <Control label="Price Change" value={priceChange} set={setPriceChange} suffix="%" min="-100" max="500" />
                    </div>
                    <button type="button" onClick={generate} disabled={busy || !data.trend.length} className="primary-btn" style={{ width: "100%", marginTop: "16px" }}><Sparkles size={16} /> Generate Forecast</button>
                  </Card>
                  
                  <div style={{ gridColumn: "span 2" }}>
                      <Card title="Forecast vs Actuals" subtitle="Confidence bands and future demand">
                        <ChartFrame loading={dataLoading && !forecastRows.length} error={dataError} empty={data.trend.length < 30 || !forecastRows.length} emptyMsg={data.trend.length < 30 ? "Forecast requires at least 30 days of sales history." : "Generate a forecast to view projections."}>
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
                           <Card title="Stockout Risk Distribution" subtitle="Risk levels across portfolio">
                               <ChartFrame empty={false}>
                                  <Plot className="plot compact" config={plotConfig} layout={getPlotLayout()} data={[{
                                      labels: ["High Risk", "Healthy"],
                                      values: [data.alerts.filter(a => a.status === 'stockout-risk').length, data.alerts.filter(a => a.status !== 'stockout-risk').length],
                                      type: "pie", hole: 0.6, marker: { colors: ["#ef4444", "#2dd4bf"] }
                                  }]} />
                               </ChartFrame>
                           </Card>
                           
                           <Card title="Inventory Risk by Product" subtitle="Projected stock deficits">
                               <ChartFrame empty={data.alerts.filter(a => a.status === 'stockout-risk').length === 0} emptyMsg="No products at risk.">
                                  {data.alerts.filter(a => a.status === 'stockout-risk').length > 0 && (
                                      <Plot className="plot compact" config={plotConfig} layout={{ ...getPlotLayout(), margin: { ...getPlotLayout().margin, l: 60 } }} data={[{
                                          x: data.alerts.filter(a => a.status === 'stockout-risk').slice(0, 10).map(a => a.forecast_demand - a.current_stock).reverse(),
                                          y: data.alerts.filter(a => a.status === 'stockout-risk').slice(0, 10).map(a => a.product_code).reverse(),
                                          type: "bar", orientation: "h", marker: { color: "#ef4444" }
                                      }]} />
                                  )}
                               </ChartFrame>
                           </Card>
                           
                           <Card title="Reorder Priority Ranking" subtitle="Top SKUs to replenish">
                               <ChartFrame empty={data.alerts.filter(a => a.recommended_order > 0).length === 0} emptyMsg="No reorders needed.">
                                  {data.alerts.filter(a => a.recommended_order > 0).length > 0 && (
                                      <Plot className="plot compact" config={plotConfig} layout={{ ...getPlotLayout(), margin: { ...getPlotLayout().margin, l: 60 } }} data={[{
                                          x: data.alerts.filter(a => a.recommended_order > 0).slice(0, 10).map(a => a.recommended_order).reverse(),
                                          y: data.alerts.filter(a => a.recommended_order > 0).slice(0, 10).map(a => a.product_code).reverse(),
                                          type: "bar", orientation: "h", marker: { color: "#a78bfa" }
                                      }]} />
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
                                           <th style={{ padding: '12px' }}>Current Demand (Stock)</th>
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
              <div className="suggested-questions">
                  {suggestedQuestions.map(q => (
                      <button type="button" key={q} onClick={() => askAssistant(q)} disabled={assistantBusy}>{q}</button>
                  ))}
              </div>
              <div className="chat-history">
                  {chatHistory.map((message, index) => (
                      <div key={index} className={`chat-message ${message.role}`}>
                          {message.role === "assistant" ? (
                              <>
                                  <MarkdownText text={message.answer} />
                                  <MetricCards metrics={message.supporting_metrics} />
                                  {message.confidence !== undefined && <small className="confidence">Confidence {(Number(message.confidence) * 100).toFixed(0)}%</small>}
                              </>
                          ) : <p>{message.answer}</p>}
                      </div>
                  ))}
                  {assistantBusy && (
                      <div className="typing">
                          <span></span><span></span><span></span>
                      </div>
                  )}
              </div>
              <form className="assistant-input" onSubmit={(event) => { event.preventDefault(); askAssistant(); }}>
                  <input value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder="Ask about your retail data..." />
                  <button type="submit" disabled={assistantBusy || !assistantInput.trim()}><Send size={16} /></button>
              </form>
          </div>
      </div>
    </div>
  );
}

function MarkdownText({ text }) {
  const renderInline = (value) => {
      const parts = String(value || "").split(/(\*\*[^*]+\*\*)/g);
      return parts.map((part, index) => {
          if (part.startsWith("**") && part.endsWith("**")) {
              return <strong key={index}>{part.slice(2, -2)}</strong>;
          }
          return <React.Fragment key={index}>{part}</React.Fragment>;
      });
  };
  return (
      <div className="markdown-text">
          {String(text || "").split(/\n+/).filter(Boolean).map((line, index) => (
              <p key={index}>{renderInline(line)}</p>
          ))}
      </div>
  );
}

function MetricCards({ metrics }) {
  if (!metrics || Object.keys(metrics).length === 0) return null;
  const cards = [];
  if (metrics.top_store) cards.push(["Top Store", metrics.top_store.store_code, `$${Math.round(metrics.top_store.revenue || 0).toLocaleString()}`]);
  if (metrics.top_products?.length) cards.push(["Top Product", metrics.top_products[0].product_code, `$${Math.round(metrics.top_products[0].revenue || 0).toLocaleString()}`]);
  if (metrics.promotion) cards.push(["Promotion Lift", `${metrics.promotion.lift_pct}%`, `${metrics.promotion.promoted_avg_units} avg units`]);
  if (metrics.inventory_risks) cards.push(["Inventory Risks", metrics.inventory_risks.length, metrics.inventory_risks[0]?.product_code || "No risk"]);
  if (metrics.forecast) cards.push(["Forecast Demand", Math.round(metrics.forecast.predicted_units).toLocaleString(), "units"]);
  if (metrics.revenue_trend) cards.push(["Revenue Change", `${metrics.revenue_trend.change_pct}%`, metrics.revenue_trend.latest_date || "latest"]);
  if (metrics.category_growth) cards.push(["Fastest Category", metrics.category_growth.category || "-", `${metrics.category_growth.growth_pct}%`]);
  return (
      <div className="assistant-metrics">
          {cards.slice(0, 3).map(([label, value, detail]) => (
              <div className="assistant-metric" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                  <small>{detail}</small>
              </div>
          ))}
      </div>
  );
}

function Kpi({ title, value, detail, accent }) {
  return <div className="kpi glass" style={{ "--accent": accent }}><span>{title}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function Card({ title, subtitle, children }) {
  return <article className="card glass"><div className="card-head"><div><h3>{title}</h3><p>{subtitle}</p></div></div>{children}</article>;
}

function Control({ label, value, set, suffix, min, max }) {
  return <label className="control"><span>{label}</span><div><input type="number" value={value} min={min} max={max} onChange={(e) => set(e.target.value)} /><b>{suffix}</b></div></label>;
}

function Alert({ item }) {
  let riskColor = "#2dd4bf";
  let riskLabel = "Low Risk";
  if (item.status === "stockout-risk") {
      riskColor = "#ef4444";
      riskLabel = "Critical Risk";
  } else if (item.status === "overstock") {
      riskColor = "#f59e0b";
      riskLabel = "Medium Risk";
  }

  const daysUntilStockout = item.forecast_demand > 0 ? Math.round((item.current_stock / item.forecast_demand) * 30) : 999;

  return (
      <div className="alert glass" style={{ borderLeft: `4px solid ${riskColor}` }}>
          <span className={`alert-icon`} style={{ color: riskColor, background: `${riskColor}20` }}><Boxes size={18} /></span>
          <div><strong>{item.product_name}</strong><small>{item.product_code} · <span style={{color: riskColor}}>{riskLabel}</span></small></div>
          <div className="alert-metric"><span>On hand</span><b>{Math.round(item.current_stock)}</b></div>
          <div className="alert-metric"><span>Days until stockout</span><b>{daysUntilStockout > 365 ? "365+" : daysUntilStockout}</b></div>
          <div className="recommend"><span>Recommended order</span><strong>{Math.round(item.recommended_order)} units</strong></div>
      </div>
  );
}

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
