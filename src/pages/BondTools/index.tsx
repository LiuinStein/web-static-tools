import React from 'react';
import PageHeader from '@/components/PageHeader';
import BondCalculator from '@/components/Financial/BondCalculator';

export default function BondTools() {
  return <div>
    <PageHeader title="债券类计算工具" description="" breadcrumbs={[]} />
    <BondCalculator />
  </div>;
}
