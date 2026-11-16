const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const m = { exports: {} };
new Function('exports', 'require', 'module', ts.transpileModule(fs.readFileSync('src/pages/SalaryTools/model.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS }}).outputText)(m.exports,require,m);
const {tax,calculate,defaults}=m.exports;
const { calculateRaise } = m.exports;
const { calculateRaiseAmounts } = m.exports;
const noContributions = { ...defaults, pension: 0, unemployment: 0, medical: 0, medicalFixed: 0, fund: 0, employerFund: 0 };
// 10,000/month with no bonus: annual tax rises from 3,480 to 7,080 after a 30% raise.
const raise = calculateRaise(10000, 0, 30, noContributions, true, true);
assert.equal(raise.before.cash, 116520);
assert.equal(raise.after.cash, 148920);
assert.equal(raise.increase, 32400);
assert.ok(Math.abs(raise.cashRate - 27.806385170) < 0.000001);
assert.equal(calculateRaise(50000, 4, 0, defaults, true, true).cashRate, 0);
const automatic = calculateRaise(10000, 2.5, 30, defaults, true, true);
assert.equal(automatic.before.sb, 12083.33);
assert.equal(automatic.after.sb, 15708.33);
assert.equal(automatic.after.gross, 188500);
const changedBonus = calculateRaise(10000, 2.5, 30, defaults, true, true, 4);
assert.deepEqual(changedBonus.before, automatic.before);
assert.equal(changedBonus.after.gross, 208000);
assert.equal(changedBonus.after.sb, 17333.33);
assert.equal(calculateRaise(10000, 4, 30, defaults, true, true, 0).after.gross, 156000);
assert.equal(calculateRaise(10000, 4, 30, defaults, true, true, 1.5).after.gross, 175500);
for (const months of [-1, 1201, NaN, Infinity]) assert.equal(calculateRaise(10000, 4, 30, defaults, true, true, months), null);
// Direct bonus amounts must be taxed as entered, independently of monthly salary.
for (const separate of [true, false]) {
  const amounts = calculateRaiseAmounts(10000, 13000, 25000.01, 60000.02, defaults, true, separate);
  assert.deepEqual(amounts.before, calculate({ ...defaults, salary: 10000, bonus: 25000.01, equity: 0, socialBase: 12083.33, fundBase: 12083.33 }, separate, true));
  assert.deepEqual(amounts.after, calculate({ ...defaults, salary: 13000, bonus: 60000.02, equity: 0, socialBase: 18000, fundBase: 18000 }, separate, true));
}
assert.deepEqual(calculateRaiseAmounts(10000, 13000, 25000, 52000, defaults, true, true), changedBonus);
assert.equal(calculateRaiseAmounts(10000, 9999, 0, 0, defaults, true, true), null);
assert.equal(calculateRaiseAmounts(10000, 13000, 0, 100000001, defaults, true, true), null);
const fixed = calculateRaise(10000, 0, 30, { ...defaults, socialBase: 8000, fundBase: 9000 }, false, false);
assert.equal(fixed.before.sb, fixed.after.sb);
assert.equal(fixed.before.fb, fixed.after.fb);
assert.deepEqual(calculateRaise(10000, 4, 30, { ...defaults, equity: 999999 }, true, true), calculateRaise(10000, 4, 30, defaults, true, true));
// A single-tax bonus crossing 36,000 can reduce net pay despite a nominal raise.
assert.ok(calculateRaise(3000, 12, 0.01, noContributions, true, true).increase < 0);
assert.equal(calculateRaise(1, 0, 30, defaults, true, true).cashRate, null);
for (const args of [[0, 4, 30], [NaN, 4, 30], [10000, -1, 30], [10000, 0, -1], [100000000, 1200, 30], [10000, 0, Infinity]]) {
  assert.equal(calculateRaise(...args, defaults, true, true), null);
}
assert.equal(tax(36000),1080);
assert.equal(tax(36000,true),1080);
assert.equal(tax(36001,true),3390.1);
assert.equal(tax(144000),11880);
assert.equal(tax(0),0);
assert.equal(tax(-1),0);
const r=calculate({...defaults,bonus:60000,equity:100000,socialBase:999999,fundBase:999999},true,true);
assert.equal(r.social,3819.54);
assert.equal(r.fund,4362);
assert.equal(r.fundAnnual,104688);
assert.equal(r.equityTax,7480);
assert.equal(r.bonusTax,5790);
for(const b of [true,false]) for(const e of [true,false]) {
 const a=calculate(defaults,b,e);
 assert.ok(Math.abs(a.salaryTax+a.bonusTax+a.equityTax-a.totalTax)<.01);
 assert.ok(Math.abs(a.cash+a.fundAnnual-a.total)<.01);
 assert.ok(Math.abs(a.months.reduce((s,x)=>s+x.tax,0)-a.salaryTax)<.01);
 assert.equal(a.gross-a.totalTax-a.social*12+a.employerFund*12,a.total);
}
const low=calculate({...defaults,salary:0,bonus:10000,equity:0,socialBase:0,fundBase:0,fund:0,employerFund:0,pension:0,medical:0,medicalFixed:0,unemployment:0},false,false);
assert.equal(low.totalTax,0);
assert.equal(low.total,10000);
assert.equal(calculate({...defaults,maxBase:40000,socialBase:60000,fundBase:60000},true,true).sb,40000);
assert.equal(calculate({...defaults,maxBase:40000,socialBase:60000,fundBase:60000},true,true).fund,4800);
console.log('Salary calculator: tax brackets, bonus cliff, contribution caps, equity, four tax plans and conservation checks passed.');
