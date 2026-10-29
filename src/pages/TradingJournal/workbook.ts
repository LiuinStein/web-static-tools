import ExcelJS from 'exceljs';
import { Trade, validateTrade } from './model';

const sheetName = '交易记录';
const columns: Array<[keyof Trade, string]> = [
  ['id', '记录ID'],
  ['date', '日期'],
  ['type', '类型'],
  ['code', '代码'],
  ['name', '名称'],
  ['stance', '看'],
  ['direction', '方向'],
  ['amount', '金额'],
  ['price', '单价'],
  ['shares', '份额'],
  ['fee', '交易费用'],
  ['reason', '交易原因'],
];
export async function readWorkbook(data?: ArrayBuffer): Promise<{ workbook: ExcelJS.Workbook; trades: Trade[] }> {
  const workbook = new ExcelJS.Workbook();
  if (data) await workbook.xlsx.load(data);
  let sheet = workbook.getWorksheet(sheetName);
  if (!sheet) {
    if (data) throw new Error('Excel 中缺少“交易记录”工作表。请使用本页导出的模板，避免覆盖现有数据。');
    sheet = workbook.addWorksheet(sheetName);
    sheet.addRow(columns.map(([, label]) => label));
  }
  columns.forEach(([, label], index) => {
    if (sheet!.getRow(1).getCell(index + 1).text !== label) throw new Error(`Excel 表头不匹配：第 ${index + 1} 列应为“${label}”`);
  });
  const trades: Trade[] = [];
  sheet.eachRow((row, index) => {
    if (index === 1 || row.values.length === 0) return;
    const trade: any = {};
    columns.forEach(([key], col) => {
      const cell = row.getCell(col + 1);
      if (['amount', 'price', 'shares', 'fee'].includes(key)) {
        trade[key] = cell.value === null || cell.text === '' ? undefined : Number(cell.value);
      } else if (key === 'date' && cell.value instanceof Date) {
        trade[key] = cell.value.toISOString().slice(0, 10);
      } else {
        trade[key] = cell.text;
      }
    });
    try {
      validateTrade(trade);
    } catch (error) {
      throw new Error(`Excel 第 ${index} 行：${error.message}`);
    }
    if (trades.some((item) => item.id === trade.id)) throw new Error(`Excel 第 ${index} 行记录 ID 重复`);
    trades.push(trade);
  });
  return { workbook, trades };
}
export async function writeWorkbook(workbook: ExcelJS.Workbook, trades: Trade[]): Promise<ArrayBuffer> {
  const sheet = workbook.getWorksheet(sheetName)!;
  trades.forEach(validateTrade);
  const byId = new Map(trades.map((trade) => [trade.id, trade]));
  if (byId.size !== trades.length) throw new Error('记录 ID 重复，未保存 Excel');
  // Update matching rows and remove deleted rows, retaining other worksheets.
  for (let index = sheet.rowCount; index > 1; index -= 1) {
    const row = sheet.getRow(index);
    const id = row.getCell(1).text;
    const trade = byId.get(id);
    if (!trade) sheet.spliceRows(index, 1);
    else {
      columns.forEach(([key], column) => {
        row.getCell(column + 1).value = trade[key] === undefined ? null : trade[key]!;
      });
      byId.delete(id);
    }
  }
  byId.forEach((trade) => sheet.addRow(columns.map(([key]) => (trade[key] === undefined ? null : trade[key]))));
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF209BFA' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  columns.forEach(([key], index) => {
    const column = sheet.getColumn(index + 1);
    const widths = { reason: 70, id: 40 };
    column.width = widths[key] || 18;
    if (['amount', 'price', 'shares', 'fee'].includes(key)) column.numFmt = '0.00####';
    if (key === 'code') column.numFmt = '@';
  });
  sheet.getColumn(12).alignment = { wrapText: true, vertical: 'top' };
  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
export async function exportTrades(trades: Trade[]): Promise<void> {
  const { workbook } = await readWorkbook();
  const data = await writeWorkbook(workbook, trades);
  const url = URL.createObjectURL(
    new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = '交易日记.xlsx';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
