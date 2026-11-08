export function monthlyFileName(date: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(date);
  if (!match) throw new Error('账本记账日期无效，无法生成月份文件名');
  return `${match[1]}${match[2]}.xlsx`;
}
