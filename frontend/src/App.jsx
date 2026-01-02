import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ComposedChart, Bar, Line, Legend } from 'recharts';
import { Settings, TrendingUp, DollarSign, Activity, Home, Briefcase, PiggyBank, CreditCard, Plus, Trash2, BarChart3, Sliders } from 'lucide-react';

// Hidden default values - restored via Konami code
const DEFAULT_ASSETS = [
  { name: "401k", value: 1200000, growth_rate: 5.5, tax_treatment: "pre_tax" },
  { name: "Roth IRA", value: 80000, growth_rate: 5.5, tax_treatment: "roth" },
  { name: "Brokerage (Stocks)", value: 250000, growth_rate: 5.5, tax_treatment: "taxable" },
  { name: "Bitcoin", value: 135000, growth_rate: 7.0, tax_treatment: "taxable" },
  { name: "Rental Portfolio", value: 2060000, growth_rate: 2.0, tax_treatment: "real_estate" },
  { name: "Primary Home", value: 750000, growth_rate: 2.0, tax_treatment: "real_estate" }
];
const DEFAULT_INFLOWS = [
  { name: "W2 Salary", amount: 400000, start_year: 2025, end_year: 2035, growth_rate: 3.5 },
  { name: "Rental Profit", amount: 60000, start_year: 2032, end_year: 2090, growth_rate: 2.0 },
  { name: "Royalties", amount: 36000, start_year: 2030, end_year: 2050, growth_rate: 0.0 },
  { name: "Social Security", amount: 34000, start_year: 2054, end_year: 2090, growth_rate: 2.5 }
];
const DEFAULT_OUTFLOWS = [
  { name: "Living Expenses 1", amount: 175000, start_year: 2025, end_year: 2035, growth_rate: 4.0 },
  { name: "Living Expenses 2", amount: 150000, start_year: 2036, end_year: 2090, growth_rate: 4.0 },
  { name: "Housing (Tax/Ins)", amount: 25000, start_year: 2025, end_year: 2090, growth_rate: 4.0 },
  { name: "Car Expenses", amount: 10000, start_year: 2025, end_year: 2080, growth_rate: 4.0 },
  { name: "Health Insurance (Gap)", amount: 20000, start_year: 2035, end_year: 2052, growth_rate: 4.0 }
];
const DEFAULT_OTHER_ASSETS = [
  { name: "Other Asset 1", value: 500000, add_year: 2030 },
  { name: "Other Asset 2", value: 0, add_year: 2035 }
];
const DEFAULT_ONE_TIME_EXPENSES = [
  { name: "One-Time Expense 1", amount: 0, year: 2030, add_to_primary_home: false },
  { name: "One-Time Expense 2", amount: 0, year: 2035, add_to_primary_home: false }
];
const DEFAULT_RATES = { inflation: 3.5, stockGrowth: 5, realEstateGrowth: 2.0, retireAge: 48 };

// Randomize helper
const randomFactor = (pct) => 1 + (Math.random() * 2 - 1) * pct;
const randomizeValue = (val, pct = 0.5) => Math.round(val * randomFactor(pct));
const randomizeRate = (val, pct = 0.2) => Math.round(val * randomFactor(pct) * 10) / 10;

// Generate randomized initial values
const getRandomizedAssets = () => DEFAULT_ASSETS.map(a => ({ ...a, value: randomizeValue(a.value), growth_rate: randomizeRate(a.growth_rate) }));
const getRandomizedInflows = () => DEFAULT_INFLOWS.map(i => ({ ...i, amount: randomizeValue(i.amount), growth_rate: randomizeRate(i.growth_rate) }));
const getRandomizedOutflows = () => DEFAULT_OUTFLOWS.map(o => ({ ...o, amount: randomizeValue(o.amount) }));
const getRandomizedOtherAssets = () => DEFAULT_OTHER_ASSETS.map(a => ({ ...a, value: randomizeValue(a.value) }));
const getRandomizedOneTimeExpenses = () => DEFAULT_ONE_TIME_EXPENSES.map(e => ({ ...e, amount: randomizeValue(e.amount) }));

export default function App() {
  const [data, setData] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [freedomYear, setFreedomYear] = useState(null);
  const [simError, setSimError] = useState(null);

  const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

  // Navigation state
  const [activeTab, setActiveTab] = useState('main'); // 'main' | 'monteCarlo'

  // Monte Carlo state
  const [mcSettings, setMcSettings] = useState({
    numRuns: 100,
    stockVolatility: 15,      // % standard deviation for stocks
    realEstateVolatility: 8,  // % standard deviation for real estate
    inflationVolatility: 0, // % standard deviation for inflation (default off)
  });
  const [mcResults, setMcResults] = useState(null);
  const [mcRunning, setMcRunning] = useState(false);

  // Core assumptions - start randomized
  const [currentAge, setCurrentAge] = useState(38);
  const [retireAge, setRetireAge] = useState(() => Math.round(DEFAULT_RATES.retireAge * randomFactor(0.1)));
  const [inflation, setInflation] = useState(() => randomizeRate(DEFAULT_RATES.inflation));
  const [stockGrowth, setStockGrowth] = useState(() => randomizeRate(DEFAULT_RATES.stockGrowth));
  const [realEstateGrowth, setRealEstateGrowth] = useState(() => randomizeRate(DEFAULT_RATES.realEstateGrowth));
  const [retirementWithdrawalAge, setRetirementWithdrawalAge] = useState(60);

  // Assets - start randomized
  const [assets, setAssets] = useState(getRandomizedAssets);

  // Income streams - start randomized
  const [inflows, setInflows] = useState(getRandomizedInflows);

  // Expenses - start randomized
  const [outflows, setOutflows] = useState(getRandomizedOutflows);

  // One-time asset additions - start randomized
  const [otherAssets, setOtherAssets] = useState(getRandomizedOtherAssets);

  // One-time expenses - start randomized
  const [oneTimeExpenses, setOneTimeExpenses] = useState(getRandomizedOneTimeExpenses);

  // Konami Code: ↑↑↓↓←→←→BA
  useEffect(() => {
    const konamiCode = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];
    let konamiIndex = 0;
    
    const handleKeyDown = (e) => {
      if (e.code === konamiCode[konamiIndex]) {
        konamiIndex++;
        if (konamiIndex === konamiCode.length) {
          // Restore all defaults
          setAssets(DEFAULT_ASSETS.map(a => ({ ...a })));
          setInflows(DEFAULT_INFLOWS.map(i => ({ ...i })));
          setOutflows(DEFAULT_OUTFLOWS.map(o => ({ ...o })));
          setOtherAssets(DEFAULT_OTHER_ASSETS.map(a => ({ ...a })));
          setOneTimeExpenses(DEFAULT_ONE_TIME_EXPENSES.map(e => ({ ...e })));
          setInflation(DEFAULT_RATES.inflation);
          setStockGrowth(DEFAULT_RATES.stockGrowth);
          setRealEstateGrowth(DEFAULT_RATES.realEstateGrowth);
          setRetireAge(DEFAULT_RATES.retireAge);
          konamiIndex = 0;
          console.log('🎮 Defaults restored!');
        }
      } else {
        konamiIndex = 0;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const runSim = async () => {
      setSimError(null);
      const apiAssets = assets.map(a => ({
        ...a,
        growth_rate: a.growth_rate / 100
      }));

      const apiInflows = inflows.map(i => ({
        ...i,
        growth_rate: i.growth_rate / 100
      }));

      const apiOutflows = outflows.map(o => ({
        ...o,
        growth_rate: inflation / 100
      }));

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const res = await fetch(`${API_URL}/simulate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            current_year: 2025,
            current_age: currentAge,
            target_retirement_age: retireAge,
            retirement_withdrawal_age: retirementWithdrawalAge,
            general_inflation: inflation / 100,
            assets: apiAssets,
            inflows: apiInflows,
            outflows: apiOutflows,
            other_assets: otherAssets,
            one_time_expenses: oneTimeExpenses
          })
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`API ${res.status} ${res.statusText}: ${text || '(no body)'}`);
        }

        const result = await res.json();
        if (!result?.timeline) {
          throw new Error('API response missing timeline');
        }
        setData(result.timeline);
        setMetrics(result.metrics);
        setFreedomYear(result.freedom_year);
      } catch (err) {
        const message = err?.name === 'AbortError'
          ? `Request timed out contacting ${API_URL}`
          : (err?.message || String(err));
        console.error('API Error:', err);
        setSimError(message);
      }
    };
    runSim();
  }, [API_URL, currentAge, retireAge, inflation, stockGrowth, realEstateGrowth, retirementWithdrawalAge, assets, inflows, outflows, otherAssets, oneTimeExpenses]);

  // Update asset growth rates when global rates change
  useEffect(() => {
    setAssets(prev => prev.map(a => ({
      ...a,
      growth_rate: a.tax_treatment === 'real_estate' ? realEstateGrowth : stockGrowth
    })));
  }, [stockGrowth, realEstateGrowth]);

  // Update expense growth rates when inflation changes
  useEffect(() => {
    setOutflows(prev => prev.map(o => ({
      ...o,
      growth_rate: inflation
    })));
  }, [inflation]);

  // Update W2 salary growth rate to match inflation
  useEffect(() => {
    setInflows(prev => prev.map(i => 
      i.name.toLowerCase().includes('w2') || i.name.toLowerCase().includes('salary')
        ? { ...i, growth_rate: inflation }
        : i
    ));
  }, [inflation]);

  // Auto-update income/expense dates based on retirement age
  useEffect(() => {
    const retirementYear = 2025 + (retireAge - currentAge);
    
    // Update W2 Salary end date to retirement year
    setInflows(prev => prev.map(i => 
      i.name.toLowerCase().includes('w2') || i.name.toLowerCase().includes('salary')
        ? { ...i, end_year: retirementYear }
        : i
    ));
    
    // Update Health Insurance Gap start date to retirement year
    setOutflows(prev => prev.map(o => 
      o.name.toLowerCase().includes('health insurance')
        ? { ...o, start_year: retirementYear }
        : o
    ));
  }, [retireAge, currentAge]);

  // Monte Carlo simulation function
  const runMonteCarlo = async () => {
    setMcRunning(true);
    setMcResults(null);

    try {
      const apiAssets = assets.map(a => ({
        ...a,
        growth_rate: a.growth_rate / 100
      }));

      const apiInflows = inflows.map(i => ({
        ...i,
        growth_rate: i.growth_rate / 100
      }));

      // Keep outflow growth as explicit inflation-based rate (same as main sim)
      const apiOutflows = outflows.map(o => ({
        ...o,
        growth_rate: inflation / 100
      }));

      const res = await fetch(`${API_URL}/monte_carlo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          params: {
            current_year: 2025,
            current_age: currentAge,
            target_retirement_age: retireAge,
            retirement_withdrawal_age: retirementWithdrawalAge,
            general_inflation: inflation / 100,
            assets: apiAssets,
            inflows: apiInflows,
            outflows: apiOutflows,
            other_assets: otherAssets,
            one_time_expenses: oneTimeExpenses,
          },
          num_runs: mcSettings.numRuns,
          stock_volatility: mcSettings.stockVolatility / 100,
          real_estate_volatility: mcSettings.realEstateVolatility / 100,
          inflation_volatility: mcSettings.inflationVolatility / 100,
        })
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Monte Carlo API ${res.status} ${res.statusText}: ${text || '(no body)'}`);
      }

      const result = await res.json();
      if (!result?.percentileData) {
        throw new Error('Monte Carlo response missing percentileData');
      }

      setMcResults({
        percentileData: result.percentileData,
        stockReturnBoxData: result.stockReturnBoxData || [],
        successRate: result.successRate,
        numRuns: result.numRuns,
      });
    } catch (err) {
      console.error('Monte Carlo error:', err);
    } finally {
      setMcRunning(false);
    }
  };

  const updateAsset = (index, field, value) => {
    setAssets(prev => prev.map((a, i) => i === index ? { ...a, [field]: value } : a));
  };

  const addAsset = () => {
    setAssets(prev => [...prev, { name: "New Asset", value: 0, growth_rate: stockGrowth, tax_treatment: "taxable" }]);
  };

  const removeAsset = (index) => {
    setAssets(prev => prev.filter((_, i) => i !== index));
  };

  const updateInflow = (index, field, value) => {
    setInflows(prev => prev.map((i, idx) => idx === index ? { ...i, [field]: value } : i));
  };

  const addInflow = () => {
    setInflows(prev => [...prev, { name: "New Income", amount: 0, start_year: 2025, end_year: 2090, growth_rate: 3.0 }]);
  };

  const removeInflow = (index) => {
    setInflows(prev => prev.filter((_, i) => i !== index));
  };

  const updateOutflow = (index, field, value) => {
    setOutflows(prev => {
      const updated = prev.map((o, idx) => idx === index ? { ...o, [field]: value } : o);
      
      // Auto-sync living expenses to be sequential (no overlap)
      const expenses1 = updated.findIndex(o => o.name.includes('Living Expenses 1'));
      const expenses2 = updated.findIndex(o => o.name.includes('Living Expenses 2'));
      
      if (expenses1 !== -1 && expenses2 !== -1) {
        updated[expenses2].start_year = updated[expenses1].end_year + 1;
      }
      
      return updated;
    });
  };

  const addOutflow = () => {
    setOutflows(prev => [...prev, { name: "New Expense", amount: 0, start_year: 2025, end_year: 2090, growth_rate: 3.0 }]);
  };

  const removeOutflow = (index) => {
    setOutflows(prev => prev.filter((_, i) => i !== index));
  };

  // Randomize values by ±percentage (0.5 = ±50%)
  const randomizeFactor = (pct) => 1 + (Math.random() * 2 - 1) * pct;

  const randomizeValues = () => {
    // Randomize assets ±50%
    setAssets(prev => prev.map(a => ({
      ...a,
      value: Math.round(a.value * randomizeFactor(0.5))
    })));
    // Randomize income ±50%
    setInflows(prev => prev.map(i => ({
      ...i,
      amount: Math.round(i.amount * randomizeFactor(0.5))
    })));
    // Randomize expenses ±50%
    setOutflows(prev => prev.map(o => ({
      ...o,
      amount: Math.round(o.amount * randomizeFactor(0.5))
    })));
    // Randomize other assets ±50%
    setOtherAssets(prev => prev.map(a => ({
      ...a,
      value: Math.round(a.value * randomizeFactor(0.5))
    })));

    // Randomize one-time expenses ±50%
    setOneTimeExpenses(prev => prev.map(e => ({
      ...e,
      amount: Math.round(e.amount * randomizeFactor(0.5))
    })));
  };

  const randomizeRates = () => {
    // Randomize inflation ±20%
    setInflation(prev => Math.round(prev * randomizeFactor(0.2) * 10) / 10);
    // Randomize stock growth ±20%
    setStockGrowth(prev => Math.round(prev * randomizeFactor(0.2) * 10) / 10);
    // Randomize real estate appreciation ±20%
    setRealEstateGrowth(prev => Math.round(prev * randomizeFactor(0.2) * 10) / 10);
    // Randomize individual asset growth rates ±20%
    setAssets(prev => prev.map(a => ({
      ...a,
      growth_rate: Math.round(a.growth_rate * randomizeFactor(0.2) * 10) / 10
    })));
    // Randomize income growth rates ±20%
    setInflows(prev => prev.map(i => ({
      ...i,
      growth_rate: Math.round(i.growth_rate * randomizeFactor(0.2) * 10) / 10
    })));
  };

  const fmt = (val) => {
    if (val === undefined || val === null) return '...';
    return val >= 1000000 ? `$${(val/1000000).toFixed(1)}M` : `$${(val/1000).toFixed(0)}k`;
  };

  const fmtPctSigned = (decimalVal) => {
    if (decimalVal === undefined || decimalVal === null) return '...';
    const v = Number(decimalVal);
    if (!Number.isFinite(v)) return '...';
    const pct = v * 100;
    const sign = pct > 0 ? '+' : '';
    return `${sign}${pct.toFixed(1)}%`;
  };

  const pctRange = (meanDecimal, sdDecimal, k) => {
    const mean = Number(meanDecimal);
    const sd = Number(sdDecimal);
    if (!Number.isFinite(mean) || !Number.isFinite(sd) || !Number.isFinite(k)) return '...';
    return `${fmtPctSigned(mean - k * sd)} to ${fmtPctSigned(mean + k * sd)}`;
  };

  const percentile = (sortedVals, p) => {
    if (!sortedVals?.length) return 0;
    if (p <= 0) return sortedVals[0];
    if (p >= 1) return sortedVals[sortedVals.length - 1];
    const idx = (sortedVals.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, sortedVals.length - 1);
    const w = idx - lo;
    return sortedVals[lo] * (1 - w) + sortedVals[hi] * w;
  };

  const mulberry32 = (seed) => {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  const sampleStandardNormal = (rand) => {
    // Box–Muller transform
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  };

  const sampleNormal = (rand, mean, sd) => mean + sd * sampleStandardNormal(rand);

  const getSkewedStockShockSampler = (targetSigma) => {
    const sigma = Number(targetSigma);
    if (!Number.isFinite(sigma) || sigma <= 0) {
      return () => 0;
    }

    // Must match backend parameters in backend/main.py::_skewed_stock_shock
    const crashProb = 0.12;
    const crashMean = -0.35;
    const crashSigma = 0.12;
    const normalSigma = 0.08;
    const normalMean = (-crashProb * crashMean) / (1 - crashProb);
    const rawVar =
      (1 - crashProb) * (normalSigma ** 2 + normalMean ** 2) +
      crashProb * (crashSigma ** 2 + crashMean ** 2);
    const scale = rawVar > 0 ? sigma / Math.sqrt(rawVar) : 0;

    return (rand) => {
      const x = rand() < crashProb
        ? sampleNormal(rand, crashMean, crashSigma)
        : sampleNormal(rand, normalMean, normalSigma);
      return x * scale;
    };
  };

  const empiricalRanges = (meanDecimal, sdDecimal, kind) => {
    const mean = Number(meanDecimal);
    const sd = Number(sdDecimal);
    if (!Number.isFinite(mean) || !Number.isFinite(sd) || sd < 0) {
      return {
        r68: '...',
        r95: '...',
        r997: '...'
      };
    }

    // Deterministic seed so the UI doesn't "jitter" as you type.
    const seed = Math.floor((mean * 1e6) + (sd * 1e9)) ^ 0xA53C9E37;
    const rand = mulberry32(seed);
    const n = 8000;
    const values = new Array(n);

    const shockSampler = kind === 'skewedStock'
      ? getSkewedStockShockSampler(sd)
      : (r) => sampleNormal(r, 0, sd);

    for (let i = 0; i < n; i++) {
      const shock = shockSampler(rand);
      values[i] = mean + shock;
    }
    values.sort((a, b) => a - b);

    // These percentiles correspond to the "68/95/99.7" coverage under a normal.
    const p16 = percentile(values, 0.158655);
    const p84 = percentile(values, 0.841345);
    const p025 = percentile(values, 0.02275);
    const p975 = percentile(values, 0.97725);
    const p0015 = percentile(values, 0.00135);
    const p9985 = percentile(values, 0.99865);

    return {
      r68: `${fmtPctSigned(p16)} to ${fmtPctSigned(p84)}`,
      r95: `${fmtPctSigned(p025)} to ${fmtPctSigned(p975)}`,
      r997: `${fmtPctSigned(p0015)} to ${fmtPctSigned(p9985)}`,
    };
  };

  const stockDistRanges = useMemo(() => {
    return empiricalRanges(stockGrowth / 100, mcSettings.stockVolatility / 100, 'skewedStock');
  }, [stockGrowth, mcSettings.stockVolatility]);

  const inputClass = "w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none";
  const labelClass = "text-xs font-bold text-slate-500 uppercase block mb-1";
  const cardClass = "bg-slate-800 p-4 rounded-xl border border-slate-700 h-[360px] overflow-y-auto";

  // Format value with k/M suffix (no decimals for Y-axis)
  const formatValue = (val) => {
    if (val >= 1000000) {
      return `$${(val/1000000).toFixed(0)}M`;
    }
    return `$${(val/1000).toFixed(0)}k`;
  };

  // Format value with k/M suffix (2 decimals for tooltip)
  const formatValueDetailed = (val) => {
    if (val >= 1000000) {
      return `$${(val/1000000).toFixed(2)}M`;
    }
    return `$${(val/1000).toFixed(0)}k`;
  };

  // Custom tooltip that shows both year and age
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const age = label;
      const year = 2025 + (age - currentAge);
      return (
        <div className="bg-slate-900 p-3 rounded border border-slate-700 shadow-lg">
          <p className="text-slate-300 font-semibold mb-2">{`Age ${age} (${year})`}</p>
          {payload.map((entry, index) => (
            <p key={index} style={{ color: entry.color }} className="text-sm">
              {`${entry.name}: ${formatValueDetailed(entry.value)}`}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  const formatPctAxis = (val) => {
    if (val === undefined || val === null) return '';
    const v = Number(val);
    if (!Number.isFinite(v)) return '';
    return `${(v * 100).toFixed(0)}%`;
  };

  const StockReturnTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const d = payload[0]?.payload;
      if (!d) return null;
      return (
        <div className="bg-slate-900 p-3 rounded border border-slate-700 shadow-lg">
          <p className="text-slate-300 font-semibold mb-2">{`Age ${label} (${d?.year})`}</p>
          <p className="text-sm text-slate-200">Min: {fmtPctSigned(d?.min)}</p>
          <p className="text-sm text-slate-200">Q1: {fmtPctSigned(d?.q1)}</p>
          <p className="text-sm text-emerald-400">Median: {fmtPctSigned(d?.median)}</p>
          <p className="text-sm text-slate-200">Q3: {fmtPctSigned(d?.q3)}</p>
          <p className="text-sm text-slate-200">Max: {fmtPctSigned(d?.max)}</p>
        </div>
      );
    }
    return null;
  };

  // Custom shape for Box & Whisker - receives x, y, width, height, payload from Recharts Bar
  const BoxWhiskerShape = (props) => {
    const { x, y, width, height, payload, yAxisScale } = props;
    if (!payload || !yAxisScale) return null;
    
    const d = payload;
    const cx = x + width / 2;
    const boxW = Math.max(6, width * 0.7);
    
    // Use yAxisScale to convert data values to pixel positions
    const yMin = yAxisScale(d.min);
    const yMax = yAxisScale(d.max);
    const yQ1 = yAxisScale(d.q1);
    const yQ3 = yAxisScale(d.q3);
    const yMed = yAxisScale(d.median);
    
    if ([yMin, yMax, yQ1, yQ3, yMed].some(v => v === undefined || v === null || Number.isNaN(v))) return null;

    const stroke = '#94a3b8';
    const fill = '#10b981';
    const medianStroke = '#ffffff';
    
    const left = cx - boxW / 2;
    const boxTop = Math.min(yQ1, yQ3);
    const boxHeight = Math.max(2, Math.abs(yQ3 - yQ1));

    return (
      <g>
        {/* whisker line (vertical from min to max) */}
        <line x1={cx} y1={yMin} x2={cx} y2={yMax} stroke={stroke} strokeWidth={1} />
        
        {/* caps (horizontal at min and max) */}
        <line x1={cx - boxW / 3} y1={yMin} x2={cx + boxW / 3} y2={yMin} stroke={stroke} strokeWidth={1} />
        <line x1={cx - boxW / 3} y1={yMax} x2={cx + boxW / 3} y2={yMax} stroke={stroke} strokeWidth={1} />
        
        {/* box (Q1 to Q3) */}
        <rect x={left} y={boxTop} width={boxW} height={boxHeight} fill={fill} fillOpacity={0.4} stroke={stroke} strokeWidth={1} />
        
        {/* median line */}
        <line x1={left} y1={yMed} x2={left + boxW} y2={yMed} stroke={medianStroke} strokeWidth={2} />
      </g>
    );
  };

  // Simple standalone Box & Whisker chart component (no Recharts Customized needed)
  const BoxWhiskerChart = ({ data }) => {
    const [tooltip, setTooltip] = React.useState(null);
    
    if (!data || data.length === 0) return null;
    
    const margin = { top: 20, right: 30, bottom: 40, left: 60 };
    const width = 1200;
    const height = 500;
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    
    // Compute scales from data
    const ages = data.map(d => d.age);
    const minAge = Math.min(...ages);
    const maxAge = Math.max(...ages);
    
    const allVals = data.flatMap(d => [d.min, d.max]);
    const minY = Math.min(...allVals);
    const maxY = Math.max(...allVals);
    const yPadding = (maxY - minY) * 0.05;
    
    const xScale = (age) => margin.left + ((age - minAge) / (maxAge - minAge)) * plotWidth;
    const yScale = (val) => margin.top + plotHeight - ((val - (minY - yPadding)) / ((maxY + yPadding) - (minY - yPadding))) * plotHeight;
    
    const boxWidth = Math.max(6, (plotWidth / data.length) * 0.6);
    
    // Y-axis ticks
    const yTicks = [];
    const tickCount = 6;
    for (let i = 0; i <= tickCount; i++) {
      const val = minY + (i / tickCount) * (maxY - minY);
      yTicks.push(val);
    }
    
    // X-axis ticks (every 5 or 10 years)
    const xTicks = ages.filter((a, i) => i === 0 || i === ages.length - 1 || a % 10 === 0 || (ages.length < 30 && a % 5 === 0));
    
    return (
      <div style={{ width: '100%', overflowX: 'auto' }}>
        <svg width={width} height={height} style={{ display: 'block', margin: '0 auto' }}>
          {/* Y axis */}
          <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + plotHeight} stroke="#64748b" strokeWidth={1} />
          {yTicks.map((val, i) => (
            <g key={i}>
              <line x1={margin.left - 5} y1={yScale(val)} x2={margin.left} y2={yScale(val)} stroke="#64748b" strokeWidth={1} />
              <text x={margin.left - 10} y={yScale(val) + 4} textAnchor="end" fill="#64748b" fontSize={11}>
                {(val * 100).toFixed(0)}%
              </text>
            </g>
          ))}
          
          {/* X axis */}
          <line x1={margin.left} y1={margin.top + plotHeight} x2={margin.left + plotWidth} y2={margin.top + plotHeight} stroke="#64748b" strokeWidth={1} />
          {xTicks.map((age, i) => (
            <g key={i}>
              <line x1={xScale(age)} y1={margin.top + plotHeight} x2={xScale(age)} y2={margin.top + plotHeight + 5} stroke="#64748b" strokeWidth={1} />
              <text x={xScale(age)} y={margin.top + plotHeight + 20} textAnchor="middle" fill="#64748b" fontSize={11}>
                {age}
              </text>
            </g>
          ))}
          
          {/* Box & Whisker for each data point */}
          {data.map((d, idx) => {
            const cx = xScale(d.age);
            const yMin = yScale(d.min);
            const yMax = yScale(d.max);
            const yQ1 = yScale(d.q1);
            const yQ3 = yScale(d.q3);
            const yMed = yScale(d.median);
            
            const left = cx - boxWidth / 2;
            const boxTop = Math.min(yQ1, yQ3);
            const boxH = Math.max(2, Math.abs(yQ3 - yQ1));
            
            return (
              <g 
                key={d.age} 
                onMouseEnter={() => setTooltip({ d, x: cx, y: yMed })}
                onMouseLeave={() => setTooltip(null)}
                style={{ cursor: 'pointer' }}
              >
                {/* whisker */}
                <line x1={cx} y1={yMin} x2={cx} y2={yMax} stroke="#94a3b8" strokeWidth={1} />
                {/* caps */}
                <line x1={cx - boxWidth / 3} y1={yMin} x2={cx + boxWidth / 3} y2={yMin} stroke="#94a3b8" strokeWidth={1} />
                <line x1={cx - boxWidth / 3} y1={yMax} x2={cx + boxWidth / 3} y2={yMax} stroke="#94a3b8" strokeWidth={1} />
                {/* box */}
                <rect x={left} y={boxTop} width={boxWidth} height={boxH} fill="#10b981" fillOpacity={0.4} stroke="#94a3b8" strokeWidth={1} />
                {/* median */}
                <line x1={left} y1={yMed} x2={left + boxWidth} y2={yMed} stroke="#ffffff" strokeWidth={2} />
                {/* invisible hover target */}
                <rect x={left - 5} y={yMax} width={boxWidth + 10} height={yMin - yMax} fill="transparent" />
              </g>
            );
          })}
          
          {/* Tooltip */}
          {tooltip && (
            <g>
              <rect x={tooltip.x + 10} y={tooltip.y - 70} width={140} height={100} rx={6} fill="#0f172a" stroke="#334155" strokeWidth={1} />
              <text x={tooltip.x + 20} y={tooltip.y - 50} fill="#e2e8f0" fontSize={12} fontWeight="bold">Age {tooltip.d.age} ({tooltip.d.year})</text>
              <text x={tooltip.x + 20} y={tooltip.y - 32} fill="#94a3b8" fontSize={11}>Min: {(tooltip.d.min * 100).toFixed(1)}%</text>
              <text x={tooltip.x + 20} y={tooltip.y - 17} fill="#94a3b8" fontSize={11}>Q1: {(tooltip.d.q1 * 100).toFixed(1)}%</text>
              <text x={tooltip.x + 20} y={tooltip.y - 2} fill="#10b981" fontSize={11}>Median: {(tooltip.d.median * 100).toFixed(1)}%</text>
              <text x={tooltip.x + 20} y={tooltip.y + 13} fill="#94a3b8" fontSize={11}>Q3: {(tooltip.d.q3 * 100).toFixed(1)}%</text>
              <text x={tooltip.x + 20} y={tooltip.y + 28} fill="#94a3b8" fontSize={11}>Max: {(tooltip.d.max * 100).toFixed(1)}%</text>
            </g>
          )}
        </svg>
      </div>
    );
  };

  if (!data && !simError) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-2xl text-emerald-400">Loading simulation...</div>
      </div>
    );
  }

  if (!data && simError) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="max-w-2xl w-full bg-slate-800 border border-slate-700 rounded-xl p-6">
          <div className="text-xl font-semibold text-red-300 mb-2">Simulation failed to load</div>
          <div className="text-slate-200 whitespace-pre-wrap break-words">{simError}</div>
          <div className="text-slate-400 mt-3 text-sm">Backend URL: {API_URL}</div>
        </div>
      </div>
    );
  }

  const totalAssets = assets.reduce((sum, a) => sum + a.value, 0);
  const totalIncome = inflows.filter(i => i.start_year <= 2025 && i.end_year >= 2025).reduce((sum, i) => sum + i.amount, 0);
  const totalExpenses = outflows.filter(o => o.start_year <= 2025 && o.end_year >= 2025).reduce((sum, o) => sum + o.amount, 0);

  return (
    <div className="min-h-screen bg-slate-900 text-white flex">
      {/* Sidebar Navigation */}
      <div className="w-16 bg-slate-800 border-r border-slate-700 flex flex-col items-center py-4 gap-2">
        <button
          onClick={() => setActiveTab('main')}
          className={`p-3 rounded-lg transition-colors ${activeTab === 'main' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:bg-slate-700 hover:text-white'}`}
          title="Main Dashboard"
        >
          <TrendingUp size={24}/>
        </button>
        <button
          onClick={() => setActiveTab('monteCarlo')}
          className={`p-3 rounded-lg transition-colors ${activeTab === 'monteCarlo' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:bg-slate-700 hover:text-white'}`}
          title="Monte Carlo Settings"
        >
          <Sliders size={24}/>
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1">
        {/* Header */}
        <div className="bg-slate-800 border-b border-slate-700 px-6 py-4">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-500">
              Holmes Financial Engine
            </h1>
            <div className="flex gap-3">
              <button 
                onClick={runMonteCarlo}
                disabled={mcRunning}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${mcRunning ? 'bg-slate-600 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500'}`}
              >
                <BarChart3 size={16}/>
                {mcRunning ? `Running... (${mcSettings.numRuns} sims)` : 'Run Monte Carlo'}
              </button>
              <button 
                onClick={randomizeValues}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium transition-colors"
              >
                🎲 Randomize Values (±50%)
              </button>
              <button 
                onClick={randomizeRates}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm font-medium transition-colors"
              >
                📈 Randomize Rates (±20%)
              </button>
            </div>
          </div>
        </div>

        {/* Monte Carlo Settings Tab */}
        {activeTab === 'monteCarlo' && (
          <div className="w-full px-6 py-6">
            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Sliders size={24}/> Monte Carlo Settings
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className={labelClass}>Number of Simulations</label>
                  <input 
                    type="number" 
                    value={mcSettings.numRuns} 
                    onChange={e => setMcSettings(prev => ({...prev, numRuns: Math.max(1, Number(e.target.value))}))}
                    className={inputClass}
                    min="1"
                    max="1000"
                  />
                  <p className="text-xs text-slate-500 mt-1">More runs = smoother results (1-1000)</p>
                </div>
                <div>
                  <label className={labelClass}>Stock/Equity Volatility (% Std Dev)</label>
                  <input 
                    type="number" 
                    step="0.5"
                    value={mcSettings.stockVolatility} 
                    onChange={e => setMcSettings(prev => ({...prev, stockVolatility: Number(e.target.value)}))}
                    className={inputClass}
                  />
                  <p className="text-xs text-slate-500 mt-1">Historical S&P 500 volatility ~15-20% (skewed: rare crash years)</p>
                  <p className="text-xs text-slate-500 mt-1">
                    68%: {stockDistRanges.r68} · 95%: {stockDistRanges.r95} · 99.7%: {stockDistRanges.r997}
                  </p>
                </div>
                <div>
                  <label className={labelClass}>Real Estate Volatility (% Std Dev)</label>
                  <input 
                    type="number" 
                    step="0.5"
                    value={mcSettings.realEstateVolatility} 
                    onChange={e => setMcSettings(prev => ({...prev, realEstateVolatility: Number(e.target.value)}))}
                    className={inputClass}
                  />
                  <p className="text-xs text-slate-500 mt-1">Real estate typically less volatile ~5-10%</p>
                  <p className="text-xs text-slate-500 mt-1">
                    68%: {pctRange(realEstateGrowth / 100, mcSettings.realEstateVolatility / 100, 1)} · 95%: {pctRange(realEstateGrowth / 100, mcSettings.realEstateVolatility / 100, 2)} · 99.7%: {pctRange(realEstateGrowth / 100, mcSettings.realEstateVolatility / 100, 3)}
                  </p>
                </div>
                <div>
                  <label className={labelClass}>Inflation Volatility (% Std Dev)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    value={mcSettings.inflationVolatility} 
                    onChange={e => setMcSettings(prev => ({...prev, inflationVolatility: Number(e.target.value)}))}
                    className={inputClass}
                  />
                  <p className="text-xs text-slate-500 mt-1">Historical inflation volatility ~1-2%</p>
                  <p className="text-xs text-slate-500 mt-1">
                    68%: {pctRange(inflation / 100, mcSettings.inflationVolatility / 100, 1)} · 95%: {pctRange(inflation / 100, mcSettings.inflationVolatility / 100, 2)} · 99.7%: {pctRange(inflation / 100, mcSettings.inflationVolatility / 100, 3)}
                  </p>
                </div>
              </div>
              
              {mcResults && (
                <div className="mt-6 pt-6 border-t border-slate-700">
                  <h3 className="text-lg font-semibold mb-3">Latest Results</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-900 p-3 rounded-lg">
                        <p className="text-slate-400 text-sm">Success Rate (No shortfall before 95)</p>
                      <p className={`text-2xl font-bold ${mcResults.successRate >= 80 ? 'text-emerald-400' : mcResults.successRate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                        {mcResults.successRate.toFixed(1)}%
                      </p>
                    </div>
                    <div className="bg-slate-900 p-3 rounded-lg">
                      <p className="text-slate-400 text-sm">Simulations Completed</p>
                      <p className="text-2xl font-bold text-cyan-400">{mcResults.numRuns}</p>
                    </div>
                  </div>
                </div>
              )}

              {mcResults?.stockReturnBoxData?.length > 0 && (
                <div className="mt-6 bg-slate-900 p-4 rounded-xl border border-slate-700">
                  <h3 className="text-lg font-semibold mb-2">Monte Carlo: Yearly Stock Returns (Box &amp; Whisker)</h3>
                  <BoxWhiskerChart data={mcResults.stockReturnBoxData} />
                </div>
              )}
              
              <button 
                onClick={runMonteCarlo}
                disabled={mcRunning}
                className={`mt-6 w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${mcRunning ? 'bg-slate-600 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500'}`}
              >
                <BarChart3 size={18}/>
                {mcRunning ? 'Running Simulations...' : 'Run Monte Carlo Simulation'}
              </button>
            </div>
          </div>
        )}

        {/* Main Dashboard Tab */}
        {activeTab === 'main' && (
        <div className="max-w-7xl mx-auto p-6">
          {/* Monte Carlo Results Banner */}
          {mcResults && (
            <div className="mb-4 bg-slate-800 p-4 rounded-xl border border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <BarChart3 size={24} className="text-emerald-400"/>
                <div>
                  <p className="text-sm text-slate-400">Monte Carlo Analysis ({mcResults.numRuns} simulations)</p>
                  <p className="text-lg font-bold">
                    Success Rate (No shortfall before 95): <span className={mcResults.successRate >= 80 ? 'text-emerald-400' : mcResults.successRate >= 50 ? 'text-amber-400' : 'text-red-400'}>{mcResults.successRate.toFixed(1)}%</span>
                    <span className="text-slate-400 text-sm ml-4">Median NW @ 90: {fmt(mcResults.percentileData?.find(d => d.age === 90)?.p50)}</span>
                  </p>
                </div>
              </div>
              <button onClick={() => setActiveTab('monteCarlo')} className="text-sm text-emerald-400 hover:text-emerald-300">
                Adjust Settings →
              </button>
            </div>
          )}

          {/* Key Metrics Row */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            {[
              { label: "Current Net Worth", nominal: totalAssets, real: totalAssets, icon: PiggyBank, color: "text-emerald-400" },
              { label: `Net Worth @ ${retireAge}`, nominal: metrics?.nw_at_retirement?.nominal_net_worth, real: metrics?.nw_at_retirement?.real_net_worth, icon: TrendingUp, color: "text-cyan-400" },
              { label: "Net Worth @ 95", nominal: metrics?.nw_at_95?.nominal_net_worth, real: metrics?.nw_at_95?.real_net_worth, icon: Activity, color: "text-purple-400" }
            ].map((s, i) => (
              <div key={i} className="bg-slate-800 p-4 rounded-xl border border-slate-700 h-[50px] flex items-center gap-4">
                <div className={`p-2 bg-slate-900 rounded-lg ${s.color}`}><s.icon size={18}/></div>
                <div>
                  <p className="text-slate-400 text-xs font-medium">{s.label}</p>
                  <h3 className="text-lg font-bold">{fmt(s.nominal)} <span className="text-slate-500">/</span> <span className="text-slate-400">{fmt(s.real)}</span></h3>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[500px_500px_1fr] gap-6">
            {/* Left Column - Assumptions */}
            <div className="space-y-4" style={{minWidth: '500px'}}>
              {/* Core Assumptions */}
              <div className={cardClass}>
                <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-300 mb-4">
                  <Settings size={20}/> Core Assumptions
                </h3>
                <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Current Age</label>
                  <input type="number" value={currentAge} onChange={e => setCurrentAge(Number(e.target.value))} className={inputClass}/>
                </div>
                <div>
                  <label className={labelClass}>Retire Age</label>
                  <input type="number" value={retireAge} onChange={e => setRetireAge(Number(e.target.value))} className={inputClass}/>
                </div>
                <div>
                  <label className={labelClass}>401k Withdrawal Age</label>
                  <input type="number" min="59" max="73" value={retirementWithdrawalAge} onChange={e => setRetirementWithdrawalAge(Number(e.target.value))} className={inputClass}/>
                </div>
                <div>
                  <label className={labelClass}>Inflation %</label>
                  <input type="number" step="0.1" value={inflation} onChange={e => setInflation(Number(e.target.value))} className={inputClass}/>
                </div>
                <div>
                  <label className={labelClass}>Stock Growth %</label>
                  <input type="number" step="0.1" value={stockGrowth} onChange={e => setStockGrowth(Number(e.target.value))} className={inputClass}/>
                </div>
                <div>
                  <label className={labelClass}>RE Appreciation %</label>
                  <input type="number" step="0.1" value={realEstateGrowth} onChange={e => setRealEstateGrowth(Number(e.target.value))} className={inputClass}/>
                </div>
              </div>
            </div>

            {/* Assets */}
            <div className={cardClass}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-300">
                  <PiggyBank size={20}/> Assets
                </h3>
                <button onClick={addAsset} className="text-emerald-400 hover:text-emerald-300"><Plus size={20}/></button>
              </div>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {assets.map((asset, i) => (
                  <div key={i} className="bg-slate-900 p-3 rounded-lg">
                    <div className="flex justify-between items-start mb-2">
                      <input 
                        value={asset.name} 
                        onChange={e => updateAsset(i, 'name', e.target.value)}
                        className="bg-transparent border-none text-sm font-medium focus:outline-none"
                      />
                      <button onClick={() => removeAsset(i)} className="text-red-400 hover:text-red-300"><Trash2 size={14}/></button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-slate-500">Value $</label>
                        <input type="number" value={asset.value} onChange={e => updateAsset(i, 'value', Number(e.target.value))} className={inputClass}/>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Growth %</label>
                        <input type="number" step="0.1" value={asset.growth_rate} onChange={e => updateAsset(i, 'growth_rate', Number(e.target.value))} className={inputClass}/>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-slate-700 text-right">
                <span className="text-slate-400 text-sm">Total: </span>
                <span className="text-emerald-400 font-bold">{fmt(totalAssets)}</span>
              </div>
            </div>

            {/* One-Time Asset Additions */}
            <div className={cardClass}>
              <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-300 mb-3">
                <Plus size={20}/> One-Time Asset Additions
              </h3>
              <div className="space-y-2">
                {otherAssets.map((asset, i) => (
                  <div key={i} className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-xs text-slate-500">Name</label>
                      <input 
                        value={asset.name} 
                        onChange={e => {
                          const updated = [...otherAssets];
                          updated[i].name = e.target.value;
                          setOtherAssets(updated);
                        }}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">Value $</label>
                      <input 
                        type="number" 
                        value={asset.value} 
                        onChange={e => {
                          const updated = [...otherAssets];
                          updated[i].value = Number(e.target.value);
                          setOtherAssets(updated);
                        }}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">Year</label>
                      <input 
                        type="number" 
                        value={asset.add_year} 
                        onChange={e => {
                          const updated = [...otherAssets];
                          updated[i].add_year = Number(e.target.value);
                          setOtherAssets(updated);
                        }}
                        className={inputClass}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Middle Column - Income & Expenses */}
          <div className="space-y-4" style={{minWidth: '500px'}}>
            {/* Expenses */}
            <div className={cardClass}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-300">
                  <CreditCard size={20}/> Expenses
                </h3>
                <button onClick={addOutflow} className="text-emerald-400 hover:text-emerald-300"><Plus size={20}/></button>
              </div>
              <div className="space-y-3 max-h-52 overflow-y-auto">
                {outflows.map((outflow, i) => (
                  <div key={i} className="bg-slate-900 p-3 rounded-lg">
                    <div className="flex justify-between items-start mb-2">
                      <input 
                        value={outflow.name} 
                        onChange={e => updateOutflow(i, 'name', e.target.value)}
                        className="bg-transparent border-none text-sm font-medium focus:outline-none"
                      />
                      <button onClick={() => removeOutflow(i)} className="text-red-400 hover:text-red-300"><Trash2 size={14}/></button>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <label className="text-xs text-slate-500">$/yr</label>
                        <input type="number" value={outflow.amount} onChange={e => updateOutflow(i, 'amount', Number(e.target.value))} className={inputClass}/>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Start</label>
                        <input type="number" value={outflow.start_year} onChange={e => updateOutflow(i, 'start_year', Number(e.target.value))} className={inputClass}/>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">End</label>
                        <input type="number" value={outflow.end_year} onChange={e => updateOutflow(i, 'end_year', Number(e.target.value))} className={inputClass}/>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Grow%</label>
                        <input type="number" step="0.1" value={outflow.growth_rate} onChange={e => updateOutflow(i, 'growth_rate', Number(e.target.value))} className={inputClass}/>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-slate-700 text-right">
                <span className="text-slate-400 text-sm">Annual: </span>
                <span className="text-red-400 font-bold">{fmt(totalExpenses)}</span>
              </div>
            </div>

            {/* Income Streams */}
            <div className={cardClass}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-300">
                  <Briefcase size={20}/> Income Streams
                </h3>
                <button onClick={addInflow} className="text-emerald-400 hover:text-emerald-300"><Plus size={20}/></button>
              </div>
              <div className="space-y-3 max-h-52 overflow-y-auto">
                {inflows.map((inflow, i) => (
                  <div key={i} className="bg-slate-900 p-3 rounded-lg">
                    <div className="flex justify-between items-start mb-2">
                      <input 
                        value={inflow.name} 
                        onChange={e => updateInflow(i, 'name', e.target.value)}
                        className="bg-transparent border-none text-sm font-medium focus:outline-none"
                      />
                      <button onClick={() => removeInflow(i)} className="text-red-400 hover:text-red-300"><Trash2 size={14}/></button>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <label className="text-xs text-slate-500">$/yr</label>
                        <input type="number" value={inflow.amount} onChange={e => updateInflow(i, 'amount', Number(e.target.value))} className={inputClass}/>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Start</label>
                        <input type="number" value={inflow.start_year} onChange={e => updateInflow(i, 'start_year', Number(e.target.value))} className={inputClass}/>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">End</label>
                        <input type="number" value={inflow.end_year} onChange={e => updateInflow(i, 'end_year', Number(e.target.value))} className={inputClass}/>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Grow%</label>
                        <input type="number" step="0.1" value={inflow.growth_rate} onChange={e => updateInflow(i, 'growth_rate', Number(e.target.value))} className={inputClass}/>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-slate-700 text-right">
                <span className="text-slate-400 text-sm">Annual: </span>
                <span className="text-green-400 font-bold">{fmt(totalIncome)}</span>
              </div>
            </div>

            {/* One-Time Expenses */}
            <div className={cardClass}>
              <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-300 mb-3">
                <CreditCard size={20}/> One-Time Expenses
              </h3>
              <div className="space-y-3">
                {oneTimeExpenses.map((expense, i) => (
                  <div key={i} className="bg-slate-900 p-3 rounded-lg">
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-slate-500">Name</label>
                        <input
                          value={expense.name}
                          onChange={e => {
                            const updated = [...oneTimeExpenses];
                            updated[i].name = e.target.value;
                            setOneTimeExpenses(updated);
                          }}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Amount $</label>
                        <input
                          type="number"
                          value={expense.amount}
                          onChange={e => {
                            const updated = [...oneTimeExpenses];
                            updated[i].amount = Number(e.target.value);
                            setOneTimeExpenses(updated);
                          }}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Year</label>
                        <input
                          type="number"
                          value={expense.year}
                          onChange={e => {
                            const updated = [...oneTimeExpenses];
                            updated[i].year = Number(e.target.value);
                            setOneTimeExpenses(updated);
                          }}
                          className={inputClass}
                        />
                      </div>
                    </div>

                    <label className="mt-2 flex items-center gap-2 text-sm text-slate-300 select-none">
                      <input
                        type="checkbox"
                        checked={!!expense.add_to_primary_home}
                        onChange={e => {
                          const updated = [...oneTimeExpenses];
                          updated[i].add_to_primary_home = e.target.checked;
                          setOneTimeExpenses(updated);
                        }}
                      />
                      Vacation house (add to Primary Home)
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column - Charts */}
          <div className="space-y-4" style={{minWidth: '1200px'}}>
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 h-[360px]">
              <h3 className="text-lg font-semibold mb-2">Net Worth Breakdown</h3>
              <div style={{width: '100%', height: '300px'}}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data}>
                    <XAxis dataKey="age" stroke="#64748b" tick={{fontSize: 11}}/>
                    <YAxis stroke="#64748b" tickFormatter={formatValue} tick={{fontSize: 11}}/>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{fontSize: 10}}/>
                    <Bar dataKey="retirement_traditional" stackId="assets" fill="#10b981" name="401k"/>
                    <Bar dataKey="retirement_roth" stackId="assets" fill="#3b82f6" name="Roth IRA"/>
                    <Bar dataKey="brokerage" stackId="assets" fill="#8b5cf6" name="Brokerage"/>
                    <Bar dataKey="bitcoin" stackId="assets" fill="#f97316" name="Bitcoin"/>
                    <Bar dataKey="rental_properties" stackId="assets" fill="#f59e0b" name="Rental Properties"/>
                    <Bar dataKey="primary_home" stackId="assets" fill="#06b6d4" name="Primary Home"/>
                    <Line type="monotone" dataKey="real_net_worth" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Real Net Worth"/>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 h-[360px]">
              <h3 className="text-lg font-semibold mb-2">After-Tax Income vs Expenses</h3>
              <div style={{width: '100%', height: '300px'}}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data}>
                    <XAxis dataKey="age" stroke="#64748b" tick={{fontSize: 11}}/>
                    <YAxis stroke="#64748b" tickFormatter={formatValue} tick={{fontSize: 11}}/>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{fontSize: 10}}/>
                    <Bar dataKey="w2_income_after_tax" stackId="income" fill="#9ca3af" name="W2 Salary"/>
                    <Bar dataKey="rental_income_after_tax" stackId="income" fill="#f59e0b" name="Rental Income"/>
                    <Bar dataKey="retirement_withdrawals_after_tax" stackId="income" fill="#10b981" name="401k Withdrawals"/>
                    <Bar dataKey="brokerage_withdrawals_after_tax" stackId="income" fill="#8b5cf6" name="Brokerage Withdrawals"/>
                    <Bar dataKey="bitcoin_withdrawals_after_tax" stackId="income" fill="#f97316" name="Bitcoin Withdrawals"/>
                    <Bar dataKey="roth_withdrawals_after_tax" stackId="income" fill="#3b82f6" name="Roth Withdrawals"/>
                    <Bar dataKey="royalty_income_after_tax" stackId="income" fill="#ec4899" name="Royalties"/>
                    <Bar dataKey="dividend_income_after_tax" stackId="income" fill="#facc15" name="Dividends"/>
                    <Bar dataKey="social_security_after_tax" stackId="income" fill="#06b6d4" name="Social Security"/>
                    <Line type="monotone" dataKey="total_expenses" stroke="#ef4444" strokeWidth={3} dot={false} name="Expenses"/>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Monte Carlo Percentile Chart */}
            {mcResults && mcResults.percentileData && (
              <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 h-[360px]">
                <h3 className="text-lg font-semibold mb-2">Monte Carlo: Net Worth Percentiles</h3>
                <div style={{width: '100%', height: '300px'}}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={mcResults.percentileData}>
                      <XAxis dataKey="age" stroke="#64748b" tick={{fontSize: 11}}/>
                      <YAxis stroke="#64748b" tickFormatter={formatValue} tick={{fontSize: 11}}/>
                      <Tooltip content={({ active, payload, label }) => {
                        if (active && payload && payload.length) {
                          const d = mcResults.percentileData.find(x => x.age === label);
                          return (
                            <div className="bg-slate-900 p-3 rounded border border-slate-700 shadow-lg">
                              <p className="text-slate-300 font-semibold mb-2">{`Age ${label} (${d?.year})`}</p>
                              <p className="text-sm text-red-400">90th: {formatValueDetailed(d?.p90)}</p>
                              <p className="text-sm text-amber-400">75th: {formatValueDetailed(d?.p75)}</p>
                              <p className="text-sm text-emerald-400">50th (Median): {formatValueDetailed(d?.p50)}</p>
                              <p className="text-sm text-cyan-400">25th: {formatValueDetailed(d?.p25)}</p>
                              <p className="text-sm text-purple-400">10th: {formatValueDetailed(d?.p10)}</p>
                            </div>
                          );
                        }
                        return null;
                      }} />
                      <Legend wrapperStyle={{fontSize: 10}}/>
                      <Area type="monotone" dataKey="p90" stackId="1" stroke="#ef4444" fill="#ef444433" name="90th Percentile"/>
                      <Area type="monotone" dataKey="p75" stackId="2" stroke="#f59e0b" fill="#f59e0b33" name="75th Percentile"/>
                      <Area type="monotone" dataKey="p50" stackId="3" stroke="#10b981" fill="#10b98155" name="Median (50th)"/>
                      <Area type="monotone" dataKey="p25" stackId="4" stroke="#06b6d4" fill="#06b6d433" name="25th Percentile"/>
                      <Area type="monotone" dataKey="p10" stackId="5" stroke="#8b5cf6" fill="#8b5cf633" name="10th Percentile"/>
                      <Line type="monotone" dataKey="mean" stroke="#ffffff" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Mean"/>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
        )}
      </div>
    </div>
  );
}
