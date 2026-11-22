import * as React from 'react';
import { ResponsiveGrid } from '@alifd/next';
import PageHeader from '@/components/PageHeader';
import TaxCalculator from '@/components/RealEstate/TaxCalculator';
const { Cell } = ResponsiveGrid;
export default function RealEstateTools() {
  return <ResponsiveGrid gap={20}>
    <Cell colSpan={12}><PageHeader title="房地产工具" description="" breadcrumbs={[]} /></Cell>
    <Cell colSpan={12}><TaxCalculator /></Cell>
  </ResponsiveGrid>;
}
