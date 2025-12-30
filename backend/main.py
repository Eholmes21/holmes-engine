from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- DATA MODELS ---
class Asset(BaseModel):
    name: str
    value: float
    growth_rate: float
    tax_treatment: str 

class Stream(BaseModel):
    name: str
    amount: float
    start_year: int
    end_year: int
    growth_rate: Optional[float] = None

class OtherAsset(BaseModel):
    name: str
    value: float
    add_year: int

class OneTimeExpense(BaseModel):
    name: str
    amount: float
    year: int
    add_to_primary_home: bool = False

class SimParams(BaseModel):
    current_year: int = 2025
    current_age: int = 38
    target_retirement_age: int
    retirement_withdrawal_age: int = 60
    general_inflation: float
    tax_filing_status: str = "married_joint"
    assets: List[Asset]
    inflows: List[Stream]
    outflows: List[Stream]
    other_assets: List[OtherAsset] = []
    one_time_expenses: List[OneTimeExpense] = []

# --- HELPER: FEDERAL TAX CALCULATOR (Inflation Adjusted) ---
def calculate_federal_tax(taxable_income: float, years_passed: int = 0, inflation: float = 0.0) -> float:
    inflation_factor = (1 + (inflation or 0.0)) ** max(0, years_passed)
    
    std_deduction_base = 29200
    brackets_base = [
        (23200, 0.10),
        (94300, 0.12),
        (201050, 0.22),
        (383900, 0.24),
        (487450, 0.32),
        (731200, 0.35),
    ]

    std_deduction = std_deduction_base * inflation_factor
    income = max(0.0, taxable_income - std_deduction)

    tax = 0.0
    prev_limit = 0.0
    for limit_base, rate in brackets_base:
        limit = limit_base * inflation_factor
        if income <= prev_limit:
            break
        amt = min(income, limit) - prev_limit
        tax += amt * rate
        prev_limit = limit

    if income > prev_limit:
        tax += (income - prev_limit) * 0.37

    return tax

# --- HELPER: RMD FACTOR ---
def get_rmd_divisor(age: int) -> float:
    if age < 73: return 0
    table = {
        73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1, 80: 20.2,
        81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7,
        89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9, 96: 8.4
    }
    return table.get(age, 8.0)

# --- THE ENGINE ---
@app.post("/simulate")
def run_simulation(params: SimParams):
    timeline = []
    
    portfolio = {a.name: a.value for a in params.assets}
    asset_types = {a.name: a.tax_treatment for a in params.assets}
    
    # Track rental equity percentage
    rental_portfolio_pct = 1.0
    
    year = params.current_year
    age = params.current_age
    freedom_achieved = False
    freedom_year = None
    
    while age <= 95:
        years_passed = year - params.current_year
        inflation_mult = (1 + params.general_inflation) ** years_passed
        
        # 1. ADD ONE-TIME ASSETS
        for oa in params.other_assets:
            if oa.add_year == year and oa.value > 0:
                target = next((n for n, t in asset_types.items() if t == 'taxable'), None)
                if target: portfolio[target] += oa.value

        # 1b. APPLY ONE-TIME EXPENSES (optionally convert to Primary Home equity)
        one_time_expenses_total = 0.0
        for exp in params.one_time_expenses:
            if exp.year == year and exp.amount > 0:
                one_time_expenses_total += exp.amount
                if exp.add_to_primary_home:
                    primary = next((n for n in portfolio.keys() if 'primary' in n.lower()), None)
                    if primary:
                        portfolio[primary] += exp.amount

        # 2. CALCULATE TARGET EXPENSES
        target_expenses = one_time_expenses_total
        for out in params.outflows:
            if out.start_year <= year <= out.end_year:
                rate = out.growth_rate if out.growth_rate is not None else params.general_inflation
                target_expenses += out.amount * ((1 + rate) ** years_passed)

        # 3. INCOME BUCKETS
        inc_tracker = {
            "w2_income": 0, "rental_income": 0, "royalty_income": 0,
            "dividend_income": 0, "social_security": 0, "retirement_withdrawals": 0,
            "brokerage_withdrawals": 0, "bitcoin_withdrawals": 0, "roth_withdrawals": 0,
            "other_income": 0
        }
        
        # A. Inflows
        for stream in params.inflows:
            if stream.start_year <= year <= stream.end_year:
                rate = stream.growth_rate if stream.growth_rate is not None else params.general_inflation
                amt = stream.amount * ((1 + rate) ** years_passed)
                
                nl = stream.name.lower()
                if "w2" in nl or "salary" in nl: inc_tracker["w2_income"] += amt
                elif "rental" in nl: 
                    inc_tracker["rental_income"] += amt * rental_portfolio_pct
                elif "royalt" in nl: inc_tracker["royalty_income"] += amt
                elif "social" in nl: inc_tracker["social_security"] += amt
                else: inc_tracker["other_income"] += amt

        # B. Dividends
        div_base = sum(v for n, v in portfolio.items() if asset_types[n] in ['taxable', 'roth'])
        inc_tracker["dividend_income"] = div_base * 0.02
        
        # C. RMDs
        rmd_total = 0
        div = get_rmd_divisor(age)
        if div > 0:
            for n, v in portfolio.items():
                if asset_types[n] == 'pre_tax' and v > 0:
                    rmd = v / div
                    portfolio[n] -= rmd
                    rmd_total += rmd
        inc_tracker["retirement_withdrawals"] += rmd_total

        # 4. TAX CALCULATION (Initial)
        taxable_income = (inc_tracker["w2_income"] + inc_tracker["rental_income"] + 
                          inc_tracker["royalty_income"] + inc_tracker["dividend_income"] + 
                          inc_tracker["social_security"] + inc_tracker["retirement_withdrawals"] + 
                          inc_tracker["other_income"])
        
        tax_bill = calculate_federal_tax(taxable_income, years_passed=years_passed, inflation=params.general_inflation)
        mandatory_net = taxable_income - tax_bill
        
        # 5. GAP ANALYSIS
        surplus = mandatory_net - target_expenses
        
        # Check if we successfully funded the year
        # (Start assuming we have a deficit, prove otherwise)
        fully_funded = False

        if surplus >= 0:
            # Reinvest Surplus
            target = next((n for n, t in asset_types.items() if t == 'taxable' and 'bitcoin' not in n.lower()), None)
            if not target: target = next((n for n, t in asset_types.items() if t == 'taxable'), None)
            if target: portfolio[target] += surplus
            fully_funded = True
            
        else:
            # DEFICIT
            needed = abs(surplus)
            
            # 1. Brokerage Stocks
            if needed > 0:
                for n, v in portfolio.items():
                    if asset_types[n] == 'taxable' and 'bitcoin' not in n.lower() and v > 0:
                        gross = needed / 0.85
                        take = min(gross, v)
                        portfolio[n] -= take
                        inc_tracker["brokerage_withdrawals"] += take
                        needed -= (take * 0.85)
                        if needed <= 0.1: break # Use small epsilon for float precision
            
            # 2. Bitcoin
            if needed > 0.1:
                for n, v in portfolio.items():
                    if 'bitcoin' in n.lower() and v > 0:
                        gross = needed / 0.85
                        take = min(gross, v)
                        portfolio[n] -= take
                        inc_tracker["bitcoin_withdrawals"] += take
                        needed -= (take * 0.85)
                        if needed <= 0.1: break

            # 3. 401k/IRA
            if needed > 0.1 and age >= params.retirement_withdrawal_age:
                 for n, v in portfolio.items():
                    if asset_types[n] == 'pre_tax' and v > 0:
                        gross = needed / 0.75 
                        take = min(gross, v)
                        portfolio[n] -= take
                        inc_tracker["retirement_withdrawals"] += take
                        taxable_income += take
                        needed -= (take * 0.75)
                        if needed <= 0.1: break
            
            # 4. Rental Equity
            if needed > 0.1:
                for n, v in portfolio.items():
                    if asset_types[n] == 'real_estate' and 'primary' not in n.lower() and v > 0:
                        gross = needed / 0.85
                        take = min(gross, v)
                        
                        pre_sale_value = v + take 
                        portfolio[n] -= take
                        if pre_sale_value > 0:
                            pct_sold = take / pre_sale_value
                            rental_portfolio_pct *= (1 - pct_sold)
                        
                        inc_tracker["brokerage_withdrawals"] += take 
                        needed -= (take * 0.85)
                        if needed <= 0.1: break

            # 5. Roth
            if needed > 0.1:
                for n, v in portfolio.items():
                    if asset_types[n] == 'roth' and v > 0:
                        take = min(needed, v)
                        portfolio[n] -= take
                        inc_tracker["roth_withdrawals"] += take
                        needed -= take
                        if needed <= 0.1: break
            
            # If we reduced 'needed' to effectively 0, we are fully funded
            if needed <= 1.0: # Allow $1 tolerance
                fully_funded = True
        
        # 6. RE-CALCULATE TAXES (Final)
        final_tax = calculate_federal_tax(taxable_income, years_passed=years_passed, inflation=params.general_inflation)
        effective_tax_rate = final_tax / taxable_income if taxable_income > 0 else 0
        
        # 7. CHART DATA
        after_tax = {
            "w2_income_after_tax": inc_tracker["w2_income"] * (1 - effective_tax_rate),
            "rental_income_after_tax": inc_tracker["rental_income"] * (1 - effective_tax_rate),
            "royalty_income_after_tax": inc_tracker["royalty_income"] * (1 - effective_tax_rate),
            "dividend_income_after_tax": inc_tracker["dividend_income"] * (1 - effective_tax_rate),
            "social_security_after_tax": inc_tracker["social_security"] * (1 - effective_tax_rate),
            "retirement_withdrawals_after_tax": inc_tracker["retirement_withdrawals"] * (1 - effective_tax_rate),
            "brokerage_withdrawals_after_tax": inc_tracker["brokerage_withdrawals"] * 0.85, 
            "bitcoin_withdrawals_after_tax": inc_tracker["bitcoin_withdrawals"] * 0.85,
            "roth_withdrawals_after_tax": inc_tracker["roth_withdrawals"],
        }
        
        # *** NORMALIZATION FIX ***
        # Only normalize if we are SOLVENT (fully funded).
        # If we ran out of money (needed > 1.0), do NOT normalize. Let the gap show.
        if surplus < 0 and fully_funded:
            current_total = sum(after_tax.values())
            if current_total > 0:
                correction_ratio = target_expenses / current_total
                for k in after_tax:
                    after_tax[k] *= correction_ratio

        # 8. ASSETS
        asset_bk = {
            "retirement_traditional": sum(v for n, v in portfolio.items() if asset_types[n] == 'pre_tax'),
            "retirement_roth": sum(v for n, v in portfolio.items() if asset_types[n] == 'roth'),
            "brokerage": sum(v for n, v in portfolio.items() if asset_types[n] == 'taxable' and 'bitcoin' not in n.lower()),
            "bitcoin": sum(v for n, v in portfolio.items() if 'bitcoin' in n.lower()),
            "rental_properties": sum(v for n, v in portfolio.items() if asset_types[n] == 'real_estate' and 'primary' not in n.lower()),
            "primary_home": sum(v for n, v in portfolio.items() if 'primary' in n.lower())
        }
        
        total_assets = sum(portfolio.values())
        
        # Freedom Check
        passive_gross = (inc_tracker["rental_income"] + inc_tracker["dividend_income"] + 
                         inc_tracker["royalty_income"] + inc_tracker["social_security"] + 
                         inc_tracker["retirement_withdrawals"])
        if passive_gross * (1 - effective_tax_rate) > target_expenses and not freedom_achieved:
            freedom_achieved = True
            freedom_year = year

        timeline.append({
            "year": year,
            "age": age,
            "nominal_net_worth": round(total_assets, 0),
            "real_net_worth": round(total_assets / inflation_mult, 0),
            "total_expenses": round(target_expenses, 0),
            **after_tax,
            **asset_bk
        })
        
        for n, v in portfolio.items():
            gr = next(a.growth_rate for a in params.assets if a.name == n)
            portfolio[n] = v * (1 + gr)
            
        year += 1
        age += 1

    return {
        "timeline": timeline,
        "freedom_year": freedom_year,
        "metrics": {
            "nw_at_retirement": next((x for x in timeline if x['age'] == params.target_retirement_age), None),
            "nw_at_90": next((x for x in timeline if x['age'] == 90), None)
        }
    }