import React, { useState, useEffect, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ComposedChart, Bar, Line, Legend } from 'recharts';
import { Settings, TrendingUp, DollarSign, Activity, Home, Briefcase, PiggyBank, CreditCard, Plus, Trash2 } from 'lucide-react';

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
  { name: "Living Expenses 2", amount: 125000, start_year: 2036, end_year: 2090, growth_rate: 4.0 },
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
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-500">
            Holmes Financial Engine
          </h1>
          <div className="flex gap-3">
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

      <div className="max-w-7xl mx-auto p-6">
        {/* Key Metrics Row */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          {[
            { label: "Current Net Worth", val: totalAssets, icon: PiggyBank, color: "text-emerald-400" },
            { label: `Net Worth @ ${retireAge}`, val: metrics?.nw_at_retirement?.nominal_net_worth, icon: TrendingUp, color: "text-cyan-400" },
            { label: "Net Worth @ 90", val: metrics?.nw_at_90?.nominal_net_worth, icon: Activity, color: "text-purple-400" }
          ].map((s, i) => (
            <div key={i} className="bg-slate-800 p-4 rounded-xl border border-slate-700 h-[50px] flex items-center gap-4">
              <div className={`p-2 bg-slate-900 rounded-lg ${s.color}`}><s.icon size={18}/></div>
              <div>
                <p className="text-slate-400 text-xs font-medium">{s.label}</p>
                <h3 className="text-lg font-bold">{fmt(s.val)}</h3>
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

            <div className="grid grid-cols-2 gap-4">
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
          </div>

          {/* Middle Column - Income & Expenses */}
          <div className="space-y-4" style={{minWidth: '500px'}}>
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
          </div>
        </div>
      </div>
    </div>
  );
}
