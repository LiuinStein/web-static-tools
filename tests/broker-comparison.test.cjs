const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
const {compareStockBrokers,calculateRoundTrip}=require('../src/components/Financial/StockCommission/model.ts');
const {plans}=require('../src/components/Financial/StockCommission/rates.ts');
const {compareBondBrokers,calculateBond}=require('../src/components/Financial/BondCalculator/model.ts');
const {bondPlans}=require('../src/components/Financial/BondCalculator/rates.ts');
test('every market plan is compared with current broker first and unchanged single-plan totals',()=>{
 for(const market of ['HK','US'])for(const plan of plans[market]){
  const input={market,price:123.45,shares:100,instrument:'stock',commissionFree:true,oddLotSell:true};
  const columns=compareStockBrokers(market,plan.broker,input,126);
  assert.equal(columns[0].plan.broker,plan.broker);assert.equal(columns.length,plans[market].length);
  assert.equal(new Set(columns.map(c=>c.plan.broker)).size,plans[market].length);
  for(const column of columns){assert.equal(column.error,'');assert.deepEqual(column.result,calculateRoundTrip({...input,broker:column.plan.broker,commissionFree:column.plan.broker==='futu',oddLotSell:market==='HK'&&column.plan.broker==='za'},126));}
 }
});
test('invalid stock inputs remain unavailable and broker-specific flags do not affect peers',()=>{
 assert.ok(compareStockBrokers('HK','futu',null).every(c=>c.result===null&&c.error));
 const input={market:'HK',price:100,shares:100};
 const standard=compareStockBrokers('HK','futu',input);
 const offers=compareStockBrokers('HK','za',{...input,commissionFree:true,oddLotSell:true});
 assert.deepEqual(standard.find(c=>c.plan.broker==='usmart').result,offers.find(c=>c.plan.broker==='usmart').result);
 assert.ok(offers.find(c=>c.plan.broker==='futu').result.total<standard.find(c=>c.plan.broker==='futu').result.total);
});
const input={currency:'USD',bondType:'treasury',buyPrice:97.654,unitFace:100,couponRate:2.5,faceAmount:10000,frequency:2,settlementDate:'2026-01-01',maturityDate:'2027-01-01',otherFees:7};
test('bond columns retain identical dates, rates and manual fees; chosen broker is first',()=>{
 for(const plan of bondPlans){const columns=compareBondBrokers('USD',plan.broker,'treasury',input);assert.equal(columns[0].plan.broker,plan.broker);assert.equal(columns.length,bondPlans.length);for(const c of columns){assert.equal(c.error,'');assert.deepEqual(c.result,calculateBond({...input,broker:c.plan.broker}));assert.equal(c.result.fees.find(f=>f.id==='other').amount,7);}}
});
test('unsupported currency/type is omitted without zero fees or substituted securities',()=>{
 const hkd=compareBondBrokers('HKD','futu','corporate',{...input,currency:'HKD',bondType:'corporate'});
 assert.equal(hkd[0].plan.broker,'futu');assert.ok(hkd[0].result);assert.equal(hkd.length,1);
 const municipal=compareBondBrokers('USD','schwab','municipal',{...input,bondType:'municipal'});
 assert.equal(municipal[0].plan.broker,'schwab');assert.ok(municipal[0].result);assert.equal(municipal.length,1);
 assert.ok(compareBondBrokers('USD','futu','treasury',{...input,maturityDate:'2020-01-01'}).every(c=>c.result===null&&c.error));
});
