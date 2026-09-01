import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ComposedChart, Bar, Line, Legend, ReferenceLine } from 'recharts';
import { Settings, TrendingUp, Activity, Briefcase, PiggyBank, CreditCard, Plus, Trash2, BarChart3, Sliders, ChevronUp, ChevronDown, House } from 'lucide-react';

// Defaults are intentionally stable. A scenario should not change because the
// page happened to mount at a different time or under React StrictMode.
const CURRENT_YEAR = new Date().getFullYear();
const PLAN_VERSION = 1;
const PLAN_STORAGE_KEY = 'holmes-engine-retirement-plan';
const COOL_EXPENSE_COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#06b6d4', '#9ca3af'];
const WARM_TAX_COLORS = ['#ef4444', '#f59e0b', '#f97316', '#ec4899', '#facc15'];
const DEFAULT_INFLATION_RATE = 3.5;
const DEFAULT_RENTAL_VALUES = [343334, 343334, 343333, 343333, 343333, 343333];
const DEFAULT_RENTALS = DEFAULT_RENTAL_VALUES.map((value, index) => ({
  id: `account_rental_${index + 1}`,
  name: `Rental ${index + 1}`,
  value,
  growth_rate: DEFAULT_INFLATION_RATE,
  tax_treatment: 'real_estate',
  property_role: 'rental',
  ownership_pct: 100,
  annual_revenue: 20000,
  annual_operating_expenses: 10000,
  mortgage_balance: 0,
  mortgage_interest_rate: 0,
  mortgage_monthly_payment: 0,
  mortgage_payments_remaining: 0,
}));
const DEFAULT_ASSETS = [
  { id: "account_401k", name: "401k", value: 1200000, growth_rate: 5.5, tax_treatment: "pre_tax", workplace_plan: true },
  { id: "account_roth_ira", name: "Roth IRA", value: 80000, growth_rate: 5.5, tax_treatment: "roth" },
  { id: "account_brokerage_stocks", name: "Brokerage (Stocks)", value: 250000, growth_rate: 5.5, tax_treatment: "taxable" },
  { id: "account_bitcoin", name: "Bitcoin", value: 135000, growth_rate: 7.0, tax_treatment: "bitcoin" },
  ...DEFAULT_RENTALS,
  { id: "account_primary_home", name: "Primary Home", value: 750000, growth_rate: DEFAULT_INFLATION_RATE, tax_treatment: "real_estate", property_role: "primary", ownership_pct: 100, annual_revenue: 0, annual_operating_expenses: 25000, mortgage_balance: 0, mortgage_interest_rate: 0, mortgage_monthly_payment: 0, mortgage_payments_remaining: 0 }
];
const DEFAULT_INFLOWS = [
  { id: "income_w2_salary", name: "W2 Salary", amount: 400000, start_year: CURRENT_YEAR, end_year: CURRENT_YEAR + 10, growth_rate: 3.5, income_type: "w2" },
  { id: "income_royalties", name: "Royalties", amount: 36000, start_year: CURRENT_YEAR + 5, end_year: CURRENT_YEAR + 25, growth_rate: 0.0, income_type: "royalty" },
  { id: "income_social_security", name: "Social Security", amount: 34000, start_year: CURRENT_YEAR + 29, end_year: CURRENT_YEAR + 65, growth_rate: 2.5, income_type: "social_security" }
];
const DEFAULT_OUTFLOWS = [
  { id: "expense_living_1", name: "Living Expenses 1", amount: 175000, start_year: CURRENT_YEAR, end_year: CURRENT_YEAR + 10, growth_rate: 4.0, growth_mode: "custom", discretionary: true },
  { id: "expense_living_2", name: "Living Expenses 2", amount: 150000, start_year: CURRENT_YEAR + 11, end_year: CURRENT_YEAR + 65, growth_rate: 4.0, growth_mode: "custom", discretionary: true },
  { id: "expense_car", name: "Car Expenses", amount: 10000, start_year: CURRENT_YEAR, end_year: CURRENT_YEAR + 55, growth_rate: 4.0, growth_mode: "custom", discretionary: true },
  { id: "expense_health_gap", name: "Health Insurance (Gap)", amount: 20000, start_year: CURRENT_YEAR + 10, end_year: CURRENT_YEAR + 27, growth_rate: 4.0, growth_mode: "custom", discretionary: false }
];
const DEFAULT_OTHER_ASSETS = [
  { id: "event_asset_1", name: "Other Asset 1", value: 500000, add_year: CURRENT_YEAR + 5 },
  { id: "event_asset_2", name: "Other Asset 2", value: 0, add_year: CURRENT_YEAR + 10 }
];
const DEFAULT_ONE_TIME_EXPENSES = [
  { id: "event_expense_1", name: "One-Time Expense 1", amount: 0, year: CURRENT_YEAR + 5, add_to_primary_home: false },
  { id: "event_expense_2", name: "One-Time Expense 2", amount: 0, year: CURRENT_YEAR + 10, add_to_primary_home: false }
];
const DEFAULT_RATES = {
  inflation: DEFAULT_INFLATION_RATE,
  stockGrowth: 6,
  retireAge: 50,
  retirementWithdrawalAge: 70,
};
const DEFAULT_PLAN_THROUGH_AGE = 100;
const DEFAULT_TAX_FILING_STATUS = 'married_joint';
const DEFAULT_TAX_VERSION = '2025_simplified';
const DEFAULT_RMD_START_AGE = 73;
const DEFAULT_DIVIDEND_YIELD_PCT = 1;
const DEFAULT_SALE_HAIRCUT_PCT = 10;
const DEFAULT_WORKPLACE_CONTRIBUTION_LIMIT = 24500;
const DEFAULT_EMPLOYER_MATCH_RATE_PCT = 13;
const MAX_MONTE_CARLO_RUNS = 5000;
const DEFAULT_WITHDRAWAL_ORDER = ['rmds', 'taxable', 'bitcoin', 'pre_tax', 'roth', 'rental', 'primary'];
const CHART_INITIAL_DIMENSION = { width: 640, height: 300 };
const WITHDRAWAL_LABELS = {
  rmds: 'RMDs',
  taxable: 'Taxable',
  bitcoin: 'Bitcoin',
  pre_tax: 'Pre-tax',
  roth: 'Roth',
  rental: 'Rental sale',
  primary: 'Primary-home sale',
};
const ASSET_TYPE_OPTIONS = [
  ['taxable', 'Taxable investment'],
  ['bitcoin', 'Bitcoin / crypto'],
  ['pre_tax', 'Pre-tax / 401(k)'],
  ['roth', 'Roth'],
  ['real_estate', 'Property'],
];
const FINANCIAL_ASSET_TYPE_OPTIONS = ASSET_TYPE_OPTIONS.filter(([value]) => value !== 'real_estate');
const INCOME_TYPE_OPTIONS = [
  ['w2', 'Salary / W-2'],
  ['rental', 'Rental income'],
  ['royalty', 'Royalties'],
  ['social_security', 'Social Security'],
  ['other', 'Other income'],
];
const WARNING_TITLES = {
  CONTRIBUTION_ROUTING: 'Contribution destination',
  DETERMINISTIC: 'One-path result',
  DUPLICATE_ID: 'Duplicate internal item',
  DUPLICATE_NAME: 'Duplicate name',
  HIGH_SALE_HAIRCUT: 'High sale haircut',
  HISTORICAL_SEQUENCE: 'Historical sequence',
  HISTORICAL_WRAP_CONTINUATION: 'History repeated',
  MORTGAGE_UNSCHEDULED: 'Mortgage schedule',
  POOLED_RENTAL_INCOME: 'Pooled rental income',
  SMALL_SIMULATION_SET: 'Small run count',
  STALE_RESULT: 'Result needs refresh',
  UNUSUAL_INFLATION: 'Unusual inflation',
  UNUSUAL_PROPERTY_GROWTH: 'Unusual property growth',
  UNUSUAL_STOCK_GROWTH: 'Unusual stock growth',
};

// Randomization is an explicit user action; it is never used during mount.
const clone = (value) => JSON.parse(JSON.stringify(value));

const asNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const wireAmount = (value, isCents = false) => {
  const number = asNumber(value);
  return isCents ? number / 100 : number;
};

const firstFinite = (...values) => {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
};

function normalizeTimeline(source, params) {
  if (!Array.isArray(source)) return [];
  return source.map((row, index) => {
    const age = firstFinite(row?.age, params.current_age + index);
    const year = firstFinite(row?.year, params.current_year + (age - params.current_age));
    const endingIsCents = Boolean(row?.ending_balances_cents);
    const ending = row?.ending_balances_cents || row?.ending_balances || row?.balances || {};
    const totalFromMap = Object.values(ending).reduce((sum, value) => sum + wireAmount(value, endingIsCents), 0);
    const total = firstFinite(row?.nominal_net_worth, row?.total_assets, row?.total_assets_cents != null ? wireAmount(row.total_assets_cents, true) : undefined, totalFromMap);
    const expenses = firstFinite(row?.total_expenses, row?.scheduled_spending, row?.spending_need_cents != null ? wireAmount(row.spending_need_cents, true) : undefined);
    return {
      ...row,
      age,
      year,
      nominal_net_worth: total,
      total_assets: firstFinite(row?.total_assets, row?.total_assets_cents != null ? wireAmount(row.total_assets_cents, true) : undefined, total),
      liquid_net_worth: firstFinite(row?.liquid_net_worth, row?.liquid_assets, row?.liquid_assets_cents != null ? wireAmount(row.liquid_assets_cents, true) : undefined),
      property_net_worth: firstFinite(row?.property_net_worth, row?.property_assets, row?.property_assets_cents != null ? wireAmount(row.property_assets_cents, true) : undefined),
      real_net_worth: firstFinite(row?.real_net_worth, row?.real_total_assets, total),
      total_expenses: expenses,
      retirement_traditional: firstFinite(row?.retirement_traditional, row?.traditional_401k, row?.ending_balances_cents?.traditional_401k != null ? wireAmount(row.ending_balances_cents.traditional_401k, true) : undefined),
      retirement_roth: firstFinite(row?.retirement_roth, row?.roth_ira, row?.ending_balances_cents?.roth_ira != null ? wireAmount(row.ending_balances_cents.roth_ira, true) : undefined),
      brokerage: firstFinite(row?.brokerage, row?.taxable, row?.ending_balances_cents?.taxable != null ? wireAmount(row.ending_balances_cents.taxable, true) : undefined),
      rental_properties: firstFinite(row?.rental_properties, row?.rental_property_equity, row?.ending_balances_cents?.rental_property_equity != null ? wireAmount(row.ending_balances_cents.rental_property_equity, true) : undefined),
      primary_home: firstFinite(row?.primary_home, row?.primary_home_equity, row?.ending_balances_cents?.primary_home_equity != null ? wireAmount(row.ending_balances_cents.primary_home_equity, true) : undefined),
    };
  });
}

function normalizeResponse(raw, params) {
  const root = raw?.result && typeof raw.result === 'object' ? raw.result : raw;
  const percentileData = root?.percentileData || root?.percentiles || root?.percentile_data || [];
  const expensePercentileData = root?.expensePercentileData || root?.expense_percentile_data || [];
  const expenseByAge = new Map(expensePercentileData.map((row) => [Number(row?.age), row]));
  const timeline = normalizeTimeline(root?.timeline || root?.rows || root?.data || percentileData.map((row) => ({
    ...row,
    nominal_net_worth: row?.p50 ?? row?.median,
    total_expenses: expenseByAge.get(Number(row?.age))?.p50 ?? expenseByAge.get(Number(row?.age))?.median,
  })), params);
  const summary = root?.summary || {};
  const last = timeline[timeline.length - 1];
  const atRetirement = timeline.find((row) => row.age === params.target_retirement_age) || timeline[0];
  const metrics = root?.metrics || {
    nw_at_retirement: { nominal_net_worth: atRetirement?.nominal_net_worth, real_net_worth: atRetirement?.real_net_worth },
    nw_at_95: { nominal_net_worth: timeline.find((row) => row.age === 95)?.nominal_net_worth ?? last?.nominal_net_worth, real_net_worth: timeline.find((row) => row.age === 95)?.real_net_worth ?? last?.real_net_worth },
    nw_at_plan_end: { nominal_net_worth: last?.nominal_net_worth, real_net_worth: last?.real_net_worth },
  };
  if (!metrics.nw_at_plan_end && last) {
    metrics.nw_at_plan_end = { nominal_net_worth: last.nominal_net_worth, real_net_worth: last.real_net_worth };
  }
  const warnings = Array.isArray(root?.warnings) ? [...root.warnings] : [];
  const blocks = Array.isArray(root?.blocks) ? root.blocks : [];
  for (const block of blocks.slice(0, 8)) {
    warnings.push({
      code: block?.code || 'CALCULATION_BLOCK',
      path: block?.path,
      message: block?.message || 'The calculation recorded a visible block.',
      severity: 'medium',
    });
  }
  return {
    ...root,
    timeline,
    metrics,
    freedom_year: root?.freedom_year ?? summary.freedom_year ?? null,
    warnings,
    percentileData: Array.isArray(percentileData) ? percentileData : [],
    stockReturnBoxData: root?.stockReturnBoxData || root?.stock_return_box_data || [],
    expensePercentileData,
    successRate: firstFinite(root?.successRate, root?.success_rate, summary.success_rate),
    baselineSuccessRate: firstFinite(root?.baselineSuccessRate, root?.baseline_success_rate, root?.successRate, root?.success_rate, summary.success_rate),
    adaptiveSuccessRate: firstFinite(root?.adaptiveSuccessRate, root?.adaptive_success_rate, root?.successRate, root?.success_rate, summary.success_rate),
    adaptiveSpendingEnabled: Boolean(root?.adaptiveSpendingEnabled ?? root?.adaptive_spending_enabled),
    numRuns: firstFinite(root?.numRuns, root?.num_runs, summary.num_runs),
    runOutcomes: Array.isArray(root?.runOutcomes) ? root.runOutcomes : (Array.isArray(root?.run_outcomes) ? root.run_outcomes : []),
  };
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(rows, filename = 'retirement-scenario.csv') {
  if (!Array.isArray(rows) || rows.length === 0 || typeof document === 'undefined') return false;
  const exportRows = rows.map((row) => ({
    year: row?.year,
    age: row?.age,
    nominal_net_worth: row?.nominal_net_worth,
    liquid_net_worth: row?.liquid_net_worth,
    property_net_worth: row?.property_net_worth,
    mortgage_balance_total: row?.mortgage_balance_total,
    mortgage_payment_total: row?.mortgage_payment_total,
    property_gross_revenue: row?.property_gross_revenue,
    property_operating_expenses: row?.property_operating_expenses,
    property_net_operating_income: row?.property_net_operating_income,
    mortgage_principal_total: row?.mortgage_principal_total,
    mortgage_interest_total: row?.mortgage_interest_total,
    real_net_worth: row?.real_net_worth,
    total_expenses: row?.total_expenses,
    tax_income_total: row?.tax_income_total,
    tax_total: row?.tax_total,
    requested_withdrawal: row?.requested_withdrawal,
    funded_withdrawal: row?.funded_withdrawal,
    withdrawal_shortfall: row?.withdrawal_shortfall,
    rmd_required: row?.rmd?.required_amount,
    rmd_used: row?.rmd?.used_amount ?? row?.rmd?.applied_amount,
    rmd_excess: row?.rmd?.excess_amount,
    employee_401k_contribution: row?.employee_401k_contribution,
    employer_401k_match: row?.employer_401k_match,
    contribution_destination: row?.contribution_destination,
    retirement_traditional: row?.retirement_traditional,
    retirement_roth: row?.retirement_roth,
    brokerage: row?.brokerage,
    bitcoin: row?.bitcoin,
    rental_properties: row?.rental_properties,
    primary_home: row?.primary_home,
    cash_reserve: row?.cash_reserve,
  }));
  const keys = Object.keys(exportRows[0]);
  const csv = [keys, ...exportRows.map((row) => keys.map((key) => csvCell(row?.[key])))]
    .map((line) => line.join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}

async function friendlyApiError(response, label = 'API') {
  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    const error = payload?.error;
    const detail = Array.isArray(error?.details) && error.details.length
      ? ` ${error.details.slice(0, 3).map(item => item.message).filter(Boolean).join(' ')}`
      : '';
    return `${label} ${response.status}: ${error?.message || 'The request could not be completed.'}${detail}`;
  } catch {
    return `${label} ${response.status} ${response.statusText}: ${text || 'The request could not be completed.'}`;
  }
}

const normalizedLabel = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const isW2Stream = (item) => {
  const type = item?.income_type;
  return type ? type === 'w2' : normalizedLabel(item?.name).includes('w2') || normalizedLabel(item?.name).includes('salary');
};

function validateDraft({
  currentYear,
  currentAge,
  retireAge,
  retirementWithdrawalAge,
  planThroughAge,
  inflation,
  dividendYieldPct,
  saleHaircutPct,
  workplaceContributionLimit,
  employerMatchRatePct,
  assets,
  inflows,
  outflows,
  otherAssets,
  oneTimeExpenses,
  withdrawalOrder,
  mode,
  mcSettings,
  spendingRules,
}) {
  const errors = [];
  if (mode !== 'custom' && mode !== 'historical') errors.push({ path: 'mode', message: 'Choose a supported analysis mode.' });
  const number = (value, path, { min = null, max = null, integer = false } = {}) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      errors.push({ path, message: 'Enter a valid number.' });
      return null;
    }
    if (integer && !Number.isInteger(parsed)) errors.push({ path, message: 'Use a whole number.' });
    if (min !== null && parsed < min) errors.push({ path, message: `Must be at least ${min}.` });
    if (max !== null && parsed > max) errors.push({ path, message: `Must be no more than ${max}.` });
    return parsed;
  };
  const yearStart = number(currentYear, 'current_year', { min: 1900, max: 2200, integer: true });
  const age = number(currentAge, 'current_age', { min: 0, max: 120, integer: true });
  const endAge = number(planThroughAge, 'plan_through_age', { min: 85, max: 115, integer: true });
  const retirement = number(retireAge, 'target_retirement_age', { min: 0, max: 120, integer: true });
  const withdrawalAge = number(retirementWithdrawalAge, 'retirement_withdrawal_age', { min: 0, max: 120, integer: true });
  number(inflation, 'general_inflation', { min: -99.999 });
  number(dividendYieldPct, 'dividend_yield', { min: 0, max: 100 });
  number(saleHaircutPct, 'sale_haircut', { min: 0, max: 99.9 });
  number(workplaceContributionLimit, 'workplace_contribution_limit', { min: 0 });
  number(employerMatchRatePct, 'employer_match_rate', { min: 0, max: 100 });
  if (age !== null && endAge !== null && retirement !== null && (retirement < age || retirement > endAge)) {
    errors.push({ path: 'target_retirement_age', message: 'Retirement age must be between current age and plan-through age.' });
  }
  if (withdrawalAge !== null && endAge !== null && withdrawalAge > endAge) {
    errors.push({ path: 'retirement_withdrawal_age', message: '401(k) withdrawal age cannot be after the plan-through age.' });
  }
  if (!Array.isArray(assets) || assets.length === 0) {
    errors.push({ path: 'assets', message: 'Keep at least one asset in the plan.' });
  }
  const collections = [
    ['assets', assets, true],
    ['inflows', inflows, true],
    ['outflows', outflows, true],
    ['other_assets', otherAssets, true],
    ['one_time_expenses', oneTimeExpenses, true],
  ];
  const allIds = new Set();
  for (const [path, items, requireName] of collections) {
    const names = new Set();
    for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
      const name = normalizedLabel(item?.name);
      if (requireName && !name) errors.push({ path: `${path}.${index}.name`, message: 'Name is required.' });
      if (name && names.has(name)) errors.push({ path: `${path}.${index}.name`, message: 'Names must be unique (ignoring case and extra spaces).' });
      if (name) names.add(name);
      if (item?.id) {
        const id = normalizedLabel(item.id);
        if (allIds.has(id)) errors.push({ path: `${path}.${index}.id`, message: 'Internal IDs must be unique across the plan.' });
        allIds.add(id);
      }
      if ('value' in (item || {})) number(item.value, `${path}.${index}.value`, { min: 0 });
      if ('amount' in (item || {})) number(item.amount, `${path}.${index}.amount`, { min: 0 });
      if ('growth_rate' in (item || {}) && item?.growth_mode !== 'global') number(item.growth_rate, `${path}.${index}.growth_rate`, { min: -99.999 });
      if (path === 'assets' && item?.tax_treatment === 'real_estate') {
        number(item.ownership_pct ?? 100, `${path}.${index}.ownership_pct`, { min: 0.01, max: 100 });
        number(item.annual_revenue ?? 0, `${path}.${index}.annual_revenue`, { min: 0 });
        number(item.annual_operating_expenses ?? 0, `${path}.${index}.annual_operating_expenses`, { min: 0 });
        number(item.mortgage_balance ?? 0, `${path}.${index}.mortgage_balance`, { min: 0 });
        number(item.mortgage_interest_rate ?? 0, `${path}.${index}.mortgage_interest_rate`, { min: 0, max: 100 });
        number(item.mortgage_monthly_payment ?? 0, `${path}.${index}.mortgage_monthly_payment`, { min: 0 });
        number(item.mortgage_payments_remaining ?? 0, `${path}.${index}.mortgage_payments_remaining`, { min: 0, max: 1200, integer: true });
      }
      if ('start_year' in (item || {})) {
        const start = number(item.start_year, `${path}.${index}.start_year`, { min: 1900, max: 2400, integer: true });
        const finish = number(item.end_year, `${path}.${index}.end_year`, { min: 1900, max: 2400, integer: true });
        if (start !== null && finish !== null && finish < start) errors.push({ path: `${path}.${index}`, message: 'End year must be on or after start year.' });
        if (yearStart !== null && age !== null && endAge !== null && start !== null && finish !== null) {
          const lastYear = yearStart + (endAge - age);
          if (finish < yearStart || start > lastYear) errors.push({ path: `${path}.${index}`, message: 'This item must overlap the modeled years.' });
        }
      }
      if ('add_year' in (item || {}) || (path === 'one_time_expenses' && 'year' in (item || {}))) {
        const eventYear = number(item.add_year ?? item.year, `${path}.${index}.year`, { min: 1900, max: 2400, integer: true });
        if (yearStart !== null && age !== null && endAge !== null && eventYear !== null) {
          const lastYear = yearStart + (endAge - age);
          if (eventYear < yearStart || eventYear > lastYear) errors.push({ path: `${path}.${index}.year`, message: 'Event year must fall inside the modeled horizon.' });
        }
      }
    }
  }
  const allowedOrder = new Set(['rmds', 'taxable', 'bitcoin', 'pre_tax', 'roth', 'rental', 'primary']);
  if (!Array.isArray(withdrawalOrder) || withdrawalOrder.length !== allowedOrder.size || withdrawalOrder.some(item => !allowedOrder.has(item)) || new Set(withdrawalOrder).size !== withdrawalOrder.length || new Set(withdrawalOrder).size !== allowedOrder.size) {
    errors.push({ path: 'withdrawal_order', message: 'Withdrawal sources must include each category exactly once.' });
  }
  if (mode === 'historical') {
    number(mcSettings?.numRuns, 'monte_carlo.num_runs', { min: 1, max: MAX_MONTE_CARLO_RUNS, integer: true });
    number(mcSettings?.stockVolatility, 'monte_carlo.stock_volatility', { min: 0, max: 100 });
    number(mcSettings?.realEstateVolatility, 'monte_carlo.real_estate_volatility', { min: 0, max: 100 });
    number(mcSettings?.inflationVolatility, 'monte_carlo.inflation_volatility', { min: 0, max: 100 });
  }
  for (const [index, rule] of (Array.isArray(spendingRules) ? spendingRules : []).entries()) {
    number(rule?.stockDownPct, `spending_rules.${index}.stock_down_threshold`, { min: 0, max: 100 });
    number(rule?.reduceSpendingPct, `spending_rules.${index}.reduce_spending_pct`, { min: 0, max: 100 });
    number(rule?.years, `spending_rules.${index}.years`, { min: 0, max: 120, integer: true });
  }
  return errors;
}

export default function App() {
  const [data, setData] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [simError, setSimError] = useState(null);
  const [resultWarnings, setResultWarnings] = useState([]);
  const [runState, setRunState] = useState({ status: 'idle', requestId: 0, submittedAt: null, completedAt: null, mode: null });
  const [resultSignature, setResultSignature] = useState(null);
  // Keep the submitted draft alongside the immutable result. Charts, labels
  // and exports use this snapshot while the user edits a new draft, so a
  // stale result never quietly changes underneath them.
  const [resultSnapshot, setResultSnapshot] = useState(null);
  const [planMessage, setPlanMessage] = useState(null);
  const [draftErrors, setDraftErrors] = useState([]);
  const [tableOpen, setTableOpen] = useState(false);
  const [mode, setMode] = useState('custom');
  const [activePlannerSection, setActivePlannerSection] = useState('assumptions');
  const [seed, setSeed] = useState(() => CURRENT_YEAR * 100 + 42);
  const requestIdRef = useRef(0);
  const requestControllerRef = useRef(null);
  const inspectRequestIdRef = useRef(0);
  const inspectControllerRef = useRef(null);

  const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

  // Monte Carlo state
  const [mcSettings, setMcSettings] = useState({
    numRuns: 100,
    stockVolatility: 15,      // % standard deviation for stocks
    realEstateVolatility: 0,  // retained on the wire; property follows inflation
    inflationVolatility: 0, // % standard deviation for inflation (default off)
  });
  const [mcResults, setMcResults] = useState(null);
  const [mcRunning, setMcRunning] = useState(false);

  const [spendingRules, setSpendingRules] = useState([
    { stockDownPct: 10, reduceSpendingPct: 10, years: 2 },
    { stockDownPct: 20, reduceSpendingPct: 20, years: 3 },
    { stockDownPct: 30, reduceSpendingPct: 40, years: 5 },
  ]);
  const [adaptiveSpendingEnabled, setAdaptiveSpendingEnabled] = useState(false);

  const updateSpendingRule = (index, field, value) => {
    setSpendingRules(prev => prev.map((rule, idx) => idx === index ? {
      ...rule,
      [field]: value,
    } : rule));
  };

  // Monte Carlo run inspector state
  const [inspectRunIndex, setInspectRunIndex] = useState(0);
  const [inspectRun, setInspectRun] = useState(null);
  const [inspectRunning, setInspectRunning] = useState(false);
  const [inspectError, setInspectError] = useState(null);
  const [runFilter, setRunFilter] = useState('all');

  // Core assumptions. These are fixed and current-year based on first load.
  const [currentYear, setCurrentYear] = useState(CURRENT_YEAR);
  const [currentAge, setCurrentAge] = useState(38);
  const [retireAge, setRetireAge] = useState(DEFAULT_RATES.retireAge);
  const [inflation, setInflation] = useState(DEFAULT_RATES.inflation);
  const [stockGrowth, setStockGrowth] = useState(DEFAULT_RATES.stockGrowth);
  const [retirementWithdrawalAge, setRetirementWithdrawalAge] = useState(DEFAULT_RATES.retirementWithdrawalAge);
  const [planThroughAge, setPlanThroughAge] = useState(DEFAULT_PLAN_THROUGH_AGE);
  const [taxFilingStatus, setTaxFilingStatus] = useState(DEFAULT_TAX_FILING_STATUS);
  const [taxVersion, setTaxVersion] = useState(DEFAULT_TAX_VERSION);
  const [rmdStartAge, setRmdStartAge] = useState(DEFAULT_RMD_START_AGE);
  const [historicalWrapMode, setHistoricalWrapMode] = useState('continue');
  const [dividendYieldPct, setDividendYieldPct] = useState(DEFAULT_DIVIDEND_YIELD_PCT);
  const [saleHaircutPct, setSaleHaircutPct] = useState(DEFAULT_SALE_HAIRCUT_PCT);
  const [workplaceContributionLimit, setWorkplaceContributionLimit] = useState(DEFAULT_WORKPLACE_CONTRIBUTION_LIMIT);
  const [employerMatchRatePct, setEmployerMatchRatePct] = useState(DEFAULT_EMPLOYER_MATCH_RATE_PCT);
  const [withdrawalOrder, setWithdrawalOrder] = useState(() => [...DEFAULT_WITHDRAWAL_ORDER]);

  // Inputs are cloned so edits never mutate the stable defaults.
  const [assets, setAssets] = useState(() => clone(DEFAULT_ASSETS));

  const [inflows, setInflows] = useState(() => clone(DEFAULT_INFLOWS));

  const [outflows, setOutflows] = useState(() => clone(DEFAULT_OUTFLOWS));

  const [otherAssets, setOtherAssets] = useState(() => clone(DEFAULT_OTHER_ASSETS));

  const [oneTimeExpenses, setOneTimeExpenses] = useState(() => clone(DEFAULT_ONE_TIME_EXPENSES));

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
          setRetireAge(DEFAULT_RATES.retireAge);
          setRetirementWithdrawalAge(DEFAULT_RATES.retirementWithdrawalAge);
          setPlanThroughAge(DEFAULT_PLAN_THROUGH_AGE);
          setTaxFilingStatus(DEFAULT_TAX_FILING_STATUS);
          setTaxVersion(DEFAULT_TAX_VERSION);
          setRmdStartAge(DEFAULT_RMD_START_AGE);
          setHistoricalWrapMode('continue');
          setDividendYieldPct(DEFAULT_DIVIDEND_YIELD_PCT);
          setSaleHaircutPct(DEFAULT_SALE_HAIRCUT_PCT);
          setWorkplaceContributionLimit(DEFAULT_WORKPLACE_CONTRIBUTION_LIMIT);
          setEmployerMatchRatePct(DEFAULT_EMPLOYER_MATCH_RATE_PCT);
          setWithdrawalOrder([...DEFAULT_WITHDRAWAL_ORDER]);
          setMcSettings({
            numRuns: 100,
            stockVolatility: 15,
            realEstateVolatility: 8,
            inflationVolatility: 0,
          });
          setSpendingRules([
            { stockDownPct: 10, reduceSpendingPct: 10, years: 2 },
            { stockDownPct: 20, reduceSpendingPct: 20, years: 3 },
            { stockDownPct: 30, reduceSpendingPct: 40, years: 5 },
          ]);
          setAdaptiveSpendingEnabled(false);
          setCurrentYear(CURRENT_YEAR);
          setSeed(CURRENT_YEAR * 100 + 42);
          setMode('custom');
          setActivePlannerSection('assumptions');
          setData(null);
          setMetrics(null);
          setMcResults(null);
          setInspectRun(null);
          setInspectRunIndex(0);
          setInspectError(null);
          setResultWarnings([]);
          setResultSignature(null);
          setResultSnapshot(null);
          setDraftErrors([]);
          setSimError(null);
          setRunState({ status: 'idle', requestId: requestIdRef.current, submittedAt: null, completedAt: null, mode: null });
          requestIdRef.current += 1;
          requestControllerRef.current?.abort();
          requestControllerRef.current = null;
          inspectRequestIdRef.current += 1;
          inspectControllerRef.current?.abort();
          inspectControllerRef.current = null;
          setPlanMessage('Defaults restored. Choose Run to calculate a fresh snapshot.');
          konamiIndex = 0;
        }
      } else {
        konamiIndex = 0;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const simulationParams = useMemo(() => ({
    current_year: currentYear,
    current_age: currentAge,
    target_retirement_age: retireAge,
    retirement_withdrawal_age: retirementWithdrawalAge,
    plan_through_age: planThroughAge,
    general_inflation: inflation / 100,
    tax_filing_status: taxFilingStatus,
    tax_version: taxVersion,
    rmd_start_age: rmdStartAge,
    historical_wrap_mode: historicalWrapMode,
    dividend_yield: dividendYieldPct / 100,
    sale_haircut: saleHaircutPct / 100,
    workplace_contribution_limit: asNumber(workplaceContributionLimit, DEFAULT_WORKPLACE_CONTRIBUTION_LIMIT),
    employer_match_rate: asNumber(employerMatchRatePct, DEFAULT_EMPLOYER_MATCH_RATE_PCT) / 100,
    withdrawal_order: [...withdrawalOrder],
    seed: Math.trunc(asNumber(seed)),
    assets: assets.map(a => {
      const normalized = { ...a, growth_rate: asNumber(a.growth_rate) / 100 };
      if (a.tax_treatment === 'real_estate') {
        normalized.growth_rate = asNumber(inflation) / 100;
        normalized.ownership_percentage = asNumber(a.ownership_pct, 100) / 100;
        normalized.annual_revenue = asNumber(a.annual_revenue, 0);
        normalized.annual_operating_expenses = asNumber(a.annual_operating_expenses, 0);
        normalized.mortgage_interest_rate = asNumber(a.mortgage_interest_rate, 0) / 100;
        normalized.mortgage_balance = asNumber(a.mortgage_balance, 0);
        normalized.mortgage_monthly_payment = asNumber(a.mortgage_monthly_payment, 0);
        normalized.mortgage_payments_remaining = Math.max(0, Math.trunc(asNumber(a.mortgage_payments_remaining, 0)));
      }
      delete normalized.ownership_pct;
      return normalized;
    }),
    inflows: inflows.map(i => ({ ...i, growth_rate: asNumber(i.growth_rate) / 100 })),
    outflows: outflows.map(o => ({
      ...o,
      growth_mode: o.growth_mode === 'global' ? 'global' : 'custom',
      growth_rate: asNumber(o.growth_rate, inflation) / 100,
    })),
    other_assets: clone(otherAssets),
    one_time_expenses: clone(oneTimeExpenses),
  }), [assets, currentAge, currentYear, dividendYieldPct, employerMatchRatePct, historicalWrapMode, inflation, inflows, oneTimeExpenses, otherAssets, outflows, planThroughAge, retireAge, retirementWithdrawalAge, rmdStartAge, saleHaircutPct, seed, taxFilingStatus, taxVersion, withdrawalOrder, workplaceContributionLimit]);

  const normalizedSpendingRules = useMemo(() => {
    if (!adaptiveSpendingEnabled) return [];
    return spendingRules
      .map(rule => ({
        stock_down_threshold: asNumber(rule.stockDownPct) / 100,
        reduce_spending_pct: asNumber(rule.reduceSpendingPct) / 100,
        years: Math.max(0, Math.round(asNumber(rule.years))),
      }))
      .filter(rule => rule.stock_down_threshold > 0 && rule.reduce_spending_pct > 0 && rule.years > 0);
  }, [adaptiveSpendingEnabled, spendingRules]);

  const scenarioSignature = useMemo(() => JSON.stringify({
    mode, seed, simulationParams, mcSettings, spendingRules, adaptiveSpendingEnabled,
  }), [adaptiveSpendingEnabled, mcSettings, mode, seed, simulationParams, spendingRules]);

  const resultIsStale = Boolean(data && resultSignature && resultSignature !== scenarioSignature);

  const invalidatePendingRequests = useCallback(() => {
    requestIdRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    inspectRequestIdRef.current += 1;
    inspectControllerRef.current?.abort();
    inspectControllerRef.current = null;
    setMcRunning(false);
    setInspectRunning(false);
    setInspectRun(null);
    setInspectError(null);
  }, []);

  const changeMode = useCallback((nextMode) => {
    invalidatePendingRequests();
    setMode(nextMode);
    if (nextMode === 'custom') setMcResults(null);
    setRunState(previous => ({
      ...previous,
      status: previous.status === 'running' ? (data ? 'stale' : 'idle') : previous.status,
      mode: nextMode,
    }));
  }, [data, invalidatePendingRequests]);

  // Editing a field never submits a request, but it immediately makes the
  // visible result clearly stale so a user cannot mistake it for the draft.
  useEffect(() => {
    if (!resultIsStale) return;
    setRunState(previous => previous.status === 'success' ? { ...previous, status: 'stale' } : previous);
  }, [resultIsStale]);

  const runScenario = useCallback(async (requestedMode = mode) => {
    const validationErrors = validateDraft({
      currentYear,
      currentAge,
      retireAge,
      retirementWithdrawalAge,
      planThroughAge,
      inflation,
      dividendYieldPct,
      saleHaircutPct,
      workplaceContributionLimit,
      employerMatchRatePct,
      assets,
      inflows,
      outflows,
      otherAssets,
      oneTimeExpenses,
      withdrawalOrder,
      mode: requestedMode,
      mcSettings,
      spendingRules,
    });
    if (validationErrors.length > 0) {
      // A failed re-run should invalidate any in-flight request so it cannot
      // publish an older snapshot after the user has been shown validation
      // errors.
      requestIdRef.current += 1;
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      inspectRequestIdRef.current += 1;
      inspectControllerRef.current?.abort();
      inspectControllerRef.current = null;
      setInspectRun(null);
      setMcRunning(false);
      setDraftErrors(validationErrors);
      setSimError(`Fix ${validationErrors.length} input ${validationErrors.length === 1 ? 'issue' : 'issues'} before running.`);
      setRunState(previous => ({ ...previous, status: 'invalid', mode: requestedMode }));
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    requestControllerRef.current?.abort();
    inspectRequestIdRef.current += 1;
    inspectControllerRef.current?.abort();
    inspectControllerRef.current = null;
    setInspectRun(null);
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const submittedAt = new Date().toISOString();
    const requestToken = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `request-${Date.now()}-${requestId}`;
    const request = requestedMode === 'historical'
      ? {
        mode: requestedMode,
        request_token: requestToken,
        params: simulationParams,
        num_runs: Math.max(1, Math.min(MAX_MONTE_CARLO_RUNS, Math.round(asNumber(mcSettings.numRuns, 100)))),
        stock_volatility: Math.max(0, asNumber(mcSettings.stockVolatility) / 100),
        real_estate_volatility: Math.max(0, asNumber(mcSettings.realEstateVolatility) / 100),
        inflation_volatility: Math.max(0, asNumber(mcSettings.inflationVolatility) / 100),
        spending_rules: normalizedSpendingRules,
        seed: Math.trunc(asNumber(seed)),
      }
      : { ...simulationParams, mode: requestedMode, request_token: requestToken };
    const submittedSignature = JSON.stringify({ mode: requestedMode, seed, simulationParams, mcSettings, spendingRules, adaptiveSpendingEnabled });
    const submittedDraft = {
      mode: requestedMode,
      currentYear,
      currentAge,
      retireAge,
      planThroughAge,
      inflation,
      outflows: clone(outflows),
      oneTimeExpenses: clone(oneTimeExpenses),
    };
    setSimError(null);
    setDraftErrors([]);
    setRunState({ status: 'running', requestId, submittedAt, completedAt: null, mode: requestedMode });
    setMcRunning(requestedMode === 'historical');
    let timeoutId;
    try {
      timeoutId = setTimeout(() => controller.abort(), 15000);
      const endpoint = requestedMode === 'historical' ? '/monte_carlo' : '/simulate';
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(request),
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw new Error(await friendlyApiError(response));
      }
      const raw = await response.json();
      const result = normalizeResponse(raw, simulationParams);
      if (result.timeline.length === 0 && result.percentileData.length === 0) throw new Error('API response did not include a timeline or result rows.');
      if (requestId !== requestIdRef.current) return;
      setData(result.timeline);
      setMetrics(result.metrics);
      setResultWarnings(result.warnings);
      setResultSignature(submittedSignature);
      setResultSnapshot(submittedDraft);
      if (requestedMode === 'historical') {
        setMcResults({ ...result, request, seed: request.seed });
        setInspectRunIndex(0);
        setInspectRun(null);
        setInspectError(null);
      } else {
        setMcResults(null);
      }
      setRunState({ status: 'success', requestId, submittedAt, completedAt: new Date().toISOString(), mode: requestedMode });
      if (requestedMode === 'custom') setActivePlannerSection('results');
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      const message = err?.name === 'AbortError'
        ? `Request timed out contacting ${API_URL}`
        : (err?.message || String(err));
      setSimError(message);
      setRunState({ status: 'error', requestId, submittedAt, completedAt: new Date().toISOString(), mode: requestedMode });
    } finally {
      if (timeoutId != null) clearTimeout(timeoutId);
      if (requestId === requestIdRef.current) {
        requestControllerRef.current = null;
        if (requestedMode === 'historical') setMcRunning(false);
      }
    }
  }, [API_URL, adaptiveSpendingEnabled, assets, currentAge, currentYear, dividendYieldPct, employerMatchRatePct, inflation, inflows, mcSettings, mode, normalizedSpendingRules, oneTimeExpenses, otherAssets, outflows, planThroughAge, retireAge, retirementWithdrawalAge, saleHaircutPct, seed, simulationParams, spendingRules, withdrawalOrder, workplaceContributionLimit]);

  const runMonteCarlo = useCallback(() => runScenario('historical'), [runScenario]);

  const applyStockGrowthAssumption = (value) => {
    const next = asNumber(value, stockGrowth);
    setStockGrowth(next);
    setAssets(previous => previous.map(asset => (
      asset.tax_treatment === 'real_estate' || asset.tax_treatment === 'bitcoin' || asset.tax_treatment === 'crypto'
        ? asset
        : { ...asset, growth_rate: next }
    )));
  };

  // Keep the convenience dates in sync with the editable current year and
  // retirement age. This only edits draft fields; it does not run a request.
  useEffect(() => {
    const retirementYear = currentYear + (retireAge - currentAge);
    
    // Retirement age is the first full retirement year, so salary ends the
    // prior year. The backend also enforces this guard for imported plans.
    setInflows(prev => prev.map(i => 
      isW2Stream(i)
        ? { ...i, end_year: Math.max(currentYear, retirementYear - 1) }
        : i
    ));
    
    // Update Health Insurance Gap start date to retirement year
    setOutflows(prev => prev.map(o => 
      o.name.toLowerCase().includes('health insurance')
        ? { ...o, start_year: retirementYear }
        : o
    ));
  }, [currentAge, currentYear, retireAge]);

  const fetchInspectRun = useCallback(async () => {
    if (!mcResults?.request) return;

    const requestId = inspectRequestIdRef.current + 1;
    inspectRequestIdRef.current = requestId;
    inspectControllerRef.current?.abort();
    const controller = new AbortController();
    inspectControllerRef.current = controller;
    setInspectRunning(true);
    setInspectError(null);

    let timeoutId;
    try {
      const numRuns = Number(mcResults.request?.num_runs || mcResults.numRuns || 1);
      const idx = Math.max(0, Math.min(numRuns - 1, Number(inspectRunIndex) || 0));

      timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${API_URL}/monte_carlo_run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          params: mcResults.request.params,
          run_index: idx,
          num_runs: mcResults.request.num_runs,
          stock_volatility: mcResults.request.stock_volatility,
          real_estate_volatility: mcResults.request.real_estate_volatility,
          inflation_volatility: mcResults.request.inflation_volatility,
          spending_rules: mcResults.request.spending_rules,
          spending_rule: mcResults.request.spending_rule,
          seed: mcResults.request.seed,
          mode: mcResults.request.mode || 'historical',
          fingerprint: mcResults.fingerprint || mcResults.requestToken || mcResults.request_token,
        })
      });

      if (!res.ok) {
        throw new Error(await friendlyApiError(res, 'Run API'));
      }

      const result = await res.json();
      const normalized = normalizeResponse(result, mcResults.request.params);
      if (!normalized.timeline.length) throw new Error('Run response missing timeline or result rows');
      if (requestId !== inspectRequestIdRef.current) return;
      setInspectRun({ ...result, ...normalized, timeline: normalized.timeline });
    } catch (err) {
      if (requestId !== inspectRequestIdRef.current) return;
      setInspectRun(null);
      setInspectError(err?.name === 'AbortError' ? `Run request timed out contacting ${API_URL}` : (err?.message || String(err)));
    } finally {
      if (timeoutId != null) clearTimeout(timeoutId);
      if (requestId === inspectRequestIdRef.current) {
        inspectControllerRef.current = null;
        setInspectRunning(false);
      }
    }
  }, [API_URL, inspectRunIndex, mcResults]);

  // The inspector is deliberately opt-in. Selecting a tab never starts a
  // network request; use the Load Run button after choosing an index.

  const totalRuns = Math.max(0, Number(mcResults?.numRuns || mcResults?.request?.num_runs || 0));
  const maxRunIndex = Math.max(0, totalRuns - 1);

  const filteredRunIndexes = useMemo(() => {
    const matchesFilter = (success) => {
      if (runFilter === 'all') return true;
      if (runFilter === 'success') return success === true;
      if (runFilter === 'failure') return success === false;
      return true;
    };

    const outcomes = Array.isArray(mcResults?.runOutcomes) ? mcResults.runOutcomes : [];
    if (!outcomes.length) {
      return runFilter === 'all'
        ? Array.from({ length: totalRuns }, (_, i) => i)
        : [];
    }

    return outcomes
      .map((success, index) => (matchesFilter(success) ? index : null))
      .filter((idx) => idx !== null);
  }, [totalRuns, mcResults?.runOutcomes, runFilter]);

  const currentFilteredPosition = filteredRunIndexes.indexOf(inspectRunIndex);

  const goToAdjacentFilteredRun = useCallback((direction) => {
    if (!filteredRunIndexes.length) return;
    let nextPos = currentFilteredPosition;
    if (nextPos === -1) {
      nextPos = direction > 0 ? 0 : filteredRunIndexes.length - 1;
    } else {
      nextPos = Math.max(0, Math.min(filteredRunIndexes.length - 1, nextPos + direction));
    }
    setInspectRunIndex(filteredRunIndexes[nextPos]);
  }, [filteredRunIndexes, currentFilteredPosition]);

  useEffect(() => {
    if (runFilter === 'all') return;
    if (!filteredRunIndexes.length) return;
    setInspectRunIndex(filteredRunIndexes[0]);
  }, [runFilter, filteredRunIndexes]);

  const handleRunIndexChange = useCallback((value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const maxIndex = Math.max(0, totalRuns - 1);
    const sanitized = Math.max(0, Math.min(maxIndex, Math.round(parsed)));

    if (runFilter === 'all' || !filteredRunIndexes.length) {
      setInspectRunIndex(sanitized);
      return;
    }

    if (filteredRunIndexes.includes(sanitized)) {
      setInspectRunIndex(sanitized);
      return;
    }

    const direction = sanitized > inspectRunIndex ? 1 : (sanitized < inspectRunIndex ? -1 : 0);
    if (direction === 0) return;

    if (direction > 0) {
      const next = filteredRunIndexes.find(index => index > inspectRunIndex);
      if (next !== undefined) {
        setInspectRunIndex(next);
      }
      return;
    }

    for (let i = filteredRunIndexes.length - 1; i >= 0; i -= 1) {
      if (filteredRunIndexes[i] < inspectRunIndex) {
        setInspectRunIndex(filteredRunIndexes[i]);
        break;
      }
    }
  }, [filteredRunIndexes, inspectRunIndex, runFilter, totalRuns]);

  const inspectNetWorthChangeSeries = useMemo(() => {
    const tl = inspectRun?.timeline;
    if (!Array.isArray(tl)) return [];

    let prev = null;
    return tl.map((row) => {
      const curr = Number(row?.nominal_net_worth) || 0;
      const delta = prev == null ? 0 : (curr - prev);
      prev = curr;
      return {
        age: row?.age,
        year: row?.year,
        net_worth_change: Math.round(delta),
      };
    });
  }, [inspectRun]);

  const inspectStockReturnAvg = useMemo(() => {
    const series = inspectRun?.stockReturnSeries;
    if (!Array.isArray(series) || series.length === 0) return null;
    let sum = 0;
    let n = 0;
    for (const row of series) {
      const v = Number(row?.stock_return);
      if (Number.isFinite(v)) {
        sum += v;
        n += 1;
      }
    }
    if (n === 0) return null;
    return sum / n;
  }, [inspectRun]);

  const updateAsset = (index, field, value) => {
    setAssets(prev => prev.map((a, i) => i === index ? { ...a, [field]: value } : a));
  };

  const addAsset = () => {
    setAssets(prev => [...prev, { id: `account_${Date.now()}`, name: "New Asset", value: 0, growth_rate: stockGrowth, tax_treatment: "taxable" }]);
  };

  const addProperty = () => {
    setAssets(prev => [...prev, {
      id: `property_${Date.now()}`,
      name: 'New Property',
      value: 0,
      growth_rate: inflation,
      tax_treatment: 'real_estate',
      property_role: 'rental',
      ownership_pct: 100,
      annual_revenue: 0,
      annual_operating_expenses: 0,
      mortgage_balance: 0,
      mortgage_interest_rate: 0,
      mortgage_monthly_payment: 0,
      mortgage_payments_remaining: 0,
    }]);
  };

  const removeAsset = (index) => {
    setAssets(prev => prev.filter((_, i) => i !== index));
  };

  const estimatedMortgagePayment = (asset) => {
    const configured = Math.max(0, asNumber(asset?.mortgage_monthly_payment, 0));
    if (configured > 0) return configured;
    const balance = Math.max(0, asNumber(asset?.mortgage_balance, 0));
    const months = Math.max(0, Math.trunc(asNumber(asset?.mortgage_payments_remaining, 0)));
    if (balance <= 0 || months <= 0) return 0;
    const monthlyRate = Math.max(0, asNumber(asset?.mortgage_interest_rate, 0)) / 1200;
    if (monthlyRate === 0) return balance / months;
    return balance * monthlyRate / (1 - (1 + monthlyRate) ** -months);
  };

  const addOtherAsset = () => {
    setOtherAssets(prev => [...prev, { id: `event_asset_${Date.now()}`, name: 'New asset event', value: 0, add_year: currentYear + 1 }]);
  };

  const removeOtherAsset = (index) => {
    setOtherAssets(prev => prev.filter((_, i) => i !== index));
  };

  const updateInflow = (index, field, value) => {
    setInflows(prev => prev.map((i, idx) => idx === index ? { ...i, [field]: value } : i));
  };

  const addInflow = () => {
    setInflows(prev => [...prev, { id: `income_${Date.now()}`, name: "New Income", amount: 0, start_year: currentYear, end_year: currentYear + 65, growth_rate: 3.0, income_type: "other" }]);
  };

  const removeInflow = (index) => {
    setInflows(prev => prev.filter((_, i) => i !== index));
  };

  const moveWithdrawalCategory = (index, direction) => {
    setWithdrawalOrder(previous => {
      const target = index + direction;
      if (target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
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
    setOutflows(prev => [...prev, { id: `expense_${Date.now()}`, name: "New Expense", amount: 0, start_year: currentYear, end_year: currentYear + 65, growth_rate: inflation, growth_mode: 'global', discretionary: true }]);
  };

  const removeOutflow = (index) => {
    setOutflows(prev => prev.filter((_, i) => i !== index));
  };

  const addOneTimeExpense = () => {
    setOneTimeExpenses(prev => [...prev, { id: `event_expense_${Date.now()}`, name: 'New one-time expense', amount: 0, year: currentYear + 1, add_to_primary_home: false }]);
  };

  const removeOneTimeExpense = (index) => {
    setOneTimeExpenses(prev => prev.filter((_, i) => i !== index));
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
    // Randomize individual asset growth rates ±20%
    setAssets(prev => prev.map(a => ({
      ...a,
      growth_rate: a.tax_treatment === 'real_estate' ? a.growth_rate : Math.round(a.growth_rate * randomizeFactor(0.2) * 10) / 10
    })));
    // Randomize income growth rates ±20%
    setInflows(prev => prev.map(i => ({
      ...i,
      growth_rate: i.growth_mode === 'global' || i.growth_rate == null
        ? i.growth_rate
        : Math.round(i.growth_rate * randomizeFactor(0.2) * 10) / 10
    })));
  };

  const planSnapshot = useMemo(() => ({
    version: PLAN_VERSION,
    saved_at: new Date().toISOString(),
    mode,
    seed,
    current_year: currentYear,
    current_age: currentAge,
    retire_age: retireAge,
    retirement_withdrawal_age: retirementWithdrawalAge,
    plan_through_age: planThroughAge,
    inflation,
    stock_growth: stockGrowth,
    tax_filing_status: taxFilingStatus,
    tax_version: taxVersion,
    rmd_start_age: rmdStartAge,
    historical_wrap_mode: historicalWrapMode,
    dividend_yield_pct: dividendYieldPct,
    sale_haircut_pct: saleHaircutPct,
    workplace_contribution_limit: workplaceContributionLimit,
    employer_match_rate_pct: employerMatchRatePct,
    withdrawal_order: [...withdrawalOrder],
    adaptive_spending_enabled: adaptiveSpendingEnabled,
    assets: clone(assets),
    inflows: clone(inflows),
    outflows: clone(outflows),
    other_assets: clone(otherAssets),
    one_time_expenses: clone(oneTimeExpenses),
    mc_settings: clone(mcSettings),
    spending_rules: clone(spendingRules),
  }), [adaptiveSpendingEnabled, assets, currentAge, currentYear, dividendYieldPct, employerMatchRatePct, historicalWrapMode, inflation, inflows, mcSettings, mode, oneTimeExpenses, otherAssets, outflows, planThroughAge, retireAge, retirementWithdrawalAge, rmdStartAge, saleHaircutPct, seed, spendingRules, stockGrowth, taxFilingStatus, taxVersion, withdrawalOrder, workplaceContributionLimit]);

  const savePlan = useCallback(() => {
    const validationErrors = validateDraft({
      currentYear: planSnapshot.current_year,
      currentAge: planSnapshot.current_age,
      retireAge: planSnapshot.retire_age,
      retirementWithdrawalAge: planSnapshot.retirement_withdrawal_age,
      planThroughAge: planSnapshot.plan_through_age,
      inflation: planSnapshot.inflation,
      dividendYieldPct: planSnapshot.dividend_yield_pct,
      saleHaircutPct: planSnapshot.sale_haircut_pct,
      workplaceContributionLimit: planSnapshot.workplace_contribution_limit,
      employerMatchRatePct: planSnapshot.employer_match_rate_pct,
      assets: planSnapshot.assets,
      inflows: planSnapshot.inflows,
      outflows: planSnapshot.outflows,
      otherAssets: planSnapshot.other_assets,
      oneTimeExpenses: planSnapshot.one_time_expenses,
      withdrawalOrder: planSnapshot.withdrawal_order,
      mode: planSnapshot.mode,
      mcSettings: planSnapshot.mc_settings,
      spendingRules: planSnapshot.spending_rules,
    });
    if (validationErrors.length > 0) {
      setDraftErrors(validationErrors);
      setPlanMessage('Fix the highlighted inputs before saving.');
      return;
    }
    try {
      window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(planSnapshot));
      setDraftErrors([]);
      setPlanMessage(`Plan saved for ${planSnapshot.current_year}.`);
    } catch {
      setPlanMessage('Plan could not be saved in this browser.');
    }
  }, [planSnapshot]);

  const loadPlan = useCallback(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(PLAN_STORAGE_KEY) || 'null');
      if (!parsed || parsed.version !== PLAN_VERSION) {
        setPlanMessage('No compatible saved plan was found.');
        return;
      }
      const validationErrors = validateDraft({
        currentYear: parsed.current_year,
        currentAge: parsed.current_age,
        retireAge: parsed.retire_age,
        retirementWithdrawalAge: parsed.retirement_withdrawal_age,
        planThroughAge: parsed.plan_through_age,
        inflation: parsed.inflation,
        dividendYieldPct: parsed.dividend_yield_pct,
        saleHaircutPct: parsed.sale_haircut_pct,
        workplaceContributionLimit: parsed.workplace_contribution_limit,
        employerMatchRatePct: parsed.employer_match_rate_pct,
        assets: parsed.assets,
        inflows: parsed.inflows,
        outflows: parsed.outflows,
        otherAssets: parsed.other_assets,
        oneTimeExpenses: parsed.one_time_expenses,
        withdrawalOrder: parsed.withdrawal_order,
        mode: parsed.mode,
        mcSettings: parsed.mc_settings,
        spendingRules: parsed.spending_rules,
      });
      if (validationErrors.length > 0) {
        setDraftErrors(validationErrors);
        setPlanMessage('The saved plan has invalid inputs and was not loaded.');
        return;
      }
      invalidatePendingRequests();
      setRunState(previous => ({
        ...previous,
        status: previous.status === 'running' ? (data ? 'stale' : 'idle') : previous.status,
        mode: parsed.mode === 'historical' || parsed.mode === 'custom' ? parsed.mode : previous.mode,
      }));
      if (parsed.mode === 'custom' || parsed.mode === 'historical') {
        setMode(parsed.mode);
      }
      setMcResults(null);
      inspectRequestIdRef.current += 1;
      inspectControllerRef.current?.abort();
      inspectControllerRef.current = null;
      setInspectRun(null);
      setInspectRunning(false);
      setInspectError(null);
      if (Number.isFinite(Number(parsed.seed))) setSeed(Math.trunc(Number(parsed.seed)));
      if (Number.isFinite(Number(parsed.current_year))) setCurrentYear(Math.trunc(Number(parsed.current_year)));
      if (Number.isFinite(Number(parsed.current_age))) setCurrentAge(Math.trunc(Number(parsed.current_age)));
      if (Number.isFinite(Number(parsed.retire_age))) setRetireAge(Math.trunc(Number(parsed.retire_age)));
      if (Number.isFinite(Number(parsed.retirement_withdrawal_age))) setRetirementWithdrawalAge(Math.trunc(Number(parsed.retirement_withdrawal_age)));
      if (Number.isFinite(Number(parsed.plan_through_age))) setPlanThroughAge(Math.trunc(Number(parsed.plan_through_age)));
      if (Number.isFinite(Number(parsed.inflation))) setInflation(Number(parsed.inflation));
      if (Number.isFinite(Number(parsed.stock_growth))) setStockGrowth(Number(parsed.stock_growth));
      if (parsed.tax_filing_status === 'single' || parsed.tax_filing_status === 'married_joint') setTaxFilingStatus(parsed.tax_filing_status);
      if (parsed.tax_version === DEFAULT_TAX_VERSION) setTaxVersion(parsed.tax_version);
      if (Number(parsed.rmd_start_age) === 73 || Number(parsed.rmd_start_age) === 75) setRmdStartAge(Number(parsed.rmd_start_age));
      if (parsed.historical_wrap_mode === 'continue' || parsed.historical_wrap_mode === 'error') setHistoricalWrapMode(parsed.historical_wrap_mode);
      if (Number.isFinite(Number(parsed.dividend_yield_pct))) setDividendYieldPct(Number(parsed.dividend_yield_pct));
      if (Number.isFinite(Number(parsed.sale_haircut_pct))) setSaleHaircutPct(Number(parsed.sale_haircut_pct));
      if (Number.isFinite(Number(parsed.workplace_contribution_limit))) setWorkplaceContributionLimit(Number(parsed.workplace_contribution_limit));
      if (Number.isFinite(Number(parsed.employer_match_rate_pct))) setEmployerMatchRatePct(Number(parsed.employer_match_rate_pct));
      if (Array.isArray(parsed.withdrawal_order) && parsed.withdrawal_order.length === DEFAULT_WITHDRAWAL_ORDER.length && new Set(parsed.withdrawal_order).size === DEFAULT_WITHDRAWAL_ORDER.length && parsed.withdrawal_order.every(item => DEFAULT_WITHDRAWAL_ORDER.includes(item))) setWithdrawalOrder([...parsed.withdrawal_order]);
      if (typeof parsed.adaptive_spending_enabled === 'boolean') setAdaptiveSpendingEnabled(parsed.adaptive_spending_enabled);
      if (Array.isArray(parsed.assets)) setAssets(clone(parsed.assets));
      if (Array.isArray(parsed.inflows)) setInflows(clone(parsed.inflows));
      if (Array.isArray(parsed.outflows)) setOutflows(clone(parsed.outflows));
      if (Array.isArray(parsed.other_assets)) setOtherAssets(clone(parsed.other_assets));
      if (Array.isArray(parsed.one_time_expenses)) setOneTimeExpenses(clone(parsed.one_time_expenses));
      if (parsed.mc_settings && typeof parsed.mc_settings === 'object') setMcSettings(previous => ({ ...previous, ...parsed.mc_settings }));
      if (Array.isArray(parsed.spending_rules)) setSpendingRules(clone(parsed.spending_rules));
      setDraftErrors([]);
      // Keep an existing result visible as an immutable snapshot, but mark it
      // stale so it cannot be mistaken for the newly loaded inputs.
      setResultSignature(data ? '__stale_after_load__' : null);
      if (data) setRunState(previous => ({ ...previous, status: 'stale' }));
      setPlanMessage(`Plan loaded from ${parsed.saved_at ? new Date(parsed.saved_at).toLocaleString() : 'saved storage'}.`);
    } catch {
      setPlanMessage('The saved plan is unreadable or was created by an older version.');
    }
  }, [data, invalidatePendingRequests]);

  const exportCurrentCsv = useCallback(() => {
    const exportMode = resultSnapshot?.mode || mode;
    const exportYear = resultSnapshot?.currentYear || currentYear;
    if (!downloadCsv(data, `retirement-${exportMode}-${exportYear}.csv`)) {
      setPlanMessage('Run a scenario before exporting year-by-year data.');
      return;
    }
    setPlanMessage('CSV export started.');
  }, [currentYear, data, mode, resultSnapshot]);

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

const RUN_FILTER_OPTIONS = [
  { value: 'all', label: 'All runs' },
  { value: 'success', label: 'Success only' },
  { value: 'failure', label: 'Failures only' },
];
  const inputClass = "w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none";
  const labelClass = "text-xs font-bold text-slate-500 uppercase block mb-1";
  const cardClass = "bg-slate-800 p-4 rounded-xl border border-slate-700";

  // Format value with k/M suffix (no decimals for Y-axis)
  const formatValue = (val) => {
    if (val >= 1000000) {
      return `$${(val/1000000).toFixed(0)}M`;
    }
    return `$${(val/1000).toFixed(0)}k`;
  };

  // Format value with k/M suffix (2 decimals for tooltip)
  const formatValueDetailed = (val) => {
    if (val === undefined || val === null) return '—';
    const n = Number(val);
    if (!Number.isFinite(n)) return '—';
    if (n >= 1000000) {
      return `$${(n/1000000).toFixed(2)}M`;
    }
    return `$${(n/1000).toFixed(0)}k`;
  };

  // Custom tooltip that shows both year and age
  const CustomTooltip = ({ active, payload, label, variant }) => {
    if (active && payload && payload.length) {
      const age = label;
      const d = payload[0]?.payload;
      const year = d?.year ?? ((resultSnapshot?.currentYear ?? currentYear) + (age - (resultSnapshot?.currentAge ?? currentAge)));
      return (
        <div className="bg-slate-900 p-3 rounded border border-slate-700 shadow-lg">
          <p className="text-slate-300 font-semibold mb-2">{`Age ${age} (${year})`}</p>

          {variant === 'netWorth' && (
            <p className="text-sm text-slate-200">
              {`Total Nominal Net Worth: ${formatValueDetailed(d?.nominal_net_worth)}`}
            </p>
          )}
          {variant === 'expenses' && (
            <p className="text-sm text-slate-200">
              {`Total Nominal Expenses: ${formatValueDetailed(d?.total_expenses)}`}
            </p>
          )}

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

  const RunInspectorMoneyTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const d = payload[0]?.payload;
      return (
        <div className="bg-slate-900 p-3 rounded border border-slate-700 shadow-lg">
          <p className="text-slate-300 font-semibold mb-2">{`Age ${d?.age} (${d?.year})`}</p>
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

  const RunInspectorStockTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const d = payload[0]?.payload;
      const v = Number(payload[0]?.value);
      return (
        <div className="bg-slate-900 p-3 rounded border border-slate-700 shadow-lg">
          <p className="text-slate-300 font-semibold mb-2">{`Age ${d?.age} (${d?.year})`}</p>
          <p className="text-sm text-slate-200">{`Stock Return: ${Number.isFinite(v) ? fmtPctSigned(v) : '—'}`}</p>
        </div>
      );
    }
    return null;
  };

  const ExpensesByYearTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const d = payload[0]?.payload;
      const year = Number(d?.year);
      const age = Number.isFinite(Number(d?.age)) ? Number(d?.age) : Number(label);

      return (
        <div className="bg-slate-900 p-3 rounded border border-slate-700 shadow-lg">
          <p className="text-slate-300 font-semibold mb-2">{`Year ${year} (Age ${age})`}</p>
          <p className="text-sm text-slate-200">
            {`Total Nominal Expenses + Taxes: ${formatValueDetailed(d?.total_expenses)}`}
          </p>
          {payload
            .filter(e => e?.value && Number(e.value) !== 0)
            .map((entry, index) => (
              <p key={index} style={{ color: entry.color }} className="text-sm">
                {`${entry.name}: ${formatValueDetailed(entry.value)}`}
              </p>
            ))}
        </div>
      );
    }
    return null;
  };

  const EXPENSE_STACK_COLORS = [
    '#ef4444', // red
    '#f59e0b', // amber
    '#10b981', // emerald
    '#3b82f6', // blue
    '#8b5cf6', // purple
    '#f97316', // orange
    '#06b6d4', // cyan
    '#9ca3af', // gray
    '#ec4899', // pink
    '#facc15', // yellow
  ];

  const displayOutflows = resultSnapshot?.outflows || outflows;
  const displayOneTimeExpenses = resultSnapshot?.oneTimeExpenses || oneTimeExpenses;
  const displayCurrentYear = resultSnapshot?.currentYear ?? currentYear;
  const displayInflation = resultSnapshot?.inflation ?? inflation;
  const displayRetireAge = resultSnapshot?.retireAge ?? retireAge;
  const displayPlanThroughAge = resultSnapshot?.planThroughAge ?? planThroughAge;

  // Expenses-by-Year chart palettes
  // Reuse the same set of colors above (no new colors).
  const expenseSeries = useMemo(() => {
    const used = new Set();
    const baseKey = (name) => {
      const s = String(name ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      return s || 'expense';
    };
    const uniqueKey = (k) => {
      let key = k;
      let i = 2;
      while (used.has(key)) {
        key = `${k}_${i}`;
        i += 1;
      }
      used.add(key);
      return key;
    };

    const series = displayOutflows.map((o, idx) => ({
      kind: 'outflow',
      key: uniqueKey(baseKey(o?.name) || `expense_${idx + 1}`),
      name: o?.name || `Expense ${idx + 1}`,
      fill: COOL_EXPENSE_COLORS[idx % COOL_EXPENSE_COLORS.length],
      outflow: o,
    }));

    series.push({
      kind: 'propertyOperations',
      key: uniqueKey('property_operations'),
      name: 'Net Property Operations',
      fill: COOL_EXPENSE_COLORS[series.length % COOL_EXPENSE_COLORS.length],
    });

    series.push({
      kind: 'mortgage',
      key: uniqueKey('mortgage_principal_and_interest'),
      name: 'Mortgage P&I',
      fill: COOL_EXPENSE_COLORS[series.length % COOL_EXPENSE_COLORS.length],
    });

    const includeOneTime = displayOneTimeExpenses?.some(e => Number(e?.amount) > 0);
    if (includeOneTime) {
      series.push({
        kind: 'oneTime',
        key: uniqueKey('one_time_expenses'),
        name: 'One-Time Expenses',
        fill: COOL_EXPENSE_COLORS[series.length % COOL_EXPENSE_COLORS.length],
      });
    }

    // Taxes (from backend timeline fields)
    const taxDefs = [
      { key: 'tax_retirement', name: 'Tax: 401k / Pre-Tax Withdrawals' },
      { key: 'tax_brokerage', name: 'Tax: Brokerage Sales' },
      { key: 'tax_bitcoin', name: 'Tax: Bitcoin Sales' },
      { key: 'tax_w2', name: 'Tax: W2' },
      { key: 'tax_rental', name: 'Tax: Rental Income' },
      { key: 'tax_royalty', name: 'Tax: Royalties' },
      { key: 'tax_dividend', name: 'Tax: Dividends' },
      { key: 'tax_social_security', name: 'Tax: Social Security' },
      { key: 'tax_other', name: 'Tax: Other Income' },
    ];

    for (let i = 0; i < taxDefs.length; i += 1) {
      const td = taxDefs[i];
      series.push({
        kind: 'tax',
        key: uniqueKey(td.key),
        name: td.name,
        taxKey: td.key,
        fill: WARM_TAX_COLORS[i % WARM_TAX_COLORS.length],
      });
    }

    return series;
  }, [displayOutflows, displayOneTimeExpenses]);

  const inspectExpenseSeries = useMemo(() => {
    return [
      {
        key: 'expense_net',
        name: 'Expenses (net of taxes)',
        fill: COOL_EXPENSE_COLORS[0],
      },
      { key: 'tax_retirement', name: 'Tax: 401k / Pre-Tax Withdrawals', fill: WARM_TAX_COLORS[0] },
      { key: 'tax_brokerage', name: 'Tax: Brokerage Sales', fill: WARM_TAX_COLORS[1] },
      { key: 'tax_bitcoin', name: 'Tax: Bitcoin Sales', fill: WARM_TAX_COLORS[2] },
      { key: 'tax_w2', name: 'Tax: W2', fill: WARM_TAX_COLORS[3] },
      { key: 'tax_rental', name: 'Tax: Rental Income', fill: WARM_TAX_COLORS[4] },
      { key: 'tax_royalty', name: 'Tax: Royalties', fill: '#d946ef' },
      { key: 'tax_dividend', name: 'Tax: Dividends', fill: '#fbbf24' },
      { key: 'tax_social_security', name: 'Tax: Social Security', fill: '#14b8a6' },
      { key: 'tax_other', name: 'Tax: Other Income', fill: '#94a3af' },
    ];
  }, []);

  const expensesByYearData = useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    const baseYear = displayCurrentYear;

    return data.map((pt) => {
      const year = Number(pt?.year);
      const yearsPassed = year - baseYear;
      const row = { year, age: pt?.age };
      let total = 0;

      for (const s of expenseSeries) {
        let v = 0;
        if (s.kind === 'outflow') {
          const o = s.outflow;
          const start = Number(o?.start_year);
          const end = Number(o?.end_year);
          if (Number.isFinite(year) && year >= start && year <= end) {
            const ratePct = o?.growth_mode === 'global' ? displayInflation : (o?.growth_rate ?? displayInflation);
            const r = Number(ratePct) / 100;
            v = Number(o?.amount) * Math.pow(1 + r, yearsPassed);
          }
        } else if (s.kind === 'oneTime') {
          v = (displayOneTimeExpenses || [])
            .filter(e => Number(e?.year) === year)
            .reduce((sum, e) => sum + Number(e?.amount || 0), 0);
        } else if (s.kind === 'propertyOperations') {
          v = Number(pt?.property_operating_shortfall) || 0;
        } else if (s.kind === 'mortgage') {
          v = Number(pt?.mortgage_payment_total) || 0;
        } else if (s.kind === 'tax') {
          v = Number(pt?.[s.taxKey]) || 0;
        }

        const rounded = Number.isFinite(v) ? Math.round(v) : 0;
        row[s.key] = rounded;
        total += rounded;
      }

      row.total_expenses = Math.round(total);
      return row;
    });
  }, [data, displayCurrentYear, displayInflation, displayOneTimeExpenses, expenseSeries]);

  const inspectExpensesByYearData = useMemo(() => {
    const tl = inspectRun?.timeline;
    if (!Array.isArray(tl)) return [];

    return tl.map((row) => {
      const totalExpenses = Number(row?.total_expenses) || 0;
      const taxTotal = Number(row?.tax_total) || 0;
      const net = Math.max(0, totalExpenses - taxTotal);
      const mapped = {
        year: Number(row?.year),
        age: row?.age,
        total_expenses: Math.round(totalExpenses),
        expense_net: Math.round(net),
      };

      inspectExpenseSeries.forEach((s) => {
        if (s.key === 'expense_net') return;
        mapped[s.key] = Math.round(Number(row?.[s.key]) || 0);
      });

      return mapped;
    });
  }, [inspectRun?.timeline, inspectExpenseSeries]);

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
    const { x, width, payload, yAxisScale } = props;
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
    
    const ageSpan = Math.max(1, maxAge - minAge);
    const valueSpan = Math.max(1e-9, (maxY + yPadding) - (minY - yPadding));
    const xScale = (age) => margin.left + ((age - minAge) / ageSpan) * plotWidth;
    const yScale = (val) => margin.top + plotHeight - ((val - (minY - yPadding)) / valueSpan) * plotHeight;
    
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
          {data.map((d) => {
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

  const propertyEntries = assets.map((asset, index) => ({ asset, index })).filter(({ asset }) => asset.tax_treatment === 'real_estate');
  const financialAssetEntries = assets.map((asset, index) => ({ asset, index })).filter(({ asset }) => asset.tax_treatment !== 'real_estate');
  const totalHousingEquity = propertyEntries.reduce((sum, { asset }) => (
    sum + asNumber(asset.value, 0) * (asNumber(asset.ownership_pct, 100) / 100) - asNumber(asset.mortgage_balance, 0)
  ), 0);
  const totalFinancialAssets = financialAssetEntries.reduce((sum, { asset }) => sum + asNumber(asset.value, 0), 0);
  const totalAssets = totalFinancialAssets + totalHousingEquity;
  const totalIncome = inflows.filter(i => i.start_year <= currentYear && i.end_year >= currentYear).reduce((sum, i) => sum + i.amount, 0);
  const totalExpenses = outflows.filter(o => o.start_year <= currentYear && o.end_year >= currentYear).reduce((sum, o) => sum + o.amount, 0);
  const warningsForDisplay = useMemo(() => {
    const warnings = [...resultWarnings];
    const addDraftWarning = (warning) => {
      if (!warnings.some(existing => existing.code === warning.code && existing.path === warning.path)) warnings.push(warning);
    };
    const draftCollections = [
      ['assets', assets],
      ['inflows', inflows],
      ['outflows', outflows],
      ['other_assets', otherAssets],
      ['one_time_expenses', oneTimeExpenses],
      ['spending_rules', spendingRules],
    ];
    for (const [path, items] of draftCollections) {
      const seen = new Set();
      for (const item of items) {
        const label = normalizedLabel(item?.name);
        if (label && seen.has(label)) {
          addDraftWarning({ code: 'DUPLICATE_NAME', path, message: `${path} has duplicate display names. Rename one before running.`, severity: 'error' });
          break;
        }
        if (label) seen.add(label);
      }
    }
    const seenIds = new Set();
    let duplicateId = false;
    for (const [, items] of draftCollections) {
      for (const item of items) {
        const id = normalizedLabel(item?.id);
        if (id && seenIds.has(id)) duplicateId = true;
        if (id) seenIds.add(id);
      }
    }
    if (duplicateId) addDraftWarning({ code: 'DUPLICATE_ID', path: 'plan', message: 'Two items share an internal ID. Rename or recreate the duplicate before running.', severity: 'error' });
    const hasSalary = inflows.some(isW2Stream);
    const hasPreTax = assets.some(item => ['pre_tax', 'pretax', 'traditional', 'traditional_ira', 'tax_deferred', '401k'].includes(String(item?.tax_treatment || '').toLowerCase()));
    if (hasSalary && !hasPreTax) warnings.push({ code: 'CONTRIBUTION_ROUTING', message: 'There is no pre-tax account, so workplace contributions and the employer match are routed to the first taxable or Roth account (or cash reserve).', severity: 'medium' });
    const unscheduledMortgage = assets.find(item => item?.tax_treatment === 'real_estate' && asNumber(item?.mortgage_balance, 0) > 0 && asNumber(item?.mortgage_payments_remaining, 0) <= 0);
    if (unscheduledMortgage) addDraftWarning({ code: 'MORTGAGE_UNSCHEDULED', path: 'assets', message: `${unscheduledMortgage.name || 'A property'} has mortgage debt but no remaining payments. The debt stays on the property and is paid off only if the property is sold.`, severity: 'medium' });
    const hasPerPropertyRevenue = assets.some(item => item?.tax_treatment === 'real_estate' && asNumber(item?.annual_revenue, 0) > 0);
    const hasLegacyRentalIncome = inflows.some(item => item?.income_type === 'rental');
    if (hasPerPropertyRevenue && hasLegacyRentalIncome) addDraftWarning({ code: 'DUPLICATE_RENTAL_INCOME', path: 'inflows', message: 'A separate rental-income stream is active in addition to per-house revenue. Remove it if it describes the same rent.', severity: 'medium' });
    if (Number.isFinite(Number(inflation)) && (Number(inflation) < 0 || Number(inflation) > 10)) addDraftWarning({ code: 'UNUSUAL_INFLATION', path: 'general_inflation', message: 'Inflation is outside the usual planning range. Keep it if intentional.', severity: 'info' });
    if (Number.isFinite(Number(stockGrowth)) && (Number(stockGrowth) < -5 || Number(stockGrowth) > 15)) addDraftWarning({ code: 'UNUSUAL_STOCK_GROWTH', path: 'stock_growth', message: 'Stock growth is outside the usual planning range. Keep it if intentional.', severity: 'info' });
    if (Number.isFinite(Number(saleHaircutPct)) && Number(saleHaircutPct) > 25) addDraftWarning({ code: 'HIGH_SALE_HAIRCUT', path: 'sale_haircut', message: 'The sale haircut is high and will materially reduce money available from sales.', severity: 'info' });
    if (mode === 'historical' && Number.isFinite(Number(mcSettings.numRuns)) && Number(mcSettings.numRuns) < 50) addDraftWarning({ code: 'SMALL_SIMULATION_SET', path: 'monte_carlo.num_runs', message: 'Fewer than 50 simulations can make the success rate noisy.', severity: 'info' });
    if (mode === 'custom') warnings.push({ code: 'DETERMINISTIC', message: 'Custom Scenario uses the configured return assumptions as a single path; it is not a probability of success.', severity: 'info' });
    if (mode === 'historical') warnings.push({ code: 'HISTORICAL_SEQUENCE', message: 'Historical Monte Carlo walks seeded contiguous annual price returns; results are illustrative and sensitive to the seed and assumptions.', severity: 'info' });
    if (resultIsStale) warnings.push({ code: 'STALE_RESULT', message: 'Inputs changed after the displayed result was submitted. Run again to refresh this snapshot.', severity: 'medium' });
    return warnings;
  }, [assets, inflation, inflows, mcSettings.numRuns, mode, oneTimeExpenses, otherAssets, outflows, resultIsStale, resultWarnings, saleHaircutPct, spendingRules, stockGrowth]);

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div>
        {/* Header */}
        <div className="bg-slate-800 border-b border-slate-700 px-6 py-4">
          <div className="max-w-7xl mx-auto flex flex-wrap gap-4 justify-between items-center">
            <div>
              <h1 className="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-500">Holmes Retirement Engine</h1>
              <p className="mt-0.5 text-xs text-slate-500">Plan clearly. Stress test deliberately.</p>
            </div>
            <div className="header-actions">
              <div className="mode-toggle" role="group" aria-label="Analysis mode">
                <button
                  type="button"
                  aria-pressed={mode === 'custom'}
                  className={mode === 'custom' ? 'mode-option active' : 'mode-option'}
                  onClick={() => changeMode('custom')}
                  data-testid="mode-custom"
                >Custom Scenario</button>
                <button
                  type="button"
                  aria-pressed={mode === 'historical'}
                  className={mode === 'historical' ? 'mode-option active' : 'mode-option'}
                  onClick={() => changeMode('historical')}
                  data-testid="mode-historical"
                >Historical Monte Carlo</button>
              </div>
              <button 
                onClick={() => runScenario(mode)}
                disabled={runState.status === 'running'}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${runState.status === 'running' ? 'bg-slate-600 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500'}`}
                data-testid="run-scenario"
              >
                <BarChart3 size={16}/>
                {runState.status === 'running' ? 'Running…' : `Run ${mode === 'historical' ? 'Historical Monte Carlo' : 'Custom Scenario'}`}
              </button>
              <button type="button" onClick={savePlan} className="toolbar-button" data-testid="save-plan">Save plan</button>
              <button type="button" onClick={loadPlan} className="toolbar-button" data-testid="load-plan">Load plan</button>
              <button type="button" onClick={exportCurrentCsv} disabled={!data} className="toolbar-button" data-testid="export-csv">Export CSV</button>
              <details className="stress-menu">
                <summary className="toolbar-button">Stress test</summary>
                <div className="stress-menu-panel">
                  <button onClick={randomizeValues} className="stress-action" type="button">Vary balances ±50%</button>
                  <button onClick={randomizeRates} className="stress-action" type="button">Vary rates ±20%</button>
                </div>
              </details>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-6 pt-4" aria-live="polite">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className={`run-status status-${runState.status}`} data-testid="run-status">
              {runState.status === 'running' ? 'Running the submitted snapshot…' : runState.status === 'invalid' ? 'Fix the highlighted inputs before running.' : runState.status === 'error' ? 'Run failed; the last result is preserved.' : resultIsStale || runState.status === 'stale' ? 'Draft changed; result is stale until you run again.' : runState.status === 'success' ? 'Result is current for the submitted snapshot.' : 'No run yet. Review assumptions, then choose Run.'}
            </span>
            {planMessage ? <span className="text-slate-400" data-testid="plan-message">{planMessage}</span> : null}
            {runState.submittedAt ? <span className="text-slate-500">Submitted {new Date(runState.submittedAt).toLocaleTimeString()}</span> : null}
          </div>
          {simError ? <div className="mt-2 rounded-lg border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-200" role="alert">{simError}</div> : null}
          {draftErrors.length > 0 ? (
            <div className="mt-2 rounded-lg border border-amber-800 bg-amber-950/50 px-3 py-2 text-sm text-amber-100" role="alert" data-testid="draft-errors">
              <span className="font-semibold">Please review:</span>
              <ul className="mt-1 list-disc pl-5 space-y-0.5">
                {draftErrors.slice(0, 8).map((error, index) => <li key={`${error.path}-${index}`}>{error.message}</li>)}
                {draftErrors.length > 8 ? <li>and {draftErrors.length - 8} more.</li> : null}
              </ul>
            </div>
          ) : null}
        </div>

        {/* Monte Carlo Tab */}
        {mode === 'historical' && (
          <div className="w-full px-6 py-6">
            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Sliders size={24}/> Historical Monte Carlo Settings
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className={labelClass} htmlFor="mc-num-runs">Number of Simulations</label>
                  <input 
                    id="mc-num-runs"
                    type="number" 
                    value={mcSettings.numRuns} 
                    onChange={e => setMcSettings(prev => ({...prev, numRuns: Math.max(1, Number(e.target.value))}))}
                    className={inputClass}
                    min="1"
                    max={MAX_MONTE_CARLO_RUNS}
                  />
                  <p className="text-xs text-slate-500 mt-1">100–1,000 is usually plenty · max {MAX_MONTE_CARLO_RUNS.toLocaleString()}</p>
                </div>
                <div>
                  <label className={labelClass} htmlFor="mc-stock-volatility">Non-historical asset volatility</label>
                  <input
                    id="mc-stock-volatility"
                    type="number"
                    step="0.5"
                    value={mcSettings.stockVolatility}
                    onChange={e => setMcSettings(prev => ({...prev, stockVolatility: Number(e.target.value)}))}
                    className={inputClass}
                  />
                  <p className="text-xs text-slate-500 mt-1">Historical equity returns use the ordered source data. This setting only affects Bitcoin.</p>
                </div>
                <div>
                  <label className={labelClass} htmlFor="mc-inflation-volatility">Inflation Volatility (% Std Dev)</label>
                  <input 
                    id="mc-inflation-volatility"
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
                <div>
                  <label className={labelClass} htmlFor="simulation-seed">Seed</label>
                  <input
                    id="simulation-seed"
                    type="number"
                    value={seed}
                    onChange={e => setSeed(Math.trunc(asNumber(e.target.value)))}
                    className={inputClass}
                    aria-describedby="simulation-seed-help"
                  />
                  <p id="simulation-seed-help" className="text-xs text-slate-500 mt-1">Fixed seed makes a historical run reproducible and is saved with the plan.</p>
                </div>
                <div>
                  <label className={labelClass} htmlFor="historical-wrap-mode">Beyond source history</label>
                  <select id="historical-wrap-mode" value={historicalWrapMode} onChange={e => setHistoricalWrapMode(e.target.value)} className={inputClass}>
                    <option value="continue">Continue by wrapping</option>
                    <option value="error">Block at source end</option>
                  </select>
                  <p className="text-xs text-slate-500 mt-1">The result reports any continuation or block.</p>
                </div>
              </div>

              <div className="mt-4">
                <label className="flex items-start gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={adaptiveSpendingEnabled}
                    onChange={e => setAdaptiveSpendingEnabled(e.target.checked)}
                    className="mt-1 accent-emerald-500"
                  />
                  <span>
                    <span className="font-semibold">Enable adaptive spending</span>
                    <span className="block text-xs text-slate-500 mt-1">Discretionary reductions apply only when this is enabled; baseline results remain separate.</span>
                  </span>
                </label>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mt-4 mb-2">Layered spending rules</div>
                <div className="space-y-2">
                  {spendingRules.map((rule, index) => (
                    <div key={`spending-rule-${index}`} className="text-slate-300 text-sm flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-400">Rule {index + 1}</span>
                      <span>If stocks are down</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        value={rule.stockDownPct}
                        onChange={e => {
                          const entered = Number(e.target.value);
                          const clamped = Number.isFinite(entered) ? Math.max(0, Math.min(100, entered)) : 0;
                          updateSpendingRule(index, 'stockDownPct', clamped);
                        }}
                        className="w-16 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
                      />
                      <span>%, reduce spending</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        value={rule.reduceSpendingPct}
                        onChange={e => {
                          const entered = Number(e.target.value);
                          const clamped = Number.isFinite(entered) ? Math.max(0, Math.min(100, entered)) : 0;
                          updateSpendingRule(index, 'reduceSpendingPct', clamped);
                        }}
                        className="w-16 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
                      />
                      <span>% for</span>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        max="50"
                        value={rule.years}
                        onChange={e => {
                          const entered = Number(e.target.value);
                          const clamped = Number.isFinite(entered) ? Math.max(0, Math.round(Math.min(50, entered))) : 0;
                          updateSpendingRule(index, 'years', clamped);
                        }}
                        className="w-16 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
                      />
                      <span>years</span>
                    </div>
                  ))}
                </div>
              </div>
              
              {mcResults && (
                <div className="mt-6 pt-6 border-t border-slate-700">
                  <h3 className="text-lg font-semibold mb-3">Latest Results</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-900 p-3 rounded-lg">
                        <p className="text-slate-400 text-sm">Success Rate (funded through age {displayPlanThroughAge})</p>
                      <p className={`text-2xl font-bold ${mcResults.successRate >= 80 ? 'text-emerald-400' : mcResults.successRate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                        {mcResults.successRate.toFixed(1)}%
                      </p>
                      <p className="text-xs text-slate-500 mt-1">Baseline {Number(mcResults.baselineSuccessRate ?? mcResults.successRate).toFixed(1)}% · Adaptive {Number(mcResults.adaptiveSuccessRate ?? mcResults.successRate).toFixed(1)}%</p>
                    </div>
                    <div className="bg-slate-900 p-3 rounded-lg">
                      <p className="text-slate-400 text-sm">Simulations Completed</p>
                      <p className="text-2xl font-bold text-cyan-400">{mcResults.numRuns}</p>
                    </div>
                  </div>
                  {mcResults.metadata?.return_source?.source_first_year != null && (
                    <p className="text-xs text-slate-500 mt-3">
                      Source: S&amp;P 500 price returns {mcResults.metadata.return_source.source_first_year}–{mcResults.metadata.return_source.source_last_year}
                      {mcResults.metadata.return_source.wrapped ? ' · circular continuation used' : ''}
                    </p>
                  )}
                </div>
              )}

              {mcResults?.expensePercentileData?.length > 0 && (
                <div className="mt-6 bg-slate-900 p-4 rounded-xl border border-slate-700 h-[360px]">
                  <h3 className="text-lg font-semibold mb-2">Monte Carlo: Expenses by Year (Percentiles)</h3>
                  <ResponsiveContainer width="100%" height="90%" initialDimension={CHART_INITIAL_DIMENSION}>
                    <ComposedChart data={mcResults.expensePercentileData}>
                      <XAxis dataKey="age" stroke="#64748b" tick={{fontSize: 11}} />
                      <YAxis stroke="#64748b" tickFormatter={formatValue} tick={{fontSize: 11}} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }}
                        formatter={(value) => ['$' + Number(value).toLocaleString(), '']}
                        labelFormatter={(age) => `Age ${age}`}
                      />
                      <Legend wrapperStyle={{fontSize: 10}} />
                      <Area type="monotone" dataKey="p90" stackId="range" stroke="none" fill="#ef4444" fillOpacity={0.2} name="P90" />
                      <Area type="monotone" dataKey="p75" stackId="range2" stroke="none" fill="#f97316" fillOpacity={0.3} name="P75" />
                      <Area type="monotone" dataKey="p50" stackId="range3" stroke="none" fill="#eab308" fillOpacity={0.4} name="Median" />
                      <Line type="monotone" dataKey="mean" stroke="#10b981" strokeWidth={2} dot={false} name="Mean" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
              
              <button 
                onClick={runMonteCarlo}
                disabled={mcRunning || runState.status === 'running'}
                className={`mt-6 w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${mcRunning ? 'bg-slate-600 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500'}`}
                type="button"
                data-testid="run-monte-carlo"
              >
                <BarChart3 size={18}/>
                {mcRunning ? 'Running Historical Simulations…' : 'Run Historical Monte Carlo'}
              </button>
            </div>
            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 mt-6">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Activity size={24}/> Run Inspector
              </h2>

              <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className="text-xs uppercase tracking-wider text-slate-500">Filter runs</span>
                {RUN_FILTER_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    onClick={() => setRunFilter(option.value)}
                    className={`text-xs px-3 py-1 rounded-full border ${runFilter === option.value ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
                  >
                    {option.label}
                  </button>
                ))}
                {mcResults?.numRuns != null && (
                  <span className="text-xs text-slate-400 ml-auto">
                    Matches {filteredRunIndexes.length} / {mcResults.numRuns}
                  </span>
                )}
              </div>

              {runFilter !== 'all' && mcResults?.numRuns && filteredRunIndexes.length === 0 && (
                <div className="text-xs text-slate-400 mb-4">
                  No runs match this filter yet. Run Monte Carlo again or switch filters.
                </div>
              )}

              {!mcResults?.request && (
                <div className="bg-slate-900 p-4 rounded-lg border border-slate-700 text-slate-200">
                  Run Monte Carlo first, then come back here to inspect an individual run.
                </div>
              )}

              {mcResults?.request && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div>
                      <label className={labelClass}>Run Index</label>
                      <input
                        type="number"
                        min="0"
                        max={maxRunIndex}
                        value={inspectRunIndex}
                        onChange={e => handleRunIndexChange(e.target.value)}
                        className={inputClass}
                      />
                      <p className="text-xs text-slate-500 mt-1">Seed: {mcResults.request.seed}</p>

                      <div className="flex items-center gap-2 mt-3">
                        <button
                          type="button"
                          onClick={() => goToAdjacentFilteredRun(-1)}
                          disabled={!filteredRunIndexes.length}
                          aria-label="Previous filtered run"
                          className="p-2 rounded border border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <ChevronUp size={16}/>
                        </button>
                        <button
                          type="button"
                          onClick={() => goToAdjacentFilteredRun(1)}
                          disabled={!filteredRunIndexes.length}
                          aria-label="Next filtered run"
                          className="p-2 rounded border border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <ChevronDown size={16}/>
                        </button>
                        {runFilter !== 'all' && filteredRunIndexes.length > 0 && (
                          <span className="text-xs text-slate-400">
                            Match {currentFilteredPosition === -1 ? '-' : currentFilteredPosition + 1} / {filteredRunIndexes.length}
                          </span>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className={labelClass}>Status</label>
                      <div className="bg-slate-900 p-3 rounded-lg border border-slate-700">
                        {inspectRunning ? (
                          <p className="text-slate-300">Loading…</p>
                        ) : inspectRun?.isSuccess === true ? (
                          <p className="text-emerald-400 font-semibold">Success (funded through age {displayPlanThroughAge})</p>
                        ) : inspectRun?.isSuccess === false ? (
                          <>
                            <p className="text-red-300 font-semibold">Failed (shortfall by age {displayPlanThroughAge})</p>
                            {inspectRun?.firstFailureYear != null && (
                              <p className="text-slate-300 text-sm mt-1">First shortfall year: {inspectRun.firstFailureYear}</p>
                            )}
                          </>
                        ) : (
                          <p className="text-slate-400">—</p>
                        )}
                        {inspectError && <p className="text-red-300 text-sm mt-2 whitespace-pre-wrap">{inspectError}</p>}
                      </div>
                    </div>

                    <div className="flex items-end">
                      <button
                        onClick={fetchInspectRun}
                        disabled={inspectRunning}
                        className={`w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${inspectRunning ? 'bg-slate-600 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500'}`}
                      >
                        <BarChart3 size={18}/>
                        {inspectRunning ? 'Loading Run...' : 'Load Run'}
                      </button>
                    </div>
                  </div>

                  {inspectRun?.timeline && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 h-[360px]">
                        <h3 className="text-lg font-semibold mb-2">Stock Market Return by Year</h3>
                        <ResponsiveContainer width="100%" height="90%" initialDimension={CHART_INITIAL_DIMENSION}>
                          <ComposedChart data={inspectRun.stockReturnSeries || []}>
                            <XAxis dataKey="age" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                            <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} tickFormatter={formatPctAxis} />
                            <Tooltip content={<RunInspectorStockTooltip />} />
                            <ReferenceLine
                              y={0}
                              stroke="#94a3b8"
                              strokeDasharray="5 5"
                              ifOverflow="extendDomain"
                            />
                            {inspectStockReturnAvg != null && (
                              <ReferenceLine
                                y={inspectStockReturnAvg}
                                stroke="#f59e0b"
                                strokeDasharray="5 5"
                                ifOverflow="extendDomain"
                                label={{ value: `Avg ${(inspectStockReturnAvg * 100).toFixed(1)}%`, position: 'insideTopRight', fill: '#f59e0b', fontSize: 12 }}
                              />
                            )}
                            <Line type="monotone" dataKey="stock_return" name="Stock Return" stroke="#10b981" strokeWidth={2} dot={false} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 h-[360px]">
                        <h3 className="text-lg font-semibold mb-2">Nominal Net Worth Breakdown</h3>
                        <ResponsiveContainer width="100%" height="90%" initialDimension={CHART_INITIAL_DIMENSION}>
                          <ComposedChart data={inspectRun.timeline || []}>
                            <XAxis dataKey="age" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                            <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} tickFormatter={formatValue} />
                            <Tooltip content={<RunInspectorMoneyTooltip />} />
                            <Legend wrapperStyle={{fontSize: 10}}/>
                            <Bar dataKey="retirement_traditional" stackId="assets" fill="#10b981" name="401k"/>
                            <Bar dataKey="retirement_roth" stackId="assets" fill="#3b82f6" name="Roth IRA"/>
                            <Bar dataKey="brokerage" stackId="assets" fill="#8b5cf6" name="Brokerage"/>
                            <Bar dataKey="bitcoin" stackId="assets" fill="#f97316" name="Bitcoin"/>
                            <Bar dataKey="rental_properties" stackId="assets" fill="#f59e0b" name="Rental Properties"/>
                            <Bar dataKey="primary_home" stackId="assets" fill="#06b6d4" name="Primary Home"/>
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 h-[360px] lg:col-span-2">
                        <h3 className="text-lg font-semibold mb-2">Change in Net Worth Through Time (This Year − Last Year)</h3>
                        <ResponsiveContainer width="100%" height="90%" initialDimension={CHART_INITIAL_DIMENSION}>
                          <ComposedChart data={inspectNetWorthChangeSeries}>
                            <XAxis dataKey="age" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                            <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} tickFormatter={formatValue} />
                            <Tooltip content={<RunInspectorMoneyTooltip />} />
                            <ReferenceLine
                              y={0}
                              stroke="#94a3b8"
                              strokeDasharray="5 5"
                              ifOverflow="extendDomain"
                            />
                            <Line type="monotone" dataKey="net_worth_change" name="Δ Net Worth" stroke="#f59e0b" strokeWidth={2} dot={false} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>

                      {inspectExpensesByYearData.length > 0 && (
                        <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 h-[360px] lg:col-span-2">
                          <h3 className="text-lg font-semibold mb-2">Expenses by Year (Run)</h3>
                          <ResponsiveContainer width="100%" height="90%" initialDimension={CHART_INITIAL_DIMENSION}>
                            <ComposedChart data={inspectExpensesByYearData}>
                              <XAxis dataKey="age" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                              <YAxis stroke="#94a3b8" tickFormatter={formatValue} tick={{ fontSize: 12 }} />
                              <Tooltip content={<ExpensesByYearTooltip />} />
                              <Legend wrapperStyle={{ fontSize: 10 }} />
                              {inspectExpenseSeries.map(series => (
                                <Bar key={series.key} dataKey={series.key} stackId="expenses" fill={series.fill} name={series.name} />
                              ))}
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Main Dashboard Tab */}
        {mode === 'custom' && (
        <div className="max-w-7xl mx-auto p-6">
          {/* Monte Carlo Results Banner */}
          {mcResults && (
            <div className="mb-4 bg-slate-800 p-4 rounded-xl border border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <BarChart3 size={24} className="text-emerald-400"/>
                <div>
                  <p className="text-sm text-slate-400">Monte Carlo Analysis ({mcResults.numRuns} simulations)</p>
                  <p className="text-lg font-bold">
                    Success Rate (funded through age {displayPlanThroughAge}): <span className={mcResults.successRate >= 80 ? 'text-emerald-400' : mcResults.successRate >= 50 ? 'text-amber-400' : 'text-red-400'}>{mcResults.successRate.toFixed(1)}%</span>
                    <span className="text-slate-400 text-sm ml-4">Baseline: {Number(mcResults.baselineSuccessRate ?? mcResults.successRate).toFixed(1)}% · Adaptive: {Number(mcResults.adaptiveSuccessRate ?? mcResults.successRate).toFixed(1)}%</span>
                    <span className="text-slate-400 text-sm ml-4">Median NW @ 90: {fmt(mcResults.percentileData?.find(d => d.age === 90)?.p50)}</span>
                  </p>
                </div>
              </div>
              <button onClick={() => changeMode('historical')} className="text-sm text-emerald-400 hover:text-emerald-300">
                Adjust Settings →
              </button>
            </div>
          )}

          <details className="assumptions-panel mb-6" data-testid="assumptions-panel">
            <summary>
              <span id="assumptions-heading" className="font-semibold text-slate-200">Model notes</span>
              <span className="text-xs text-slate-500">{warningsForDisplay.length} {warningsForDisplay.length === 1 ? 'note' : 'notes'} · {taxFilingStatus === 'married_joint' ? 'MFJ' : 'Single'} · RMD {rmdStartAge} · {dividendYieldPct}% dividends · {saleHaircutPct}% haircut</span>
            </summary>
            <div className="assumptions-content">
              <p className="text-sm text-slate-400">{mode === 'historical' ? 'Seeded, contiguous S&P 500 price-return history through 2025.' : 'One path using the returns and cash flows entered.'} Simplified 2025 federal tax model. Plan v{PLAN_VERSION} in {currentYear} dollars. Illustrative only.</p>
              <ul className="mt-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-2" data-testid="warnings-list">
                {warningsForDisplay.map((warning, index) => <li key={`${warning.code}-${warning.path || index}`} className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2"><strong className="text-amber-300">{WARNING_TITLES[warning.code] || 'Model note'}</strong><span className="block text-slate-400">{warning.message}</span></li>)}
              </ul>
            </div>
          </details>

          {/* Key Metrics Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            {[
              { label: "Current Net Worth", nominal: totalAssets, real: totalAssets, icon: PiggyBank, color: "text-emerald-400" },
              { label: `Net Worth @ ${displayRetireAge}`, nominal: metrics?.nw_at_retirement?.nominal_net_worth, real: metrics?.nw_at_retirement?.real_net_worth, icon: TrendingUp, color: "text-cyan-400" },
              { label: `Net Worth @ ${displayPlanThroughAge}`, nominal: metrics?.nw_at_plan_end?.nominal_net_worth ?? metrics?.nw_at_95?.nominal_net_worth, real: metrics?.nw_at_plan_end?.real_net_worth ?? metrics?.nw_at_95?.real_net_worth, icon: Activity, color: "text-purple-400" }
            ].map((s, i) => (
              <div key={i} className="bg-slate-800 p-4 rounded-xl border border-slate-700 min-h-[74px] flex items-center gap-4">
                <div className={`p-2 bg-slate-900 rounded-lg ${s.color}`}><s.icon size={18}/></div>
                <div>
                  <p className="text-slate-400 text-xs font-medium">{s.label}</p>
                  <h3 className="text-lg font-bold">{fmt(s.nominal)} <span className="text-slate-500">/</span> <span className="text-slate-400">{fmt(s.real)}</span></h3>
                </div>
              </div>
            ))}
          </div>

          <div className="dashboard-grid grid grid-cols-1 gap-6">
            <aside className="planner-sidebar" aria-label="Retirement plan sections">
              <div className="planner-sidebar-heading">
                <span className="planner-eyebrow">Plan workspace</span>
                <strong>Build your scenario</strong>
              </div>
              <nav className="planner-nav">
                {[
                  { id: 'assumptions', label: 'Core assumptions', icon: <Settings size={18}/> },
                  { id: 'income', label: 'Income', icon: <Briefcase size={18}/>, meta: inflows.length },
                  { id: 'expenses', label: 'Expenses', icon: <CreditCard size={18}/>, meta: outflows.length },
                  { id: 'assets', label: 'Financial assets', icon: <PiggyBank size={18}/>, meta: financialAssetEntries.length },
                  { id: 'housing', label: 'Housing', icon: <House size={18}/>, meta: propertyEntries.length },
                  { id: 'events', label: 'One-time events', icon: <Plus size={18}/>, meta: otherAssets.length + oneTimeExpenses.length },
                  { id: 'results', label: 'Results', icon: <BarChart3 size={18}/>, meta: data?.length ? 'Ready' : null },
                ].map(({ id, label, icon, meta }) => (
                  <button
                    key={id}
                    type="button"
                    className={`planner-nav-button ${activePlannerSection === id ? 'active' : ''}`}
                    onClick={() => setActivePlannerSection(id)}
                    aria-current={activePlannerSection === id ? 'page' : undefined}
                  >
                    {icon}
                    <span>{label}</span>
                    {meta !== null && meta !== undefined ? <small>{meta}</small> : null}
                  </button>
                ))}
              </nav>
              <div className="planner-sidebar-summary">
                <span>Draft net worth</span>
                <strong>{fmt(totalAssets)}</strong>
                <small>{propertyEntries.length} {propertyEntries.length === 1 ? 'property' : 'properties'} · {financialAssetEntries.length} financial accounts</small>
              </div>
            </aside>
            {/* Left Column - Assumptions */}
            <div className={`space-y-4 min-w-0 planner-content-column ${['assumptions', 'assets', 'housing', 'events'].includes(activePlannerSection) ? '' : 'hidden'}`}>
              {/* Core Assumptions */}
              {activePlannerSection === 'assumptions' && (
              <div className={cardClass}>
                <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-300 mb-4">
                  <Settings size={20}/> Core Assumptions
                </h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass} htmlFor="current-year">Current Year</label>
                  <input id="current-year" type="number" min="1900" max="2200" value={currentYear} onChange={e => setCurrentYear(Math.trunc(asNumber(e.target.value, CURRENT_YEAR)))} className={inputClass}/>
                  <p className="text-xs text-slate-500 mt-1">Defaults use the current calendar year; this is the first modeled year.</p>
                </div>
                <div>
                  <label className={labelClass} htmlFor="current-age">Current Age</label>
                  <input id="current-age" type="number" min="0" max="120" value={currentAge} onChange={e => setCurrentAge(Math.trunc(asNumber(e.target.value, currentAge)))} className={inputClass}/>
                </div>
                <div>
                  <label className={labelClass} htmlFor="retire-age">Retire Age</label>
                  <input id="retire-age" type="number" min="0" max="120" value={retireAge} onChange={e => setRetireAge(Math.trunc(asNumber(e.target.value, retireAge)))} className={inputClass}/>
                </div>
                <div>
                  <label className={labelClass} htmlFor="retirement-withdrawal-age">401k Withdrawal Age</label>
                  <input id="retirement-withdrawal-age" type="number" min="0" max="115" value={retirementWithdrawalAge} onChange={e => setRetirementWithdrawalAge(Number(e.target.value))} className={inputClass}/>
                </div>
                <div>
                  <label className={labelClass} htmlFor="plan-through-age">Plan Through Age</label>
                  <input id="plan-through-age" type="number" min="85" max="115" value={planThroughAge} onChange={e => setPlanThroughAge(Math.trunc(asNumber(e.target.value, DEFAULT_PLAN_THROUGH_AGE)))} className={inputClass}/>
                  <p className="text-xs text-slate-500 mt-1">Inclusive age-first horizon (85–115).</p>
                </div>
                <div>
                  <label className={labelClass} htmlFor="tax-filing-status">Tax Filing Status</label>
                  <select id="tax-filing-status" value={taxFilingStatus} onChange={e => setTaxFilingStatus(e.target.value)} className={inputClass}>
                    <option value="married_joint">MFJ</option>
                    <option value="single">Single</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="rmd-start-age">RMD Start Age</label>
                  <select id="rmd-start-age" value={rmdStartAge} onChange={e => setRmdStartAge(Number(e.target.value))} className={inputClass}>
                    <option value={73}>73</option>
                    <option value={75}>75</option>
                  </select>
                  <p className="text-xs text-slate-500 mt-1">Prior Dec 31 balance; Roth excluded.</p>
                </div>
                <div>
                  <label className={labelClass} htmlFor="inflation-rate">Inflation %</label>
                  <input id="inflation-rate" type="number" step="0.1" value={inflation} onChange={e => setInflation(Number(e.target.value))} className={inputClass}/>
                </div>
                <div>
                  <label className={labelClass} htmlFor="stock-growth-rate">Apply Stock Growth %</label>
                  <input id="stock-growth-rate" type="number" step="0.1" value={stockGrowth} onChange={e => applyStockGrowthAssumption(e.target.value)} className={inputClass}/>
                </div>
                <div className="inflation-linked-note">
                  <span>Housing growth</span>
                  <strong>Linked to inflation ({asNumber(inflation, 0).toFixed(1)}%)</strong>
                  <small>Values, revenue, and operating costs use the same inflation path.</small>
                </div>
                <div>
                  <label className={labelClass} htmlFor="dividend-yield">Dividend Yield %</label>
                  <input id="dividend-yield" type="number" min="0" max="100" step="0.1" value={dividendYieldPct} onChange={e => setDividendYieldPct(asNumber(e.target.value, DEFAULT_DIVIDEND_YIELD_PCT))} className={inputClass}/>
                </div>
                <div>
                  <label className={labelClass} htmlFor="sale-haircut">Sale Haircut %</label>
                  <input id="sale-haircut" type="number" min="0" max="99.9" step="0.1" value={saleHaircutPct} onChange={e => setSaleHaircutPct(asNumber(e.target.value, DEFAULT_SALE_HAIRCUT_PCT))} className={inputClass}/>
                </div>
                <div>
                  <label className={labelClass} htmlFor="contribution-limit">Annual 401k Limit $</label>
                  <input id="contribution-limit" type="number" min="0" step="500" value={workplaceContributionLimit} onChange={e => setWorkplaceContributionLimit(asNumber(e.target.value, DEFAULT_WORKPLACE_CONTRIBUTION_LIMIT))} className={inputClass}/>
                </div>
                <div>
                  <label className={labelClass} htmlFor="match-rate">Employer Match Cap %</label>
                  <input id="match-rate" type="number" min="0" max="99.9" step="0.1" value={employerMatchRatePct} onChange={e => setEmployerMatchRatePct(asNumber(e.target.value, DEFAULT_EMPLOYER_MATCH_RATE_PCT))} className={inputClass}/>
                  <p className="text-xs text-slate-500 mt-1">100% match on your contribution, up to this share of salary.</p>
                </div>
              </div>
              <div className="mt-4 border-t border-slate-700 pt-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Withdrawal order</div>
                <p className="text-xs text-slate-500 mb-2">RMDs are applied first; move the remaining sources to match your plan.</p>
                <ol className="space-y-1" aria-label="Withdrawal source order">
                  {withdrawalOrder.map((category, index) => (
                    <li key={category} className="flex items-center gap-2 rounded bg-slate-900 px-2 py-1 text-sm text-slate-300">
                      <span className="w-5 text-slate-500">{index + 1}.</span>
                      <span className="flex-1">{WITHDRAWAL_LABELS[category] || category}</span>
                      <button type="button" onClick={() => moveWithdrawalCategory(index, -1)} disabled={index === 0} aria-label={`Move ${WITHDRAWAL_LABELS[category] || category} up`} className="rounded px-1 text-slate-400 hover:text-white disabled:opacity-30"><ChevronUp size={14}/></button>
                      <button type="button" onClick={() => moveWithdrawalCategory(index, 1)} disabled={index >= withdrawalOrder.length - 2} aria-label={`Move ${WITHDRAWAL_LABELS[category] || category} down`} className="rounded px-1 text-slate-400 hover:text-white disabled:opacity-30"><ChevronDown size={14}/></button>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => { setMode('custom'); runScenario('custom'); }} disabled={runState.status === 'running'} className="w-full px-4 py-3 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600" data-testid="run-custom-scenario">
                  {runState.status === 'running' && mode === 'custom' ? 'Running Custom Scenario…' : 'Run Custom Scenario'}
                </button>
                <p className="text-xs text-slate-500">Requests are sent only when you choose Run. Editing inputs never auto-runs.</p>
              </div>
              </div>
              )}

            {/* Assets */}
            {activePlannerSection === 'assets' && (
            <div className={cardClass}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-300">
                  <PiggyBank size={20}/> Assets
                </h3>
                <button type="button" onClick={addAsset} aria-label="Add asset" className="text-emerald-400 hover:text-emerald-300"><Plus size={20}/></button>
              </div>
              <div className="space-y-3">
                {financialAssetEntries.map(({ asset, index: i }) => (
                  <div key={i} className="bg-slate-900 p-3 rounded-lg">
                    <div className="flex justify-between items-start mb-2">
                      <input 
                        value={asset.name} 
                        onChange={e => updateAsset(i, 'name', e.target.value)}
                        className="bg-transparent border-none text-sm font-medium focus:outline-none"
                        aria-label={`Name of asset ${i + 1}`}
                      />
                      <button type="button" onClick={() => removeAsset(i)} aria-label={`Remove ${asset.name || 'asset'}`} className="text-red-400 hover:text-red-300"><Trash2 size={14}/></button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-slate-500">Value $</label>
                        <input type="number" value={asset.value} onChange={e => updateAsset(i, 'value', Number(e.target.value))} className={inputClass} aria-label={`Value for ${asset.name || `asset ${i + 1}`}`}/>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Growth %</label>
                        <input type="number" step="0.1" value={asset.growth_rate} onChange={e => updateAsset(i, 'growth_rate', Number(e.target.value))} className={inputClass} aria-label={`Growth rate for ${asset.name || `asset ${i + 1}`}`}/>
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-slate-500" htmlFor={`asset-type-${i}`}>Type</label>
                        <select
                          id={`asset-type-${i}`}
                          value={asset.tax_treatment || 'taxable'}
                          onChange={e => updateAsset(i, 'tax_treatment', e.target.value)}
                          className={inputClass}
                        >
                          {FINANCIAL_ASSET_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </div>
                      {asset.tax_treatment === 'real_estate' ? (
                        <div className="col-span-2 grid grid-cols-2 gap-2 items-end">
                          <div>
                            <label className="text-xs text-slate-500" htmlFor={`property-role-${i}`}>Property role</label>
                            <select
                              id={`property-role-${i}`}
                              value={asset.property_role || ''}
                              onChange={e => updateAsset(i, 'property_role', e.target.value || undefined)}
                              className={inputClass}
                            >
                              <option value="">Rental (default)</option>
                              <option value="rental">Rental</option>
                              <option value="primary">Primary home</option>
                            </select>
                          </div>
                          <span className="text-xs text-slate-500 pb-2">Properties are sold whole, never partially.</span>
                        </div>
                      ) : asset.tax_treatment === 'pre_tax' ? (
                        <label className="col-span-2 flex items-center gap-2 text-xs text-slate-400">
                          <input type="checkbox" checked={!!asset.workplace_plan} onChange={e => updateAsset(i, 'workplace_plan', e.target.checked)} />
                          Workplace plan (RMD delay while employed)
                        </label>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-slate-700 text-right">
                <span className="text-slate-400 text-sm">Financial total: </span>
                <span className="text-emerald-400 font-bold">{fmt(totalFinancialAssets)}</span>
              </div>
            </div>
            )}

            {/* Housing */}
            {activePlannerSection === 'housing' && (
            <div className={cardClass}>
              <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
                <div>
                  <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-200">
                    <House size={20}/> Housing
                  </h3>
                  <p className="text-sm text-slate-500 mt-1">Track each home or rental separately, including your ownership share and its mortgage.</p>
                </div>
                <button type="button" onClick={addProperty} className="toolbar-button flex items-center gap-2" aria-label="Add property"><Plus size={16}/> Add property</button>
              </div>
              <div className="space-y-4">
                {propertyEntries.length === 0 ? (
                  <div className="empty-planner-state">
                    <House size={28}/>
                    <strong>No properties yet</strong>
                    <span>Add a primary residence, vacation home, or rental property.</span>
                  </div>
                ) : propertyEntries.map(({ asset, index: i }) => {
                  const ownedValue = asNumber(asset.value, 0) * (asNumber(asset.ownership_pct, 100) / 100);
                  const equity = ownedValue - asNumber(asset.mortgage_balance, 0);
                  const ownershipShare = asNumber(asset.ownership_pct, 100) / 100;
                  const ownedRevenue = asNumber(asset.annual_revenue, 0) * ownershipShare;
                  const ownedOperatingExpenses = asNumber(asset.annual_operating_expenses, 0) * ownershipShare;
                  const currentNoi = ownedRevenue - ownedOperatingExpenses;
                  const estimatedPayment = estimatedMortgagePayment(asset);
                  return (
                    <article key={asset.id || i} className="housing-property-card">
                      <div className="housing-property-header">
                        <div className="min-w-0 flex-1">
                          <label className="sr-only" htmlFor={`property-name-${i}`}>Property name</label>
                          <input
                            id={`property-name-${i}`}
                            value={asset.name}
                            onChange={e => updateAsset(i, 'name', e.target.value)}
                            className="property-name-input"
                            aria-label={`Name of property ${i + 1}`}
                          />
                          <span>{asset.property_role === 'primary' ? 'Primary residence' : 'Rental or investment property'}</span>
                        </div>
                        <button type="button" onClick={() => removeAsset(i)} aria-label={`Remove ${asset.name || 'property'}`} className="delete-button"><Trash2 size={16}/></button>
                      </div>
                      <div className="housing-grid housing-overview-grid">
                        <div>
                          <label className={labelClass} htmlFor={`property-role-${i}`}>Use</label>
                          <select id={`property-role-${i}`} value={asset.property_role || 'rental'} onChange={e => updateAsset(i, 'property_role', e.target.value)} className={inputClass}>
                            <option value="primary">Primary residence</option>
                            <option value="rental">Rental / investment</option>
                          </select>
                        </div>
                        <div>
                          <label className={labelClass} htmlFor={`property-value-${i}`}>Whole property value $</label>
                          <input id={`property-value-${i}`} type="number" min="0" value={asset.value} onChange={e => updateAsset(i, 'value', Number(e.target.value))} className={inputClass}/>
                        </div>
                        <div>
                          <label className={labelClass} htmlFor={`property-ownership-${i}`}>Your ownership %</label>
                          <input id={`property-ownership-${i}`} type="number" min="0.01" max="100" step="0.01" value={asset.ownership_pct ?? 100} onChange={e => updateAsset(i, 'ownership_pct', Number(e.target.value))} className={inputClass}/>
                        </div>
                      </div>
                      <div className="property-cashflow-panel">
                        <div className="mortgage-panel-heading">
                          <div>
                            <strong>Annual property operations</strong>
                            <span>Enter whole-property figures; your ownership share is applied automatically.</span>
                          </div>
                          <span className="inflation-status">Grows with {asNumber(inflation, 0).toFixed(1)}% inflation</span>
                        </div>
                        <div className="housing-grid property-cashflow-grid">
                          <div>
                            <label className={labelClass} htmlFor={`property-revenue-${i}`}>Annual revenue $</label>
                            <input id={`property-revenue-${i}`} type="number" min="0" value={asset.annual_revenue ?? 0} onChange={e => updateAsset(i, 'annual_revenue', Number(e.target.value))} className={inputClass}/>
                          </div>
                          <div>
                            <label className={labelClass} htmlFor={`property-opex-${i}`}>Annual operating expenses $</label>
                            <input id={`property-opex-${i}`} type="number" min="0" value={asset.annual_operating_expenses ?? 0} onChange={e => updateAsset(i, 'annual_operating_expenses', Number(e.target.value))} className={inputClass}/>
                          </div>
                        </div>
                      </div>
                      <div className="mortgage-panel">
                        <div className="mortgage-panel-heading">
                          <div>
                            <strong>Mortgage</strong>
                            <span>Enter the debt attributable to your ownership share.</span>
                          </div>
                          <span className={asNumber(asset.mortgage_balance, 0) > 0 ? 'mortgage-status active' : 'mortgage-status'}>{asNumber(asset.mortgage_balance, 0) > 0 ? `${fmt(estimatedPayment)}/mo` : 'No mortgage'}</span>
                        </div>
                        <div className="housing-grid mortgage-grid">
                          <div>
                            <label className={labelClass} htmlFor={`mortgage-balance-${i}`}>Remaining balance $</label>
                            <input id={`mortgage-balance-${i}`} type="number" min="0" value={asset.mortgage_balance ?? 0} onChange={e => updateAsset(i, 'mortgage_balance', Number(e.target.value))} className={inputClass}/>
                          </div>
                          <div>
                            <label className={labelClass} htmlFor={`mortgage-rate-${i}`}>Interest rate APR %</label>
                            <input id={`mortgage-rate-${i}`} type="number" min="0" max="100" step="0.01" value={asset.mortgage_interest_rate ?? 0} onChange={e => updateAsset(i, 'mortgage_interest_rate', Number(e.target.value))} className={inputClass}/>
                          </div>
                          <div>
                            <label className={labelClass} htmlFor={`mortgage-payment-${i}`}>Monthly P&amp;I $</label>
                            <input id={`mortgage-payment-${i}`} type="number" min="0" value={asset.mortgage_monthly_payment ?? 0} onChange={e => updateAsset(i, 'mortgage_monthly_payment', Number(e.target.value))} className={inputClass}/>
                            <p className="field-hint">Use 0 to calculate from balance, rate, and payments left.</p>
                          </div>
                          <div>
                            <label className={labelClass} htmlFor={`mortgage-payments-${i}`}>Payments remaining</label>
                            <input id={`mortgage-payments-${i}`} type="number" min="0" max="1200" step="1" value={asset.mortgage_payments_remaining ?? 0} onChange={e => updateAsset(i, 'mortgage_payments_remaining', Math.max(0, Math.trunc(Number(e.target.value))))} className={inputClass}/>
                            <p className="field-hint">Monthly payments, not years.</p>
                          </div>
                        </div>
                      </div>
                      <div className="housing-summary-grid">
                        <div><span>Your gross share</span><strong>{fmt(ownedValue)}</strong></div>
                        <div><span>Your annual revenue</span><strong>{fmt(ownedRevenue)}</strong></div>
                        <div><span>Your annual OpEx</span><strong>{fmt(ownedOperatingExpenses)}</strong></div>
                        <div><span>Current NOI</span><strong className={currentNoi < 0 ? 'text-red-300' : 'text-emerald-300'}>{fmt(currentNoi)}</strong></div>
                        <div><span>Current equity</span><strong className={equity < 0 ? 'text-red-300' : 'text-emerald-300'}>{fmt(equity)}</strong></div>
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="mt-4 pt-4 border-t border-slate-700 flex flex-wrap justify-between gap-2 text-sm">
                <span className="text-slate-500">Property values, revenue, and operating costs grow with global inflation. Mortgage P&amp;I follows each loan schedule until payoff.</span>
                <span className="text-slate-300">Housing equity: <strong className="text-emerald-400">{fmt(totalHousingEquity)}</strong></span>
              </div>
            </div>
            )}

            {/* One-Time Asset Additions */}
            {activePlannerSection === 'events' && (
            <div className={cardClass}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-300">
                  <Plus size={20}/> One-Time Asset Additions
                </h3>
                <button type="button" onClick={addOtherAsset} aria-label="Add one-time asset" className="text-emerald-400 hover:text-emerald-300"><Plus size={20}/></button>
              </div>
              <div className="space-y-2">
                {otherAssets.map((asset, i) => (
                  <div key={asset.id || i} className="one-time-asset-grid">
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
                        aria-label={`Name of one-time asset ${i + 1}`}
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
                        aria-label={`Value for one-time asset ${asset.name || i + 1}`}
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
                        aria-label={`Year for one-time asset ${asset.name || i + 1}`}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">Destination</label>
                      <select
                        value={asset.destination_account || ''}
                        onChange={e => {
                          const updated = [...otherAssets];
                          updated[i].destination_account = e.target.value || undefined;
                          setOtherAssets(updated);
                        }}
                        className={inputClass}
                        aria-label={`Destination for ${asset.name}`}
                      >
                        <option value="">Auto: first liquid account</option>
                        {assets.map(account => <option key={account.id || account.name} value={account.id || account.name}>{account.name}</option>)}
                        </select>
                    </div>
                    <button type="button" onClick={() => removeOtherAsset(i)} aria-label={`Remove ${asset.name || 'one-time asset'}`} className="delete-button event-delete"><Trash2 size={16}/></button>
                  </div>
                ))}
              </div>
            </div>
            )}
          </div>

          {/* Middle Column - Income & Expenses */}
            <div className={`space-y-4 min-w-0 planner-content-column ${['income', 'expenses', 'events'].includes(activePlannerSection) ? '' : 'hidden'}`}>
            {/* Expenses */}
            {activePlannerSection === 'expenses' && (
            <div className={cardClass}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-300">
                  <CreditCard size={20}/> Expenses
                </h3>
                <button type="button" onClick={addOutflow} aria-label="Add expense" className="text-emerald-400 hover:text-emerald-300"><Plus size={20}/></button>
              </div>
              <div className="space-y-3">
                {outflows.map((outflow, i) => (
                  <div key={i} className="bg-slate-900 p-3 rounded-lg">
                    <div className="flex justify-between items-start mb-2">
                      <input 
                        value={outflow.name} 
                        onChange={e => updateOutflow(i, 'name', e.target.value)}
                        className="bg-transparent border-none text-sm font-medium focus:outline-none"
                        aria-label={`Name of expense ${i + 1}`}
                      />
                      <button type="button" onClick={() => removeOutflow(i)} aria-label={`Remove ${outflow.name || 'expense'}`} className="text-red-400 hover:text-red-300"><Trash2 size={14}/></button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-slate-500">$/yr</label>
                        <input type="number" value={outflow.amount} onChange={e => updateOutflow(i, 'amount', Number(e.target.value))} className={inputClass} aria-label={`Annual amount for ${outflow.name || `expense ${i + 1}`}`}/>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Start</label>
                        <input type="number" value={outflow.start_year} onChange={e => updateOutflow(i, 'start_year', Number(e.target.value))} className={inputClass} aria-label={`Start year for ${outflow.name || `expense ${i + 1}`}`}/>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">End</label>
                        <input type="number" value={outflow.end_year} onChange={e => updateOutflow(i, 'end_year', Number(e.target.value))} className={inputClass} aria-label={`End year for ${outflow.name || `expense ${i + 1}`}`}/>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Grow%</label>
                        <input type="number" step="0.1" value={outflow.growth_rate} disabled={outflow.growth_mode === 'global'} onChange={e => updateOutflow(i, 'growth_rate', Number(e.target.value))} className={`${inputClass} disabled:opacity-50`} aria-label={`Growth rate for ${outflow.name || `expense ${i + 1}`}`}/>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500" htmlFor={`expense-growth-mode-${i}`}>Growth</label>
                        <select id={`expense-growth-mode-${i}`} value={outflow.growth_mode === 'global' ? 'global' : 'custom'} onChange={e => updateOutflow(i, 'growth_mode', e.target.value)} className={inputClass}>
                          <option value="global">Global inflation</option>
                          <option value="custom">Custom rate</option>
                        </select>
                      </div>
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                      <input type="checkbox" checked={outflow.discretionary !== false} onChange={e => updateOutflow(i, 'discretionary', e.target.checked)} />
                      Flexible spending (adaptive rules can reduce this)
                    </label>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-slate-700 text-right">
                <span className="text-slate-400 text-sm">Annual: </span>
                <span className="text-red-400 font-bold">{fmt(totalExpenses)}</span>
              </div>
            </div>
            )}

            {/* Income Streams */}
            {activePlannerSection === 'income' && (
            <div className={cardClass}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-300">
                  <Briefcase size={20}/> Income Streams
                </h3>
                <button type="button" onClick={addInflow} aria-label="Add income" className="text-emerald-400 hover:text-emerald-300"><Plus size={20}/></button>
              </div>
              <div className="space-y-3">
                {inflows.map((inflow, i) => (
                  <div key={i} className="bg-slate-900 p-3 rounded-lg">
                    <div className="flex justify-between items-start mb-2">
                      <input 
                        value={inflow.name} 
                        onChange={e => updateInflow(i, 'name', e.target.value)}
                        className="bg-transparent border-none text-sm font-medium focus:outline-none"
                        aria-label={`Name of income ${i + 1}`}
                      />
                      <button type="button" onClick={() => removeInflow(i)} aria-label={`Remove ${inflow.name || 'income'}`} className="text-red-400 hover:text-red-300"><Trash2 size={14}/></button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-slate-500">$/yr</label>
                        <input type="number" value={inflow.amount} onChange={e => updateInflow(i, 'amount', Number(e.target.value))} className={inputClass} aria-label={`Annual amount for ${inflow.name || `income ${i + 1}`}`}/>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Start</label>
                        <input type="number" value={inflow.start_year} onChange={e => updateInflow(i, 'start_year', Number(e.target.value))} className={inputClass} aria-label={`Start year for ${inflow.name || `income ${i + 1}`}`}/>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">End</label>
                        <input type="number" value={inflow.end_year} onChange={e => updateInflow(i, 'end_year', Number(e.target.value))} className={inputClass} aria-label={`End year for ${inflow.name || `income ${i + 1}`}`}/>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Grow%</label>
                        <input type="number" step="0.1" value={inflow.growth_rate} onChange={e => updateInflow(i, 'growth_rate', Number(e.target.value))} className={inputClass} aria-label={`Growth rate for ${inflow.name || `income ${i + 1}`}`}/>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500" htmlFor={`income-type-${i}`}>Type</label>
                        <select
                          id={`income-type-${i}`}
                          value={inflow.income_type || 'other'}
                          onChange={e => updateInflow(i, 'income_type', e.target.value)}
                          className={inputClass}
                          aria-label={`Type for ${inflow.name || `income ${i + 1}`}`}
                        >
                          {INCOME_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
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
            )}

            {/* One-Time Expenses */}
            {activePlannerSection === 'events' && (
            <div className={cardClass}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-300">
                  <CreditCard size={20}/> One-Time Expenses
                </h3>
                <button type="button" onClick={addOneTimeExpense} aria-label="Add one-time expense" className="text-emerald-400 hover:text-emerald-300"><Plus size={20}/></button>
              </div>
              <div className="space-y-3">
                {oneTimeExpenses.map((expense, i) => (
                  <div key={i} className="bg-slate-900 p-3 rounded-lg">
                    <div className="flex justify-end">
                      <button type="button" onClick={() => removeOneTimeExpense(i)} aria-label={`Remove ${expense.name || 'one-time expense'}`} className="text-red-400 hover:text-red-300"><Trash2 size={14}/></button>
                    </div>
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
                          aria-label={`Name of one-time expense ${i + 1}`}
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
                          aria-label={`Amount for one-time expense ${expense.name || i + 1}`}
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
                          aria-label={`Year for one-time expense ${expense.name || i + 1}`}
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
            )}
          </div>

          {/* Right Column - Charts */}
          <div className={`space-y-4 min-w-0 planner-content-column ${activePlannerSection === 'results' ? '' : 'hidden'}`}>
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 h-[360px]">
              <h3 className="text-lg font-semibold mb-2">Net Worth Breakdown</h3>
              {data?.length ? (
                <div style={{width: '100%', height: '300px'}}>
                  <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_DIMENSION}>
                    <ComposedChart data={data}>
                      <XAxis dataKey="age" stroke="#64748b" tick={{fontSize: 11}}/>
                      <YAxis stroke="#64748b" tickFormatter={formatValue} tick={{fontSize: 11}}/>
                      <Tooltip content={<CustomTooltip variant="netWorth" />} />
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
              ) : <div className="h-[300px] flex items-center justify-center text-sm text-slate-500">Run a scenario to see the projection.</div>}
            </div>

            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 h-[360px]">
              <h3 className="text-lg font-semibold mb-2">After-Tax Income vs Expenses</h3>
              {data?.length ? (
                <div style={{width: '100%', height: '300px'}}>
                  <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_DIMENSION}>
                    <ComposedChart data={data}>
                      <XAxis dataKey="age" stroke="#64748b" tick={{fontSize: 11}}/>
                      <YAxis stroke="#64748b" tickFormatter={formatValue} tick={{fontSize: 11}}/>
                      <Tooltip content={<CustomTooltip variant="expenses" />} />
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
              ) : <div className="h-[300px] flex items-center justify-center text-sm text-slate-500">Run a scenario to see cash flow.</div>}
            </div>

            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 h-[360px]">
              <h3 className="text-lg font-semibold mb-2">Expenses by Year</h3>
              {expensesByYearData.length ? (
                <div style={{width: '100%', height: '300px'}}>
                  <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_DIMENSION}>
                    <ComposedChart data={expensesByYearData}>
                      <XAxis dataKey="age" stroke="#64748b" tick={{fontSize: 11}} interval="preserveStartEnd" />
                      <YAxis stroke="#64748b" tickFormatter={formatValue} tick={{fontSize: 11}}/>
                      <Tooltip content={<ExpensesByYearTooltip />} />
                      <Legend wrapperStyle={{fontSize: 10}}/>
                      {expenseSeries.map(s => (
                        <Bar key={s.key} dataKey={s.key} stackId="expenses" fill={s.fill} name={s.name} />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : <div className="h-[300px] flex items-center justify-center text-sm text-slate-500">Run a scenario to see expense detail.</div>}
            </div>

            {/* Monte Carlo Percentile Chart */}
            {mcResults && mcResults.percentileData?.length > 0 && (
              <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 h-[360px]">
                <h3 className="text-lg font-semibold mb-2">Monte Carlo: Net Worth Percentiles</h3>
                <div style={{width: '100%', height: '300px'}}>
                  <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_DIMENSION}>
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

            <section className="bg-slate-800 p-4 rounded-xl border border-slate-700" aria-labelledby="year-table-heading" data-testid="year-table-panel">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 id="year-table-heading" className="text-lg font-semibold">Year-by-year result table</h3>
                  <p className="text-xs text-slate-500 mt-1">The same normalized result rows used by the charts. Expand only when you need the ledger detail.</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={exportCurrentCsv} disabled={!data} className="toolbar-button" data-testid="export-csv-table">Export CSV</button>
                  <button type="button" onClick={() => setTableOpen(previous => !previous)} className="toolbar-button" aria-expanded={tableOpen} aria-controls="year-table-content" data-testid="toggle-year-table">
                    {tableOpen ? 'Hide table' : 'Show table'}
                  </button>
                </div>
              </div>
              {tableOpen ? (
                <div id="year-table-content" className="overflow-x-auto mt-4" tabIndex={0} role="region" aria-label="Year-by-year result table">
                  <table className="result-table" data-testid="year-table">
                    <caption className="sr-only">Year-by-year normalized retirement result</caption>
                    <thead><tr><th scope="col">Year</th><th scope="col">Age</th><th scope="col">Net worth</th><th scope="col">Liquid</th><th scope="col">Property</th><th scope="col">Real net worth</th><th scope="col">Expenses</th><th scope="col">RMD required</th><th scope="col">RMD used</th><th scope="col">RMD excess</th><th scope="col">Status</th></tr></thead>
                    <tbody>
                      {(data || []).map((row) => <tr key={`${row.year}-${row.age}`}><th scope="row">{row.year}</th><td>{row.age}</td><td>{formatValueDetailed(row.nominal_net_worth)}</td><td>{formatValueDetailed(row.liquid_net_worth)}</td><td>{formatValueDetailed(row.property_net_worth)}</td><td>{formatValueDetailed(row.real_net_worth)}</td><td>{formatValueDetailed(row.total_expenses)}</td><td>{formatValueDetailed(row.rmd?.required_amount)}</td><td>{formatValueDetailed(row.rmd?.used_amount ?? row.rmd?.applied_amount)}</td><td>{formatValueDetailed(row.rmd?.excess_amount)}</td><td>{row.withdrawal_shortfall > 0 ? 'Shortfall' : 'Funded'}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </div>
        )}
      </div>
    </div>
  );
}
