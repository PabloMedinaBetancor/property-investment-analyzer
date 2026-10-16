#!/usr/bin/env python3
"""Reference values for the Property Investment Analyzer (independent of the Rust and TS code).

Implements the conventions of docs/how-it-works.md literally, in plain Python (standard library only), and writes
tests/fixtures/*.json: the known answers the Rust unit tests, the TS tests and the WASM/JS parity test check against.
Run:  python3 -I tools/reference.py      (rewrites tests/fixtures/ and prints the checks)
Every hand-known value (textbook payments, IRR of simple flows, Excel documentation examples) is asserted here, so
the script checks itself before it writes anything.
"""
import json, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ES = json.load(open(os.path.join(ROOT, 'data', 'es-2026.json'), encoding='utf-8'))
OUT = os.path.join(ROOT, 'tests', 'fixtures')
M32 = 0xFFFFFFFF


# ----------------------------------------------------------------- schedules (taxes, fees)
def schedule(kind, brackets, base):
    if base <= 0:
        return 0.0
    if kind == 'flat':
        return base * brackets
    if kind == 'band':
        rate = [b['rate'] for b in brackets if b['from'] <= base][-1]
        return base * rate
    if kind == 'progressive':
        tax = 0.0
        for k, b in enumerate(brackets):
            hi = brackets[k + 1]['from'] if k + 1 < len(brackets) else math.inf
            if base > b['from']:
                tax += (min(base, hi) - b['from']) * b['rate']
        return tax
    raise ValueError(kind)


def region(code):
    return next(r for r in ES['regions'] if r['code'] == code)


def transfer_tax(code, value, new_build=False, price=None):
    """value is the taxable base (the greater of price and reference value); VAT / IGIC on a new build is charged on the price."""
    r = region(code)
    if new_build:
        vat = r.get('new_build_vat', ES['new_build_vat_default']['rate'])
        return (value if price is None else price) * vat + value * r['new_build_stamp']
    s = r['resale']
    return schedule(s['kind'], s.get('rate', s.get('brackets')), value)


def fee_scale(spec, base):
    base = min(base, spec.get('cap_base', math.inf))
    fee = spec['base_fee']
    br = spec['brackets']
    for k, b in enumerate(br):
        hi = br[k + 1]['from'] if k + 1 < len(br) else math.inf
        if base > b['from']:
            fee += (min(base, hi) - b['from']) * b['per_mille'] / 1000.0
    return fee


def notary(price, extras):
    return (fee_scale(ES['fees']['notary_purchase'], price) + extras) * 1.21


def registry(price):
    s = ES['fees']['registry_purchase']
    f = min(max(fee_scale(s, price), s['min']), s['max'])
    return f * (1 - s['rebate']) * 1.21


def cgt_es(gain):
    s = ES['income_tax']['capital_gains_scale']
    return schedule('progressive', s['brackets'], gain) if gain > 0 else 0.0


# ----------------------------------------------------------------- mortgage
def pmt(balance, i, n):
    if n <= 0:
        return 0.0
    if i == 0:
        return balance / n
    return balance * i / (1 - (1 + i) ** -n)


def loan_schedule(L, term_years, kind, fixed_rate=None, spread=None, index_by_year=None, fixed_years=0):
    """Monthly French schedule. index_by_year[t-1] = index for loan year t. Returns month rows and annual rate list."""
    n_total = 12 * term_years
    B = L
    rows, rates = [], []
    p = None
    for t in range(1, term_years + 1):
        if kind == 'fixed' or (kind == 'mixed' and t <= fixed_years):
            rate = fixed_rate
        else:
            rate = max(0.0, index_by_year[t - 1] + spread)
        rates.append(rate)
        i = rate / 12
        remaining = n_total - 12 * (t - 1)
        if p is None or kind != 'fixed':
            p = pmt(B, i, remaining)
        for m in range(12):
            interest = B * i
            principal = p - interest
            B -= principal
            rows.append({'month': 12 * (t - 1) + m + 1, 'payment': p, 'interest': interest, 'principal': principal,
                         'balance': B})
    return rows, rates


# ----------------------------------------------------------------- metrics
def npv(rate, flows):
    return sum(cf / (1 + rate) ** t for t, cf in enumerate(flows))


def sign_changes(flows):
    s = [1 if x > 0 else -1 for x in flows if x != 0]
    return sum(1 for a, b in zip(s, s[1:]) if a != b)


GRID = [round(-0.99 + 0.01 * k, 10) for k in range(0, 200)] + [round(1.0 + 0.1 * k, 10) for k in range(0, 91)]


def irr(flows):
    if sign_changes(flows) == 0:
        return {'kind': 'None', 'reason': 'NoSignChange'}
    roots = []
    vals = [npv(r, flows) for r in GRID]
    scale = max(abs(x) for x in flows)
    for k, r in enumerate(GRID):
        if vals[k] == 0:
            roots.append(r)
        if k + 1 < len(GRID) and vals[k] * vals[k + 1] < 0:
            a, b, fa = r, GRID[k + 1], vals[k]
            for _ in range(200):
                mid = (a + b) / 2
                fm = npv(mid, flows)
                if fm == 0 or (b - a) / 2 < 1e-15:
                    break
                if fa * fm < 0:
                    b = mid
                else:
                    a, fa = mid, fm
            roots.append((a + b) / 2)
    roots = sorted(set(round(x, 12) for x in roots))
    if not roots:
        return {'kind': 'None', 'reason': 'OutOfRange'}
    if len(roots) == 1:
        return {'kind': 'Unique', 'rate': roots[0]}
    return {'kind': 'Multiple', 'rates': roots}


def mirr(flows, finance, reinvest):
    N = len(flows) - 1
    fv = sum(cf * (1 + reinvest) ** (N - t) for t, cf in enumerate(flows) if cf > 0)
    pv = sum(cf / (1 + finance) ** t for t, cf in enumerate(flows) if cf < 0)
    if fv == 0 or pv == 0:
        return None
    return (fv / -pv) ** (1.0 / N) - 1


def payback(cf0, operating):
    cum = cf0
    if cum >= 0:
        return 0.0
    for t, cf in enumerate(operating, start=1):
        if cum + cf >= 0:
            return (t - 1) + (-cum) / cf
        cum += cf
    return None


def percentile7(xs, p):
    s = sorted(xs)
    h = (len(s) - 1) * p
    lo = math.floor(h)
    frac = h - lo
    if frac == 0 or lo + 1 >= len(s):
        return s[lo]
    if s[lo] == -math.inf:          # next to the bottom sentinel the percentile is still «below»
        return -math.inf
    if s[lo + 1] == math.inf:
        return math.inf
    return s[lo] + frac * (s[lo + 1] - s[lo])


def histogram(xs, bins=30):
    """NPV histogram: 30 equal bins between P1 and P99 (type 7); outside counted as below/above."""
    lo, hi = percentile7(xs, 0.01), percentile7(xs, 0.99)
    counts, below, above = [0] * bins, 0, 0
    for x in xs:
        if x < lo:
            below += 1
        elif x > hi:
            above += 1
        elif hi == lo:
            counts[0] += 1
        else:
            counts[min(bins - 1, int((x - lo) / (hi - lo) * bins))] += 1
    return {'edges': [lo + (hi - lo) * k / bins for k in range(bins + 1)], 'counts': counts, 'below': below, 'above': above}


# ----------------------------------------------------------------- PRNG (docs/how-it-works.md §7)
class Rng:
    def __init__(self, seed):
        st = seed & M32
        self.s = []
        for _ in range(4):
            st = (st + 0x9E3779B9) & M32
            z = st
            z = ((z ^ (z >> 16)) * 0x85EBCA6B) & M32
            z = ((z ^ (z >> 13)) * 0xC2B2AE35) & M32
            z ^= z >> 16
            self.s.append(z)

    def next_u32(self):
        s0, s1, s2, s3 = self.s
        rotl = lambda x, k: ((x << k) | (x >> (32 - k))) & M32
        result = (rotl((s1 * 5) & M32, 7) * 9) & M32
        t = (s1 << 9) & M32
        s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = rotl(s3, 11)
        self.s = [s0, s1, s2, s3]
        return result

    def uniform(self):
        a, b = self.next_u32(), self.next_u32()
        return ((a >> 5) * 67108864 + (b >> 6)) / 9007199254740992.0

    def normal_pair(self):
        u1, u2 = self.uniform(), self.uniform()
        rho = math.sqrt(-2.0 * math.log(1.0 - u1))
        return rho * math.cos(2 * math.pi * u2), rho * math.sin(2 * math.pi * u2)


def cholesky(R):
    n = len(R)
    L = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1):
            s = sum(L[i][k] * L[j][k] for k in range(j))
            if i == j:
                d = R[i][i] - s
                if d <= 0:
                    raise ValueError('correlation matrix not positive definite')
                L[i][j] = math.sqrt(d)
            else:
                L[i][j] = (R[i][j] - s) / L[j][j]
    return L


# ----------------------------------------------------------------- income tax (docs/how-it-works.md §5)
def spain_tax_year(t, income, interest, repairs, other_deductible, amortisation, carry, marginal, reduction, offset):
    """One year of the Spanish rules. carry = [(origin year, unused capped amount)]. Returns (tax, new carry)."""
    cur = interest + repairs
    cap = income
    used = 0.0
    carry = [(y, amt) for (y, amt) in carry if y >= t - 4]
    newcarry = []
    for (y, amt) in carry:
        u = min(amt, cap - used)
        used += u
        if amt - u > 1e-12:
            newcarry.append((y, amt - u))
    u = min(cur, cap - used)
    used += u
    if cur - u > 1e-12:
        newcarry.append((t, cur - u))
    net = income - used - (other_deductible + amortisation)
    if net > 0:
        return marginal * net * (1 - reduction), newcarry
    return (marginal * net if offset else 0.0), newcarry


def spain_amortisation(per_year, basis, taken):
    """3 % a year until the construction basis is used up (RIRPF art. 14)."""
    return min(per_year, max(0.0, basis - taken))


def generic_tax_year(collected, interest, opex, dep, rate, interest_deductible, offset):
    net = collected - (interest if interest_deductible else 0.0) - opex - dep
    return rate * net if (net > 0 or offset) else 0.0


def generic_depreciation(per_year, years, t):
    return per_year * max(0.0, min(1.0, years - (t - 1))) if per_year else 0.0


def generic_exit_tax(gain, dep_taken, recapture_rate, cg_rate):
    recapture = min(max(gain, 0.0), dep_taken)
    return recapture * recapture_rate + max(0.0, gain - dep_taken) * cg_rate


# ----------------------------------------------------------------- the pro forma (docs/how-it-works.md §1-6)
def fees0(x):
    """No loan, no arrangement or valuation fees."""
    return x['loan_fees'] if x['ltv'] > 0 else 0.0


def acquisition(x):
    P = x['price']
    if x.get('profile') == 'generic':
        g = x['purchase']
        tt = g['transfer_tax_rate'] * P
        acq = tt + g['closing_cost_rate'] * P + g['closing_cost_fixed'] + g['buyer_agency_rate'] * P
        L = x['ltv'] * P
        TI = P + acq + x['renovation']
        return {'transfer_tax': tt, 'acq_costs': acq, 'loan': L, 'total_investment': TI, 'equity0': TI + fees0(x) - L}
    tv = max(P, x.get('reference_value') or 0)
    if x.get('manual_transfer_rate') is not None:
        # a typed rate on a new build stands in for VAT / IGIC / IPSI, which are charged on the price
        tt = x['manual_transfer_rate'] * (P if x['new_build'] else tv)
    else:
        tt = transfer_tax(x['region'], tv, x['new_build'], P)
    fees = notary(P, x['notary_extras']) + registry(P) + x['gestoria'] + x['buyer_agency_rate'] * P
    acq = tt + fees
    L = x['ltv'] * P
    TI = P + acq + x['renovation']
    E0 = TI + fees0(x) - L
    return {'transfer_tax': tt, 'notary': notary(P, x['notary_extras']), 'registry': registry(P), 'acq_costs': acq,
            'loan': L, 'total_investment': TI, 'equity0': E0}


def proforma(x, path=None):
    """path (MC): dict of per-year lists index[t], g_rent[t], g_exp[t], g_app[t], vac[t]; t = 1..N (index 0 unused)."""
    N = x['years']
    a = acquisition(x)
    P, L = x['price'], a['loan']
    loan = x['loan']
    term = loan['term_years']
    if path:
        idx = [path['index'][t] for t in range(1, max(term, N) + 1)]
    else:
        idx = (loan.get('index_path') or []) + [loan.get('index', 0.0)] * max(term, N)
    rows, rates = loan_schedule(L, term, loan['kind'], loan.get('fixed_rate'), loan.get('spread'), idx,
                                loan.get('fixed_years', 0)) if L > 0 else ([], [])
    tax_on = x['tax']['on']
    generic = x.get('profile') == 'generic'
    basis = P + a['acq_costs'] + x['renovation']
    if generic:
        dy = x['tax'].get('depreciation_years', 0)
        amort = x['tax'].get('building_share', 0) * basis / dy if (tax_on and dy) else 0.0
    else:
        amort = 0.03 * x['tax'].get('construction_share', 0.6) * basis if tax_on else 0.0
    amort_taken = 0.0
    carry = []                                   # [(year, amount)]
    years = []
    rent = 12 * x['rent_month']
    fixed = x['ibi'] + x['community'] + x['insurance'] + x['other_fixed']
    value = x.get('value0') or P
    for t in range(1, N + 1):
        if t > 1:
            rent *= 1 + (path['g_rent'][t] if path else x['g_rent'])
            fixed *= 1 + (path['g_exp'][t] if path else x['g_exp'])
        ptax = x.get('property_tax_rate', 0.0) * value          # on the value at the start of the year
        value *= 1 + (path['g_app'][t] if path else x['g_app'])
        v = path['vac'][t] if path else x['vacancy']
        collected = rent * (1 - v)
        maint = x['maintenance_rate'] * rent
        mgmt = x['management_rate'] * collected
        opex = fixed + ptax + maint + mgmt
        noi = collected - opex
        mrows = rows[12 * (t - 1):12 * t]
        interest = sum(r['interest'] for r in mrows)
        principal = sum(r['principal'] for r in mrows)
        balance = mrows[-1]['balance'] if mrows else (rows[-1]['balance'] if rows else 0.0)
        ds = interest + principal
        cf_pre = noi - ds
        tax = 0.0
        if tax_on and generic:
            dep = generic_depreciation(amort, x['tax']['depreciation_years'], t)
            amort_taken += dep
            tax = generic_tax_year(collected, interest, opex, dep, x['tax']['rate'], x['tax']['interest_deductible'],
                                   x['tax']['offset_losses'])
        elif tax_on:
            a_t = spain_amortisation(amort, x['tax'].get('construction_share', 0.6) * basis, amort_taken)
            amort_taken += a_t
            tax, carry = spain_tax_year(t, collected, interest, maint, fixed + ptax + mgmt, a_t, carry,
                                        x['tax']['marginal'], x['tax']['reduction'], x['tax']['offset_other_income'])
        cf_post = cf_pre - tax
        if t == 1:
            first = {'fixed': fixed + ptax, 'maint': maint, 'mgmt_rate': x['management_rate'], 'ds': ds}
        years.append({'t': t, 'rent_gross': rent, 'vacancy': v, 'rent_collected': collected, 'opex': opex, 'noi': noi,
                      'interest': interest, 'principal': principal, 'debt_service': ds, 'loan_rate': rates[t - 1] if t <= len(rates) else 0.0,
                      'balance_end': balance, 'cf_pre_tax': cf_pre, 'tax': tax, 'cf_after_tax': cf_post,
                      'value_end': value})
    sale_costs = value * x['sell_rate'] + x['municipal_gain_tax']
    bal = years[-1]['balance_end']
    gain = value - sale_costs - (basis - amort_taken)
    if not tax_on:
        cgt = 0.0
    elif generic:
        cgt = generic_exit_tax(gain, amort_taken, x['tax']['depreciation_recapture_rate'], x['tax']['capital_gains_rate'])
    else:
        cgt = cgt_es(gain)
    exit_pre = value - sale_costs - bal
    exit_post = exit_pre - cgt
    key = 'cf_after_tax' if tax_on else 'cf_pre_tax'
    flows = [-a['equity0']] + [y[key] for y in years]
    flows[-1] += exit_post
    flows_pre = [-a['equity0']] + [y['cf_pre_tax'] for y in years]
    flows_pre[-1] += exit_pre
    cum, c = [], 0.0
    for f in flows:
        c += f
        cum.append(c)
    d = x['discount_rate']
    res = {'acquisition': a, 'years': years,
           'exit': {'value': value, 'sale_costs': sale_costs, 'loan_payoff': bal, 'gain': gain, 'cgt': cgt,
                    'equity_back_pre_tax': exit_pre, 'equity_back_after_tax': exit_post},
           'flows': flows, 'flows_pre_tax': flows_pre, 'cumulative': cum,
           'metrics': {'gross_yield': 12 * x['rent_month'] / P, 'net_yield': years[0]['noi'] / a['total_investment'],
                       'cap_rate': years[0]['noi'] / P, 'cash_on_cash_1': years[0][key] / a['equity0'],
                       'npv': npv(d, flows), 'irr': irr(flows), 'irr_pre_tax': irr(flows_pre),
                       'mirr': mirr(flows, d, d), 'payback_years': payback(flows[0], [y[key] for y in years]),
                       'dscr': years[0]['noi'] / first['ds'] if first['ds'] else None,
                       'grm': P / years[0]['rent_gross'],
                       'one_percent_ratio': x['rent_month'] / (P + x['renovation']),
                       'break_even_occupancy': (first['fixed'] + first['maint'] + first['ds']) / (years[0]['rent_gross'] * (1 - first['mgmt_rate']))}}
    if tax_on:
        res['amortisation_taken'] = amort_taken
    return res


DEFAULT_MC = {'kappa': 0.15, 'sigma_index': 0.008, 'sigma_rent': 0.02, 'sigma_app': 0.05, 'sigma_exp': 0.01,
              'corr': [[1, 0, 0, 0.3], [0, 1, 0.5, 0.4], [0, 0.5, 1, 0.2], [0.3, 0.4, 0.2, 1]]}


def monte_carlo(x, n, seed, mc=DEFAULT_MC):
    rng = Rng(seed)
    Lc = cholesky(mc['corr'])
    N = x['years']
    T = max(N, x['loan']['term_years'])
    e0 = x['loan'].get('index', 0.0)
    irrs, npvs, cums, n_multi, n_bottom, n_top = [], [], [], 0, 0, 0
    for s in range(n):
        path = {'index': [e0] * (T + 1), 'g_rent': [0.0] * (N + 1), 'g_exp': [0.0] * (N + 1), 'g_app': [0.0] * (N + 1),
                'vac': [0.0] * (N + 1)}
        e = e0
        for t in range(1, N + 1):
            a1, a2 = rng.normal_pair()
            a3, a4 = rng.normal_pair()
            eps = [a1, a2, a3, a4]
            z = [sum(Lc[i][k] * eps[k] for k in range(i + 1)) for i in range(4)]
            if t >= 2:
                e = e + mc['kappa'] * (e0 - e) + mc['sigma_index'] * z[0]
            path['index'][t] = e
            path['g_rent'][t] = max(-0.99, x['g_rent'] + mc['sigma_rent'] * z[1])
            path['g_app'][t] = max(-0.99, x['g_app'] + mc['sigma_app'] * z[2])
            path['g_exp'][t] = max(-0.99, x['g_exp'] + mc['sigma_exp'] * z[3])
            k = sum(1 for _ in range(12) if rng.uniform() < x['vacancy'])
            path['vac'][t] = k / 12
        for t in range(N + 1, T + 1):
            path['index'][t] = e                 # beyond the holding period the loan is repaid; value unused
        r = proforma(x, path)
        f = r['flows']
        npvs.append(r['metrics']['npv'])
        cums.append(r['cumulative'])
        ir = r['metrics']['irr']
        if ir['kind'] == 'Unique':
            irrs.append(ir['rate'])
        elif ir['kind'] == 'Multiple':
            n_multi += 1
        elif sum(f) < 0:
            irrs.append(-math.inf); n_bottom += 1
        else:
            irrs.append(math.inf); n_top += 1
    ps = (0.1, 0.5, 0.9)
    return {'n': n, 'seed': seed, 'irr_p': [percentile7(irrs, p) for p in ps], 'npv_p': [percentile7(npvs, p) for p in ps],
            'p_npv_negative': sum(1 for v in npvs if v < 0) / n,
            'cum_p_by_year': [[percentile7([c[t] for c in cums], p) for p in ps] for t in range(N + 1)],
            'irr_multiple_count': n_multi, 'irr_bottom_count': n_bottom, 'irr_top_count': n_top,
            'npv_histogram': histogram(npvs)}


# ----------------------------------------------------------------- cases
F1 = {'name': 'F1 fictional resale flat, Madrid, fixed loan, tax on', 'region': 'MD', 'new_build': False, 'price': 180000,
      'reference_value': None, 'manual_transfer_rate': None, 'notary_extras': 300, 'gestoria': 350, 'buyer_agency_rate': 0.0,
      'loan_fees': 400, 'renovation': 15000, 'ltv': 0.7,
      'loan': {'kind': 'fixed', 'fixed_rate': 0.032, 'term_years': 25},
      'rent_month': 950, 'vacancy': 0.05, 'ibi': 450, 'community': 720, 'insurance': 250, 'other_fixed': 0,
      'maintenance_rate': 0.05, 'management_rate': 0.0, 'g_rent': 0.02, 'g_exp': 0.02, 'g_app': 0.02, 'years': 10,
      'sell_rate': 0.05, 'municipal_gain_tax': 1500, 'discount_rate': 0.06,
      'tax': {'on': True, 'marginal': 0.37, 'reduction': 0.5, 'construction_share': 0.6, 'offset_other_income': True}}
F2 = {'name': 'F2 fictional new-build flat, Valencia, mixed loan, no tax', 'region': 'VC', 'new_build': True, 'price': 260000,
      'reference_value': None, 'manual_transfer_rate': None, 'notary_extras': 300, 'gestoria': 350, 'buyer_agency_rate': 0.0,
      'loan_fees': 450, 'renovation': 0, 'ltv': 0.8,
      'loan': {'kind': 'mixed', 'fixed_rate': 0.024, 'fixed_years': 3, 'spread': 0.008, 'index': 0.022,
               'index_path': [0.022, 0.022, 0.022, 0.026, 0.031, 0.034, 0.029, 0.025, 0.021, 0.018, 0.015, 0.012],
               'term_years': 30},
      'rent_month': 1250, 'vacancy': 0.08, 'ibi': 600, 'community': 960, 'insurance': 300, 'other_fixed': 0,
      'maintenance_rate': 0.04, 'management_rate': 0.07, 'g_rent': 0.025, 'g_exp': 0.02, 'g_app': 0.015, 'years': 12,
      'sell_rate': 0.06, 'municipal_gain_tax': 0, 'discount_rate': 0.07, 'tax': {'on': False}}
F3 = {'name': 'F3 fictional single-family rental, US-style profile, fixed 30-year loan, tax on', 'profile': 'generic',
      'currency': 'USD', 'price': 320000, 'purchase': {'transfer_tax_rate': 0.002, 'closing_cost_rate': 0.025,
      'closing_cost_fixed': 0, 'buyer_agency_rate': 0.0}, 'loan_fees': 0, 'renovation': 10000, 'ltv': 0.75,
      'loan': {'kind': 'fixed', 'fixed_rate': 0.065, 'term_years': 30},
      'rent_month': 2600, 'vacancy': 0.06, 'ibi': 0, 'community': 0, 'insurance': 1500, 'other_fixed': 0,
      'property_tax_rate': 0.011, 'maintenance_rate': 0.08, 'management_rate': 0.08, 'g_rent': 0.03, 'g_exp': 0.03,
      'g_app': 0.035, 'years': 10, 'sell_rate': 0.06, 'municipal_gain_tax': 0, 'discount_rate': 0.08,
      'tax': {'on': True, 'rate': 0.24, 'interest_deductible': True, 'depreciation_years': 27.5, 'building_share': 0.8,
              'offset_losses': True, 'capital_gains_rate': 0.15, 'depreciation_recapture_rate': 0.25}}

F4 = {'name': 'F4 fictional resale flat, Canarias, variable loan repaid mid-hold, 36 years, tax on without offset',
      'region': 'CN', 'new_build': False, 'price': 150000, 'reference_value': 165000, 'manual_transfer_rate': None,
      'notary_extras': 300, 'gestoria': 350, 'buyer_agency_rate': 0.0, 'loan_fees': 400, 'renovation': 20000, 'ltv': 0.8,
      'loan': {'kind': 'variable', 'spread': 0.012, 'index': 0.025,
               'index_path': [0.045, 0.05, 0.05, 0.05, 0.05, 0.05, -0.02, -0.02, 0.0, 0.01], 'term_years': 15},
      'rent_month': 500, 'vacancy': 0.1, 'ibi': 350, 'community': 480, 'insurance': 220, 'other_fixed': 100,
      'maintenance_rate': 0.1, 'management_rate': 0.08, 'g_rent': 0.02, 'g_exp': 0.02, 'g_app': 0.02, 'years': 36,
      'value0': 190000, 'sell_rate': 0.05, 'municipal_gain_tax': 2500, 'discount_rate': 0.06,
      'tax': {'on': True, 'marginal': 0.30, 'reduction': 0.6, 'construction_share': 0.55, 'offset_other_income': False}}
F5 = {'name': 'F5 fictional rental bought in cash, generic profile, 30 years, losses not offset', 'profile': 'generic',
      'currency': 'USD', 'price': 300000, 'purchase': {'transfer_tax_rate': 0.01, 'closing_cost_rate': 0.02,
      'closing_cost_fixed': 1500, 'buyer_agency_rate': 0.0}, 'loan_fees': 0, 'renovation': 0, 'ltv': 0.0,
      'loan': {'kind': 'fixed', 'fixed_rate': 0.06, 'term_years': 30},
      'rent_month': 1400, 'vacancy': 0.06, 'ibi': 0, 'community': 0, 'insurance': 1500, 'other_fixed': 0,
      'property_tax_rate': 0.012, 'maintenance_rate': 0.08, 'management_rate': 0.08, 'g_rent': 0.03, 'g_exp': 0.02,
      'g_app': -0.005, 'years': 30, 'sell_rate': 0.06, 'municipal_gain_tax': 0, 'discount_rate': 0.07,
      'tax': {'on': True, 'rate': 0.24, 'interest_deductible': False, 'depreciation_years': 27.5, 'building_share': 0.8,
              'offset_losses': False, 'capital_gains_rate': 0.15, 'depreciation_recapture_rate': 0.25}}


def shifted(x, variable, side):
    """docs/how-it-works.md §8 made exact: one input moved, everything else (taxes, loan, exit value) recomputed by proforma.
    A step that would leave the input's allowed range stops at the limit."""
    y = json.loads(json.dumps(x))
    lo = side == 'low'
    if variable == 'price':
        y['price'] = min(1e9, x['price'] * (0.9 if lo else 1.1))
        return y, y['price']
    if variable == 'rent':
        y['rent_month'] = min(1e7, x['rent_month'] * (0.9 if lo else 1.1))
        return y, y['rent_month']
    if variable == 'vacancy':
        y['vacancy'] = max(0.0, x['vacancy'] - 0.05) if lo else min(0.99, x['vacancy'] + 0.05)
        return y, y['vacancy']
    if variable == 'interest':
        d = -0.01 if lo else 0.01
        ln = y['loan']
        if 'fixed_rate' in ln:
            ln['fixed_rate'] = min(0.3, max(0.0, x['loan']['fixed_rate'] + d))
        if 'index' in ln:
            ln['index'] = min(0.2, max(-0.05, x['loan']['index'] + d))
        if ln.get('index_path'):
            ln['index_path'] = [min(0.2, max(-0.05, e + d)) for e in x['loan']['index_path']]
        return y, ln['index'] if ln['kind'] == 'variable' else ln['fixed_rate']
    if variable == 'appreciation':
        y['g_app'] = min(0.5, max(-0.5, x['g_app'] + (-0.02 if lo else 0.02)))
        return y, y['g_app']
    if variable == 'rent_growth':
        y['g_rent'] = min(0.5, max(-0.5, x['g_rent'] + (-0.01 if lo else 0.01)))
        return y, y['g_rent']
    if variable == 'opex':
        f = 0.8 if lo else 1.2
        for k, limit in (('ibi', 1e8), ('community', 1e8), ('insurance', 1e8), ('other_fixed', 1e8),
                         ('property_tax_rate', 0.05), ('maintenance_rate', 0.9), ('management_rate', 0.9)):
            if k in x:
                y[k] = min(limit, x[k] * f)
        return y, f
    raise ValueError(variable)


SENSITIVITY_VARIABLES = ('price', 'rent', 'vacancy', 'interest', 'appreciation', 'rent_growth', 'opex')


def sensitivity(x):
    base = proforma(x)['metrics']
    bars = []
    for v in SENSITIVITY_VARIABLES:
        (xl, vl), (xh, vh) = shifted(x, v, 'low'), shifted(x, v, 'high')
        ml, mh = proforma(xl)['metrics'], proforma(xh)['metrics']
        bars.append({'variable': v, 'low_value': vl, 'high_value': vh, 'npv_low': ml['npv'], 'npv_high': mh['npv'],
                     'irr_low': ml['irr'], 'irr_high': mh['irr']})
    bars.sort(key=lambda b: -abs(b['npv_high'] - b['npv_low']))      # stable: ties keep the listed order
    return {'base': {'npv': base['npv'], 'irr': base['irr']}, 'bars': bars}


def spain_tax_case(c):
    carry, taken, tax, carry_after, amort = [], 0.0, [], [], []
    for k, inc in enumerate(c['income']):
        t = k + 1
        a_t = spain_amortisation(c['amortisation_per_year'], c['amortisation_basis'], taken)
        taken += a_t
        tx, carry = spain_tax_year(t, inc, c['interest'][k], c['repairs'][k], c['other_deductible'][k], a_t, carry,
                                   c['marginal'], c['reduction'], c['offset_other_income'])
        tax.append(tx)
        amort.append(a_t)
        carry_after.append([[y, a] for (y, a) in carry])
    return dict(c, tax=tax, amortisation=amort, amortisation_taken=taken, carry_after=carry_after)


def generic_tax_case(c):
    tax, dep, taken = [], [], 0.0
    for k, inc in enumerate(c['collected']):
        d = generic_depreciation(c['depreciation_per_year'], c['depreciation_years'], k + 1)
        taken += d
        dep.append(d)
        tax.append(generic_tax_year(inc, c['interest'][k], c['opex'][k], d, c['rate'], c['interest_deductible'],
                                    c['offset_losses']))
    return dict(c, tax=tax, depreciation=dep, depreciation_taken=taken)


def close(a, b, tol=1e-9):
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))


def main():
    out = {}
    # A. amortisation
    A = []
    rows, _ = loan_schedule(100000, 30, 'fixed', 0.06)
    assert round(rows[0]['payment'], 2) == 599.55, rows[0]['payment']           # textbook value
    for (L, rate, yrs) in [(200000, 0.03, 25), (100000, 0.06, 30), (120000, 0.0, 10), (150000, 0.0425, 20)]:
        rows, _ = loan_schedule(L, yrs, 'fixed', rate)
        assert abs(rows[-1]['balance']) < 1e-6
        # closed form balance after k months
        i = rate / 12
        for k in (12, 60):
            bf = L - rows[0]['payment'] * k if i == 0 else L * (1 + i) ** k - rows[0]['payment'] * ((1 + i) ** k - 1) / i
            assert close(bf, rows[k - 1]['balance'], 1e-9)
        A.append({'loan': L, 'annual_rate': rate, 'years': yrs, 'payment': rows[0]['payment'],
                  'total_interest': sum(r['interest'] for r in rows), 'first_3': rows[:3],
                  'balance_after': {str(k): rows[k - 1]['balance'] for k in (12, 60, 120, 12 * yrs)},
                  'year_1': {'interest': sum(r['interest'] for r in rows[:12]), 'principal': sum(r['principal'] for r in rows[:12])}})
    assert rows and A[2]['payment'] == 1000.0
    idx = [0.035, 0.025, -0.005, -0.012, 0.01]
    rows, rates = loan_schedule(150000, 5, 'variable', spread=0.009, index_by_year=idx)
    assert rates[3] == 0.0 and abs(rates[2] - 0.004) < 1e-15 and abs(rows[-1]['balance']) < 1e-6
    A.append({'loan': 150000, 'kind': 'variable', 'years': 5, 'spread': 0.009, 'index_by_year': idx, 'rates_by_year': rates,
              'payment_by_year': [rows[12 * t]['payment'] for t in range(5)],
              'balance_end_of_year': [rows[12 * t + 11]['balance'] for t in range(5)],
              'note': 'year 4: index+spread = -0.3 % -> rate floored at 0 (Ley 5/2019 art. 21.4)'})
    rows, rates = loan_schedule(200000, 10, 'mixed', fixed_rate=0.025, spread=0.01, index_by_year=[0.03] * 10, fixed_years=5)
    A.append({'loan': 200000, 'kind': 'mixed', 'years': 10, 'fixed_rate': 0.025, 'fixed_years': 5, 'spread': 0.01, 'index': 0.03,
              'payment_by_year': [rows[12 * t]['payment'] for t in range(10)], 'balance_end_of_year': [rows[12 * t + 11]['balance'] for t in range(10)]})
    out['amortisation'] = A

    # I. IRR / NPV / MIRR / payback
    I = []
    def add(flows, note):
        I.append({'flows': flows, 'irr': irr(flows), 'npv_at_10pct': npv(0.10, flows), 'note': note})
    add([-100, 110], 'one period: 10 %')
    add([-1000, 300, 400, 500], 'ordinary')
    add([-100, 230, -132], 'two sign changes: roots 10 % and 20 %')
    add([100, 50], 'no sign change (all positive)')
    add([-100, -50], 'no sign change (all negative)')
    add([-1000, 0, 0, 0, 0, 1000], 'zero return')
    add([-1000] + [100] * 9 + [1100], 'bond at par: exactly 10 %')
    add([-100, 1000], '900 %: inside the scan range')
    add([-1, 100], '9 900 %: outside the scan range -> None(OutOfRange)')
    add([-100, 2], '-98 %')
    add([0, -100, 0, 121], 'leading zero flow: 10 %')
    assert close(I[0]['irr']['rate'], 0.10, 1e-10) and I[2]['irr']['kind'] == 'Multiple'
    assert all(close(a, b, 1e-9) for a, b in zip(I[2]['irr']['rates'], [0.1, 0.2]))
    assert I[3]['irr'] == {'kind': 'None', 'reason': 'NoSignChange'} and I[8]['irr']['reason'] == 'OutOfRange'
    assert abs(I[5]['irr']['rate']) < 1e-10 and close(I[6]['irr']['rate'], 0.10, 1e-10) and close(I[7]['irr']['rate'], 9.0, 1e-10)
    assert close(I[10]['irr']['rate'], 0.10, 1e-10)
    excel = [-120000, 39000, 30000, 21000, 37000, 46000]   # Excel MIRR documentation example
    m = mirr(excel, 0.10, 0.12)
    assert round(m, 4) == 0.1261, m
    out['irr'] = I
    out['mirr'] = [{'flows': excel, 'finance': 0.10, 'reinvest': 0.12, 'mirr': m, 'note': 'Excel docs: 12.61 %'},
                   {'flows': excel[:4], 'finance': 0.10, 'reinvest': 0.12, 'mirr': mirr(excel[:4], 0.10, 0.12), 'note': 'Excel docs: -4.80 %'}]
    assert round(out['mirr'][1]['mirr'], 4) == -0.0480
    nv = npv(0.10, [-10000, 3000, 4200, 6800])
    out['npv'] = [{'rate': 0.10, 'flows_t0_first': [-10000, 3000, 4200, 6800], 'npv': nv,
                   'excel_npv_function_gives': npv(0.10, [-10000, 3000, 4200, 6800]) / 1.1,
                   'note': 'our NPV does not discount t0; Excel NPV() discounts the first value (1 188.44)'}]
    assert round(out['npv'][0]['excel_npv_function_gives'], 2) == 1188.44
    out['payback'] = [{'cf0': -1000, 'operating': [300, 300, 300, 300], 'payback': payback(-1000, [300] * 4)},
                      {'cf0': -1000, 'operating': [100, 100], 'payback': payback(-1000, [100, 100])},
                      {'cf0': -1000, 'operating': [-50, 600, 600], 'payback': payback(-1000, [-50, 600, 600])}]
    assert close(out['payback'][0]['payback'], 3 + 1 / 3) and out['payback'][1]['payback'] is None

    # T. taxes and fees
    T = {'transfer_tax_resale': {}, 'transfer_tax_new_build': {}}
    for r in ES['regions']:
        T['transfer_tax_resale'][r['code']] = {str(v): transfer_tax(r['code'], v) for v in (150000, 300000, 500000, 1200000, 2500000)}
        if r.get('new_build_vat', 0.1) is not None:
            T['transfer_tax_new_build'][r['code']] = {str(v): transfer_tax(r['code'], v, True) for v in (150000, 300000)}
    assert T['transfer_tax_resale']['MD']['300000'] == 18000.0
    assert close(T['transfer_tax_resale']['CT']['1200000'], 600000 * 0.10 + 300000 * 0.11 + 300000 * 0.12)
    assert close(T['transfer_tax_resale']['AS']['500000'], 45000) and close(T['transfer_tax_resale']['VC']['1200000'], 132000)
    assert close(T['transfer_tax_resale']['AR']['500000'], 40750)                 # cuota íntegra column of Tabla 71
    assert close(T['transfer_tax_resale']['IB']['1200000'], 90000 + 200000 * 0.12)  # Tabla 73
    T['fees'] = {str(p): {'notary_scale': fee_scale(ES['fees']['notary_purchase'], p), 'notary_total_extras300': notary(p, 300),
                          'registry_total': registry(p)} for p in (6000, 100000, 180000, 300000, 1000000)}
    assert close(T['fees']['6000']['notary_scale'], 90.151816)
    T['capital_gains_es'] = {str(g): cgt_es(g) for g in (5000, 60000, 250000, 400000)}
    assert close(T['capital_gains_es']['400000'], 71880 + 100000 * 0.30)          # LIRPF art. 66.2 cuota column
    out['taxes_and_fees'] = T

    # R. PRNG and percentiles
    rng = Rng(42)
    u32 = [rng.next_u32() for _ in range(8)]
    rng = Rng(42)
    uni = [rng.uniform() for _ in range(4)]
    rng = Rng(42)
    nrm = [z for _ in range(2) for z in rng.normal_pair()]
    out['prng'] = {'seed': 42, 'state_after_seeding': Rng(42).s, 'first_u32': u32, 'first_uniforms': uni, 'first_normals': nrm,
                   'seed_0_first_u32': [Rng(0).next_u32() for _ in range(1)]}
    out['percentile_type7'] = [{'data': [1, 2, 3, 4], 'p': p, 'value': percentile7([1, 2, 3, 4], p)} for p in (0, 0.1, 0.5, 0.9, 1)]
    assert out['percentile_type7'][2]['value'] == 2.5 and close(out['percentile_type7'][1]['value'], 1.3)

    # F. full pro formas
    for c in (F1, F2, F3):
        out['proforma_' + c['name'][:2]] = {'inputs': c, 'result': proforma(c)}
    m3 = out['proforma_F3']['result']
    y1 = m3['years'][0]
    assert close(m3['metrics']['grm'], 320000 / (12 * 2600)) and close(m3['metrics']['one_percent_ratio'], 2600 / 330000)
    assert close(y1['opex'], 1500 + 0.011 * 320000 + 0.08 * 31200 + 0.08 * 31200 * 0.94)
    assert close(m3['metrics']['dscr'], y1['noi'] / y1['debt_service'])
    # at the break-even occupancy the year-1 pre-tax cash flow is zero
    o = m3['metrics']['break_even_occupancy']
    assert abs(o * 31200 - (1500 + 3520 + 0.08 * 31200 + 0.08 * o * 31200) - y1['debt_service']) < 1e-6
    assert close(m3['amortisation_taken'], 10 * 0.8 * (320000 + m3['acquisition']['acq_costs'] + 10000) / 27.5)
    # invariant: MC with sigma 0 and vacancy fixed reproduces the base case
    zero = dict(DEFAULT_MC, sigma_index=0.0, sigma_rent=0.0, sigma_app=0.0, sigma_exp=0.0)
    f1z = dict(F1, vacancy=0.0)
    mcz = monte_carlo(f1z, 5, 7, zero)
    base = proforma(f1z)
    assert close(mcz['npv_p'][1], base['metrics']['npv'], 1e-12) and close(mcz['npv_p'][0], mcz['npv_p'][2], 1e-12)
    # MC reference (F2: the mixed loan makes the index matter)
    out['monte_carlo_F2_n2000_seed42'] = {'params': DEFAULT_MC, **monte_carlo(F2, 2000, 42)}
    out['monte_carlo_F1_n2000_seed42'] = {'params': DEFAULT_MC, **monte_carlo(F1, 2000, 42)}

    # percentiles next to the IRR sentinels (an infinity must not turn a percentile into NaN)
    inf = math.inf
    for data, ps in (([-inf, -inf, 1, 2], (0.1, 0.5, 0.9)), ([1, 2, inf], (0.5, 0.9, 1)), ([-inf, 1], (0.5,))):
        for p in ps:
            out['percentile_type7'].append({'data': data, 'p': p, 'value': percentile7(data, p)})
    assert percentile7([-inf, 1], 0.5) == -inf and percentile7([1, 2, inf], 0.9) == inf
    assert percentile7([1, 2, inf], 0.5) == 2 and close(percentile7([-inf, -inf, 1, 2], 0.9), 1.7)

    # F4, F5: the branches F1-F3 do not reach
    for c in (F4, F5):
        out['proforma_' + c['name'][:2]] = {'inputs': c, 'result': proforma(c)}
    f4, f5 = out['proforma_F4']['result'], out['proforma_F5']['result']
    assert f4['years'][3]['loan_rate'] == 0.0 or f4['years'][6]['loan_rate'] == 0.0          # the floor
    assert f4['years'][15]['debt_service'] == 0.0 and abs(f4['exit']['loan_payoff']) < 1e-6   # repaid in year 15
    basis4 = 150000 + f4['acquisition']['acq_costs'] + 20000
    assert close(f4['amortisation_taken'], 0.55 * basis4)                                     # capped at the construction basis
    assert close(f4['acquisition']['transfer_tax'], 0.065 * 165000)                            # reference value taxed
    # a typed transfer rate on a new build stands in for VAT / IGIC / IPSI: charged on the price, not the reference value
    nb = dict(F4, new_build=True, manual_transfer_rate=0.04, reference_value=F4['price'] * 1.5)
    assert close(acquisition(nb)['transfer_tax'], 0.04 * F4['price'])
    assert close(acquisition(dict(nb, new_build=False))['transfer_tax'], 0.04 * F4['price'] * 1.5)
    assert all(y['tax'] >= 0 for y in f4['years'])                                             # no offset
    assert f5['metrics']['dscr'] is None and all(y['loan_rate'] == 0.0 for y in f5['years'])
    assert any(y['tax'] == 0.0 for y in f5['years'][:3]) and f5['years'][-1]['tax'] > 0
    assert 0 < f5['exit']['gain'] < f5['amortisation_taken']
    assert close(f5['exit']['cgt'], f5['exit']['gain'] * 0.25)

    # the tax rules alone
    S = [
        {'name': 'carry used the next year', 'income': [10000, 10000, 10000], 'interest': [9000, 2000, 2000],
         'repairs': [2000, 500, 500], 'other_deductible': [1500, 1500, 1500], 'amortisation_per_year': 2000,
         'amortisation_basis': 60000, 'marginal': 0.37, 'reduction': 0.5, 'offset_other_income': True},
        {'name': 'carry expires after 4 years', 'income': [6000] * 8, 'interest': [40000, 500, 500, 500, 500, 500, 0, 0],
         'repairs': [500] * 8, 'other_deductible': [800] * 8, 'amortisation_per_year': 1500, 'amortisation_basis': 45000,
         'marginal': 0.30, 'reduction': 0.6, 'offset_other_income': False},
        {'name': 'negative net offsets other income', 'income': [8000, 8000], 'interest': [3000, 3000],
         'repairs': [400, 400], 'other_deductible': [4000, 4000], 'amortisation_per_year': 3000, 'amortisation_basis': 90000,
         'marginal': 0.45, 'reduction': 0.5, 'offset_other_income': True},
        {'name': 'negative net without offset gives 0', 'income': [8000, 8000], 'interest': [3000, 3000],
         'repairs': [400, 400], 'other_deductible': [4000, 4000], 'amortisation_per_year': 3000, 'amortisation_basis': 90000,
         'marginal': 0.45, 'reduction': 0.5, 'offset_other_income': False},
        {'name': 'amortisation stops at the construction basis', 'income': [12000] * 5, 'interest': [0] * 5,
         'repairs': [0] * 5, 'other_deductible': [1000] * 5, 'amortisation_per_year': 3000, 'amortisation_basis': 10000,
         'marginal': 0.30, 'reduction': 0.0, 'offset_other_income': True},
    ]
    G = [
        {'name': 'interest deductible, a loss offset', 'collected': [20000, 24000], 'interest': [15000, 12000],
         'opex': [6000, 6000], 'depreciation_per_year': 5000, 'depreciation_years': 27.5, 'rate': 0.24,
         'interest_deductible': True, 'offset_losses': True},
        {'name': 'interest not deductible, a loss not offset', 'collected': [10000, 20000], 'interest': [9000, 9000],
         'opex': [6000, 6000], 'depreciation_per_year': 5000, 'depreciation_years': 27.5, 'rate': 0.24,
         'interest_deductible': False, 'offset_losses': False},
        {'name': 'depreciation tail: half a year in year 3, none after', 'collected': [30000] * 4, 'interest': [0] * 4,
         'opex': [5000] * 4, 'depreciation_per_year': 8000, 'depreciation_years': 2.5, 'rate': 0.24,
         'interest_deductible': True, 'offset_losses': True},
    ]
    E = [{'gain': g, 'depreciation_taken': 50000, 'recapture_rate': 0.25, 'capital_gains_rate': 0.15,
          'exit_tax': generic_exit_tax(g, 50000, 0.25, 0.15)} for g in (-10000, 30000, 80000)]
    out['income_tax'] = {'spain': [spain_tax_case(c) for c in S], 'generic': [generic_tax_case(c) for c in G],
                         'generic_exit': E}
    sp = out['income_tax']['spain']
    assert sp[0]['carry_after'][0] == [[1, 1000]] and sp[0]['carry_after'][1] == []
    assert sp[1]['carry_after'][4][0][0] == 1 and all(y != 1 for y, _ in sp[1]['carry_after'][5])   # year 1 expired
    assert sp[2]['tax'][0] < 0 and sp[3]['tax'][0] == 0.0
    assert sp[4]['amortisation'] == [3000, 3000, 3000, 1000, 0.0]
    gn = out['income_tax']['generic']
    assert gn[1]['tax'][0] == 0.0 and close(gn[1]['tax'][1], 0.24 * (20000 - 6000 - 5000))
    assert gn[2]['depreciation'] == [8000, 8000, 4000, 0.0]
    assert [e['exit_tax'] for e in E] == [0.0, 7500.0, 50000 * 0.25 + 30000 * 0.15]

    out['sensitivity_F1'] = {'inputs': F1, **sensitivity(F1)}
    sb = out['sensitivity_F1']['bars']
    rng_ = [abs(b['npv_high'] - b['npv_low']) for b in sb]
    assert len(sb) == 7 and all(a >= b for a, b in zip(rng_, rng_[1:]))
    assert all(b['npv_high'] > b['npv_low'] for b in sb if b['variable'] in ('rent', 'appreciation', 'rent_growth'))
    assert close(out['sensitivity_F1']['base']['npv'], out['proforma_F1']['result']['metrics']['npv'], 0)
    out['monte_carlo_F3_n500_seed7'] = {'params': DEFAULT_MC, **monte_carlo(F3, 500, 7)}
    for k in ('monte_carlo_F1_n2000_seed42', 'monte_carlo_F2_n2000_seed42', 'monte_carlo_F3_n500_seed7'):
        h = out[k]['npv_histogram']
        assert sum(h['counts']) + h['below'] + h['above'] == out[k]['n']

    os.makedirs(OUT, exist_ok=True)
    def clean(o):                                 # strict JSON: no Infinity/NaN literals
        if isinstance(o, float) and not math.isfinite(o):
            return 'nan' if o != o else ('inf' if o > 0 else '-inf')
        if isinstance(o, dict):
            return {k: clean(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)):
            return [clean(v) for v in o]
        return o
    for k, v in out.items():
        json.dump(clean(v), open(os.path.join(OUT, k + '.json'), 'w'), indent=1, allow_nan=False)
    f1 = out['proforma_F1']['result']; f2 = out['proforma_F2']['result']
    print('all self-checks passed; files:', ', '.join(k + '.json' for k in out))
    for nm, r in (('F1', f1), ('F2', f2), ('F3', out['proforma_F3']['result'])):
        mm = r['metrics']
        print(f"{nm}: DSCR {mm['dscr']} GRM {mm['grm']:.4f} 1%-ratio {mm['one_percent_ratio']:.5f} BEO {mm['break_even_occupancy']:.4f}")
        print(f"{nm}: equity0 {r['acquisition']['equity0']:.2f} acq_costs {r['acquisition']['acq_costs']:.2f} "
              f"gross {mm['gross_yield']:.4%} net {mm['net_yield']:.4%} CoC {mm['cash_on_cash_1']:.4%} "
              f"NPV {mm['npv']:.2f} IRR {mm['irr']} payback {mm['payback_years']}")
    for k in ('monte_carlo_F1_n2000_seed42', 'monte_carlo_F2_n2000_seed42'):
        m = out[k]
        print(k, 'IRR P10/50/90', [round(x, 6) for x in m['irr_p']], 'NPV', [round(x, 2) for x in m['npv_p']],
              'P(NPV<0)', m['p_npv_negative'], 'multi', m['irr_multiple_count'])


if __name__ == '__main__':
    main()
