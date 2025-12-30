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

# --- HELPER: FEDERAL TAX CALCULATOR (Base-year brackets, inflated forward) ---
def calculate_federal_tax(taxable_income: float, years_passed: int = 0, inflation: float = 0.0) -> float:
    """Estimate federal tax while avoiding bracket creep.

    We treat the bracket thresholds + standard deduction as being indexed to inflation,
    so that *real* income doesn't drift into higher brackets just because the model
    inflates nominal dollars over time.
    """

    inflation_factor = (1 + (inflation or 0.0)) ** max(0, years_passed)

    # Base-year (2025-ish) values used by this model.
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

    # If income exceeds the last bracket threshold, apply the top rate to the remainder.
    if income > prev_limit:
        tax += (income - prev_limit) * 0.37

    return tax

# --- HELPER: RMD FACTOR (IRS Uniform Lifetime Table) ---
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
    
    # Init Portfolio
    portfolio = {a.name: a.value for a in params.assets}
    asset_types = {a.name: a.tax_treatment for a in params.assets}
    
    # Track what percentage of rental portfolio remains (for scaling rental income)
    initial_rental_value = sum(a.value for a in params.assets if a.tax_treatment == 'real_estate' and 'primary' not in a.name.lower())
    rental_portfolio_pct = 1.0  # Start at 100%
    
    year = params.current_year
    age = params.current_age
    freedom_achieved = False
    freedom_year = None
    
    # Track rental equity specifically for the logic of "Selling Rentals"
    # We assume 'Rental Portfolio' is the key name for the big bucket
    
    while age <= 95:
        years_passed = year - params.current_year
        inflation_mult = (1 + params.general_inflation) ** years_passed
        
        # 1. ADD ONE-TIME ASSETS
        for oa in params.other_assets:
            if oa.add_year == year and oa.value > 0:
                # Add to first taxable brokerage account found
                target = next((n for n, t in asset_types.items() if t == 'taxable'), None)
                if target: portfolio[target] += oa.value

        # 2. CALCULATE TARGET EXPENSES
        target_expenses = 0
        for out in params.outflows:
            if out.start_year <= year <= out.end_year:
                rate = out.growth_rate if out.growth_rate is not None else params.general_inflation
                target_expenses += out.amount * ((1 + rate) ** years_passed)

        # 3. INCOME BUCKETS (Trackers for the chart)
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
                
                # Categorize
                nl = stream.name.lower()
                if "w2" in nl or "salary" in nl: inc_tracker["w2_income"] += amt
                elif "rental" in nl: 
                    # Scale rental income by remaining portfolio percentage
                    inc_tracker["rental_income"] += amt * rental_portfolio_pct
                elif "royalt" in nl: inc_tracker["royalty_income"] += amt
                elif "social" in nl: inc_tracker["social_security"] += amt
                else: inc_tracker["other_income"] += amt

        # B. Dividends (2% of Taxable/Roth assets)
        div_base = sum(v for n, v in portfolio.items() if asset_types[n] in ['taxable', 'roth'])
        inc_tracker["dividend_income"] = div_base * 0.02
        
        # C. RMDs (Mandatory)
        rmd_total = 0
        div = get_rmd_divisor(age)
        if div > 0:
            for n, v in portfolio.items():
                if asset_types[n] == 'pre_tax' and v > 0:
                    rmd = v / div
                    portfolio[n] -= rmd
                    rmd_total += rmd
        inc_tracker["retirement_withdrawals"] += rmd_total

        # 4. TAX CALCULATION (On Mandatory Income)
        # Note: We treat W2, Rent, Royalty, SS, Divs, and RMDs as taxable for simplicity
        taxable_income = (inc_tracker["w2_income"] + inc_tracker["rental_income"] + 
                          inc_tracker["royalty_income"] + inc_tracker["dividend_income"] + 
                          inc_tracker["social_security"] + inc_tracker["retirement_withdrawals"] + 
                          inc_tracker["other_income"])
        
        tax_bill = calculate_federal_tax(taxable_income, years_passed=years_passed, inflation=params.general_inflation)
        mandatory_net = taxable_income - tax_bill
        
        # 5. GAP ANALYSIS
        surplus = mandatory_net - target_expenses
        
        if surplus >= 0:
            # Reinvest Surplus into Brokerage
            target = next((n for n, t in asset_types.items() if t == 'taxable' and 'bitcoin' not in n.lower()), None)
            if not target: target = next((n for n, t in asset_types.items() if t == 'taxable'), None) # Fallback to BTC if no brokerage
            if target: portfolio[target] += surplus
            
        else:
            # DEFICIT - WITHDRAWAL WATERFALL
            needed = abs(surplus)
            
            # Helper to withdraw
            def pull(bucket_type, tax_rate, tracker_key, specific_name_check=None):
                nonlocal needed, taxable_income
                candidates = [n for n, t in asset_types.items() if t == bucket_type]
                
                for name in candidates:
                    if needed <= 0: break
                    if specific_name_check and specific_name_check not in name.lower(): continue
                    
                    val = portfolio[name]
                    if val <= 0: continue
                    
                    gross = needed / (1 - tax_rate)
                    if val >= gross:
                        portfolio[name] -= gross
                        inc_tracker[tracker_key] += gross
                        needed = 0
                        # If it's 401k, it adds to taxable income
                        if bucket_type == 'pre_tax': taxable_income += gross 
                    else:
                        # Take all
                        net = val * (1 - tax_rate)
                        portfolio[name] = 0
                        inc_tracker[tracker_key] += val
                        needed -= net
                        if bucket_type == 'pre_tax': taxable_income += val

            # 1. Brokerage (Taxable, Non-Bitcoin) -> 15% LTCG
            pull('taxable', 0.15, "brokerage_withdrawals", specific_name_check=None) # Note: Logic below separates BTC
            
            # *Correction for Bitcoin separation in 'taxable' bucket*: 
            # The simple helper above doesn't distinguish BTC well. Let's do it manually for precision.
            
            # A. Brokerage (Stocks)
            if needed > 0:
                for n, v in portfolio.items():
                    if asset_types[n] == 'taxable' and 'bitcoin' not in n.lower() and v > 0:
                        gross = needed / 0.85
                        take = min(gross, v)
                        portfolio[n] -= take
                        inc_tracker["brokerage_withdrawals"] += take
                        needed -= (take * 0.85)
                        if needed <= 0: break
            
            # B. Bitcoin
            if needed > 0:
                for n, v in portfolio.items():
                    if 'bitcoin' in n.lower() and v > 0:
                        gross = needed / 0.85
                        take = min(gross, v)
                        portfolio[n] -= take
                        inc_tracker["bitcoin_withdrawals"] += take
                        needed -= (take * 0.85)
                        if needed <= 0: break

            # C. 401k/IRA (If allowed age)
            if needed > 0 and age >= params.retirement_withdrawal_age:
                 for n, v in portfolio.items():
                    if asset_types[n] == 'pre_tax' and v > 0:
                        gross = needed / 0.75 # Assume 25% tax
                        take = min(gross, v)
                        portfolio[n] -= take
                        inc_tracker["retirement_withdrawals"] += take
                        taxable_income += take
                        needed -= (take * 0.75)
                        if needed <= 0: break
            
            # D. Rental Equity (Sell Property)
            if needed > 0:
                for n, v in portfolio.items():
                    if asset_types[n] == 'real_estate' and 'primary' not in n.lower() and v > 0:
                        gross = needed / 0.85
                        take = min(gross, v)
                        
                        # Track percentage sold to reduce future rental income
                        pre_sale_value = v
                        portfolio[n] -= take
                        if pre_sale_value > 0:
                            pct_sold = take / pre_sale_value
                            rental_portfolio_pct *= (1 - pct_sold)
                        
                        inc_tracker["brokerage_withdrawals"] += take # Treat sale as brokerage event for chart
                        needed -= (take * 0.85)
                        if needed <= 0: break

            # E. Roth
            if needed > 0:
                for n, v in portfolio.items():
                    if asset_types[n] == 'roth' and v > 0:
                        take = min(needed, v)
                        portfolio[n] -= take
                        inc_tracker["roth_withdrawals"] += take
                        needed -= take
                        if needed <= 0: break
        
        # 6. RE-CALCULATE TAXES (With final withdrawals included)
        final_tax = calculate_federal_tax(taxable_income, years_passed=years_passed, inflation=params.general_inflation)
        effective_tax_rate = final_tax / taxable_income if taxable_income > 0 else 0
        
        # 7. PREPARE CHART DATA (After-Tax versions)
        # We apply the effective tax rate to ordinary income, and 15% to Cap Gains
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
        
        # 8. ASSET BREAKDOWN FOR CHART
        asset_bk = {
            "retirement_traditional": sum(v for n, v in portfolio.items() if asset_types[n] == 'pre_tax'),
            "retirement_roth": sum(v for n, v in portfolio.items() if asset_types[n] == 'roth'),
            "brokerage": sum(v for n, v in portfolio.items() if asset_types[n] == 'taxable' and 'bitcoin' not in n.lower()),
            "bitcoin": sum(v for n, v in portfolio.items() if 'bitcoin' in n.lower()),
            "rental_properties": sum(v for n, v in portfolio.items() if asset_types[n] == 'real_estate' and 'primary' not in n.lower()),
            "primary_home": sum(v for n, v in portfolio.items() if 'primary' in n.lower())
        }
        
        total_assets = sum(portfolio.values())
        
        # 9. FREEDOM CHECK
        passive_gross = (inc_tracker["rental_income"] + inc_tracker["dividend_income"] + 
                         inc_tracker["royalty_income"] + inc_tracker["social_security"] + 
                         inc_tracker["retirement_withdrawals"]) # RMDs count as passive flow
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
        
        # 10. GROW ASSETS FOR NEXT YEAR
        for n, v in portfolio.items():
            # Find growth rate from original params
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