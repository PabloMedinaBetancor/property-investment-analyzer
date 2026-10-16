# How the numbers are computed

This is the method the engine follows, written out so that anyone can check a result by hand or in a spreadsheet. The
Python reference in [tools/reference.py](../tools/reference.py) implements exactly this text, and every expected value in
[tests/fixtures/](../tests/fixtures/) comes from it. The rates and fee scales are in [data/es-2026.json](../data/es-2026.json)
and [data/generic-profiles.json](../data/generic-profiles.json), each with the source it comes from; the sources are listed
at the end.

Not financial or tax advice. The tax rules below are simplified on purpose, and the limits say where.

## Units and timing

- Money is in the market's currency (euros for Spain). Rates are decimals inside the engine (0.03 is 3 %). Nothing is
  rounded during the calculation; the screen rounds only what it shows.
- Year 0 is the day you buy. Years 1 to N are the holding period (N from 1 to 40). Each year's flow is counted at the end
  of that year; the loan runs month by month inside it.

## 1. The purchase (year 0)

**Spain.** The base for transfer tax (ITP) and stamp duty (AJD) is the price, or the cadastral reference value if you
enter one and it is higher, as Spanish law taxes the higher of the two. VAT and IGIC are charged on the price paid.

- **Resale:** the region's transfer tax (ITP) on that base. Regions use one of three forms: a flat rate; a progressive
  scale, where each slice of the price pays its own rate, like income tax; or a rate for the whole price set by the band
  it falls in, which jumps at each threshold.
- **New build:** VAT at 10 % of the price plus the region's stamp duty (AJD) on the tax base. In the Canary Islands it is IGIC at 7 % plus
  1 % AJD. In Ceuta and Melilla a new build pays IPSI, which is not modelled: you enter the rate yourself.
- A rate you enter in “Transfer tax rate” replaces the region's. On a resale it applies to the tax base above; on a new
  build, where it stands in for VAT, IGIC or IPSI, it applies to the price.
- **Notary:** the official scale on the price, plus the extras you enter (copies, searches), plus 21 % VAT.
- **Registry:** the official scale on the price, kept between the scale's minimum and maximum, less the 5 % rebate, plus
  21 % VAT.
- **Gestoría** and **buyer agency** are what you enter. The costs of the mortgage deed fall on the lender under Ley 5/2019,
  so they are not added; the valuation is part of the loan fees you enter.

**Generic and US-style markets.** Transfer tax = rate × price; closing costs = rate × price + a fixed amount; buyer agency
= rate × price.

Then, for every market:

```
purchase costs     = transfer tax (or VAT and stamp duty) + fees
loan               = loan-to-value × price
total investment   = price + purchase costs + renovation
equity at closing  = total investment + loan fees − loan      (loan fees are zero when the loan is 0 %)
flow in year 0     = − equity at closing
```

## 2. The mortgage

The loan is repaid in equal monthly payments (the French system). With a monthly rate `i` (the annual nominal rate ÷ 12),
a balance `B` and `n` months left:

```
payment   = B × i / (1 − (1 + i)^−n)        (B / n when the rate is zero)
interest  = B × i
principal = payment − interest
```

- **Fixed:** one rate for the whole term.
- **Variable:** each year the rate is the index plus the spread, never below zero (Ley 5/2019 forbids a negative rate).
  The payment is recalculated every 12 months on the balance and the months left. The index stays at today's value unless
  you enter a path year by year.
- **Mixed:** fixed for the years you set, then variable.
- The term can be shorter or longer than the holding period. Whatever is still owed is repaid at the sale.
- Payments are not rounded to cents, so a schedule here can differ from a bank's by a few cents.

## 3. Each year of letting

```
gross rent          = 12 × monthly rent × (1 + rent growth)^(year − 1)
collected rent      = gross rent × (1 − vacancy)
operating expenses  = (IBI or property tax amount + community or HOA + insurance + other) × (1 + expense growth)^(year − 1)
                      + property tax rate × value at the start of the year      (generic markets; 0 in Spain)
                      + maintenance rate × gross rent
                      + management rate × collected rent
NOI                 = collected rent − operating expenses
debt service        = the twelve payments of the year (interest + principal)
cash flow before tax = NOI − debt service
cash flow after tax  = cash flow before tax − income tax (section 5)
```

## 4. The sale (end of the last year)

```
sale value    = price × (1 + appreciation)^N
selling costs = sale value × selling cost rate + municipal gain tax (an amount you enter)
equity back   = sale value − selling costs − loan still owed − tax on the gain
```

The last year's flow includes the sale.

## 5. Income tax (optional)

**Spain: IRPF of a resident landlord, simplified.**

- Income is the collected rent.
- Interest and repairs (the maintenance) can be deducted only up to the year's rent. What is left over is carried forward
  and used, oldest first, in the next four years; after that it expires.
- These are deducted in full: IBI, community, insurance, other fixed costs, management and the amortisation of the
  building. Amortisation is 3 % a year of the building's share of the cost (price + purchase costs + renovation); the
  share comes from the IBI receipt. It stops once the whole building cost has been amortised.
- A positive net is reduced by the rent reduction you choose (50 % in the general case; 60 %, 70 % or 90 % in the cases
  the law lists; 0 for holiday lets) and taxed at your marginal rate.
- A negative net saves tax at your marginal rate if you choose that it offsets other income; otherwise it is ignored.
- At the sale, the gain is the sale value less the selling costs less the cost (price + purchase costs + renovation −
  amortisation taken). A positive gain pays the savings scale: 19 % up to 6,000, 21 % to 50,000, 23 % to 200,000, 27 % to
  300,000 and 30 % above. A loss gives no relief here.

**Generic and US-style markets.**

- Net = collected rent − operating expenses − interest (if deductible) − depreciation. Depreciation is straight line over
  the years you set, on the building's share of the cost, in whole years.
- Net × the tax rate is paid when the net is positive, and saved when it is negative if losses offset other income.
- At the sale, the part of the gain up to the depreciation taken pays the recapture rate and the rest pays the capital
  gains rate. With the US example: 27.5-year depreciation, the building only, recapture capped at 25 %, 15 % on the rest.

## 6. The metrics

| Metric               | Formula                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Gross yield          | 12 × monthly rent ÷ price                                                                                                      |
| Net yield            | NOI of year 1 ÷ total investment                                                                                               |
| Cap rate             | NOI of year 1 ÷ price                                                                                                          |
| Cash-on-cash         | cash flow of year 1 ÷ equity at closing (after tax when tax is on)                                                             |
| DSCR                 | NOI of year 1 ÷ debt service of year 1 (none without a loan)                                                                   |
| GRM                  | price ÷ gross rent of year 1                                                                                                   |
| 1 % rule             | monthly rent ÷ (price + renovation); met at 0.01 or more                                                                       |
| Break-even occupancy | (fixed costs + property tax + maintenance + debt service of year 1) ÷ (gross rent of year 1 × (1 − management rate))           |
| NPV                  | the sum over years 0 to N of flow ÷ (1 + discount rate)^year                                                                   |
| IRR                  | the rate that makes NPV zero                                                                                                   |
| MIRR                 | (future value of the positive flows at the discount rate ÷ present value of the negative flows at the discount rate)^(1/N) − 1 |
| Payback              | the first point where the running total of flows, without the sale, reaches zero, interpolated within the year                 |

Break-even occupancy is exact because the management fee is charged on the rent actually collected.

**NPV** discounts year 1 by one year and leaves year 0 as it is. A spreadsheet's `NPV()` function discounts its first
value too; to match this app there, add the year-0 flow outside the function.

**IRR.** The engine counts how many times the flows change sign. With none there is no IRR. Otherwise it evaluates NPV
on a grid of rates from −99 % to 1,000 % and narrows every interval where NPV changes sign until the rate is known to
within 10⁻¹⁵. One rate is reported as the IRR; several are reported together, with MIRR and NPV as the figures
to rely on; none inside the range is reported as such. The grid steps are 1 point from −99 % to 100 % and 10 points from 100 % to 1,000 %, so two roots closer together than a step can be missed. When the flows change sign exactly once there is exactly one root and the grid is skipped: Newton's method runs inside a bracket and bisects instead of taking a step that would leave the bracket or that is larger than half the previous step (a Newton run that is not shrinking fast enough, as with a long hold and a large exit, is replaced by halving). It stops when the step falls below 10⁻¹³.

## 7. The simulation (Monte Carlo)

Each scenario replays the holding period with five things drawn at random every year:

| What varies    | How                                                                                        | Default                  |
| -------------- | ------------------------------------------------------------------------------------------ | ------------------------ |
| Mortgage index | each year it moves back towards today's value by a share κ of the gap, plus a random shock | κ 0.15, shock 0.8 points |
| Rent growth    | your rent growth plus a random shock (never below −99 %)                                   | 2 points                 |
| Appreciation   | your appreciation plus a random shock (never below −99 %)                                  | 5 points                 |
| Expense growth | your expense growth plus a random shock (never below −99 %)                                | 1 point                  |
| Vacancy        | each of the 12 months is empty with the probability of your vacancy rate                   | your vacancy             |

The four shocks are correlated: index and expenses 0.3, rent and appreciation 0.5, rent and expenses 0.4, appreciation and
expenses 0.2, the rest 0. The defaults are illustrative and every one can be changed; the correlations must form a valid
matrix or the engine refuses them. The index can go below zero, as Euribor did, but the loan rate cannot.

Year 1 uses today's rent, expenses and index; the shocks start moving them from year 2. Appreciation is drawn for every
year. The simulation does not use the yearly index path of the main analysis.

The random numbers come from xoshiro128\*\* seeded by splitmix32, turned into normal draws by the Box–Muller method, in a
fixed order. The same seed and inputs give the same scenarios, to the last bit, in the Python reference, the Rust engine
and the TypeScript benchmark kernel.

The results:

- the 10th, 50th and 90th percentiles (P10, P50, P90) of the cumulative cash flow in every year, which draw the band;
- P10, P50 and P90 of NPV, and the share of scenarios with NPV below zero;
- P10, P50 and P90 of IRR. Scenarios with several IRRs are left out and counted. Scenarios with no IRR between −99 % and
  1,000 % (flows that never change sign among them) rank at the bottom when their flows add up to a loss and at the top
  otherwise, and the counts are shown;
- a histogram of NPV in 30 equal bins between the 1st and 99th percentiles, with the scenarios outside counted apart.

Percentiles interpolate between the two nearest sorted values (the method R calls type 7).

## 8. The sensitivity chart

One assumption moves at a time while the others stay at your values:

| Assumption         | Low and high                                                      |
| ------------------ | ----------------------------------------------------------------- |
| Price              | −10 % and +10 %                                                   |
| Rent               | −10 % and +10 %                                                   |
| Vacancy            | −5 and +5 points, kept between 0 % and 99 %                       |
| Interest rate      | −1 and +1 point on the fixed rate and the index; the spread stays |
| Appreciation       | −2 and +2 points                                                  |
| Rent growth        | −1 and +1 point                                                   |
| Operating expenses | −20 % and +20 %                                                   |

A step that would take an input outside its allowed range stops at the limit, so a bar can be shorter on one side: a
fixed loan at 0 % has no lower interest bar. The bars are sorted by how far NPV moves, widest first.

## Limits

- Spain: the general rates an investor buying to let pays. Reduced rates for a main home or for particular buyers are not
  encoded; enter your own rate. Navarre and the Basque Country (Bizkaia's rule) come from secondary sources and are marked
  approximate. Not modelled: non-residents, regional income tax deductions, other savings income in the year of the sale,
  relief for a loss on the sale.
- United States: whole-year depreciation instead of the mid-month convention; no passive-activity loss limits, state
  income tax or net investment income tax. The transfer tax, property tax and closing costs are examples.
- The simulation shows the spread that follows from the volatilities and correlations you enter. It is not a forecast.

## Sources

Spanish rates as of 16 October 2026.

| Key                              | Source                                                                                                                                                                                    | Used for                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `hacienda-autonomica-2026-cap4`  | Ministerio de Hacienda, [Tributación Autonómica. Medidas 2026, cap. IV](https://www.hacienda.gob.es/sgfal/financiacionterritorial/autonomica/capitulo-iv-tributacion-autonomica-2026.pdf) | Transfer tax and stamp duty of each region                                                          |
| `hacienda-autonomica-2026-cap1`  | Ministerio de Hacienda, [Tributación Autonómica. Medidas 2026, cap. I](https://www.hacienda.gob.es/sgfal/financiacionterritorial/autonomica/capitulo-i-tributacion-autonomica-2026.pdf)   | Reduced rates by region (not encoded)                                                               |
| `rdl-1-1993-itpajd`              | [RDL 1/1993, Ley del ITPAJD](https://www.boe.es/buscar/pdf/1993/BOE-A-1993-25359-consolidado.pdf), art. 10.2; [art. 57 bis](https://www.boe.es/buscar/act.php?id=BOE-A-1993-25359)        | The reference value as tax base; Ceuta and Melilla                                                  |
| `ley-37-1992-iva`                | [Ley 37/1992 del IVA](https://www.boe.es/buscar/pdf/1992/BOE-A-1992-28740-consolidado.pdf), art. 90 and 91                                                                                | 10 % VAT on a new home; 21 % VAT on fees                                                            |
| `dleg-1-2025-igic`               | [Decreto Legislativo 1/2025, IGIC](https://www.boe.es/buscar/doc.php?id=BOC-j-2025-90249)                                                                                                 | 7 % IGIC on a new home in the Canary Islands                                                        |
| `rd-1426-1989-arancel-notarial`  | [RD 1426/1989, Arancel de los Notarios](https://www.boe.es/buscar/act.php?id=BOE-A-1989-28111)                                                                                            | Notary scale                                                                                        |
| `rd-1427-1989-arancel-registral` | [RD 1427/1989, Arancel de los Registradores](https://www.boe.es/buscar/act.php?id=BOE-A-1989-28112)                                                                                       | Registry scale, minimum, maximum and rebate                                                         |
| `ley-5-2019`                     | [Ley 5/2019 de contratos de crédito inmobiliario](https://www.boe.es/buscar/pdf/2019/BOE-A-2019-3814-consolidado.pdf), art. 14 and 21                                                     | Who pays the mortgage costs; no negative interest                                                   |
| `ley-35-2006-irpf`               | [Ley 35/2006 del IRPF](https://www.boe.es/buscar/pdf/2006/BOE-A-2006-20764-consolidado.pdf), art. 23 and 66                                                                               | Deductions, the cap and carry-forward, the rent reduction, the savings scale                        |
| `rd-439-2007-irpf`               | [RD 439/2007, Reglamento del IRPF](https://www.boe.es/buscar/pdf/2007/BOE-A-2007-6820-consolidado.pdf), art. 14                                                                           | 3 % amortisation of the building                                                                    |
| `rdl-2-2004-haciendas-locales`   | [RDL 2/2004, Haciendas Locales](https://www.boe.es/buscar/pdf/2004/BOE-A-2004-4214-consolidado.pdf), art. 72                                                                              | IBI is charged on the cadastral value, not the price, so the app asks for the amount on the receipt |
| `ley-29-1994-lau`                | [Ley 29/1994 de Arrendamientos Urbanos](https://www.boe.es/buscar/pdf/1994/BOE-A-1994-26003-consolidado.pdf), art. 20                                                                     | The landlord pays the letting agency's fees, so they belong in the management fee                   |
| `guiafiscal-itp-navarra`         | [Guía Fiscal: ITP-AJD Navarra](https://guiafiscal.es/patrimonio/itp/navarra/) (not official)                                                                                              | Navarre, approximate                                                                                |
| `iberley-bizkaia-itp-art13`      | [Iberley: art. 13 NF Bizkaia ITPAJD](https://www.iberley.es/legislacion/articulo-13-impuesto-sobre-transmisiones-patrimoniales-actos-juridicos-documentados-bizkaia) (not official)       | Basque Country, approximate                                                                         |
| `irs-pub-527`                    | [IRS Publication 527, Residential Rental Property](https://www.irs.gov/publications/p527)                                                                                                 | 27.5-year depreciation; land is not depreciated                                                     |
| `irs-topic-409`                  | [IRS Topic 409, Capital gains and losses](https://www.irs.gov/taxtopics/tc409)                                                                                                            | 15 % long-term rate; 25 % cap on the gain from depreciation                                         |

The textbook formulas (the loan payment, NPV, IRR, MIRR, the percentiles) need no source.
