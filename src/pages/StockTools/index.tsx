import React from 'react';
import PageHeader from '@/components/PageHeader';
import StockCommission from '@/components/Financial/StockCommission';

export default function StockTools() {
  return <div>
    <PageHeader title="股票类计算工具" description="" breadcrumbs={[]} />
    <StockCommission />
  </div>;
}
