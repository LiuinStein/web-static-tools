import * as React from 'react';
import { ResponsiveGrid } from '@alifd/next';

import PageHeader from '@/components/PageHeader';
import HKStockCommission from '@/components/Financial/HKStockCommission';
import USStockCommission from '@/components/Financial/USStockCommission';

const { Cell } = ResponsiveGrid;

export default function() {
    return (
        <ResponsiveGrid gap={20}>
            <Cell colSpan={12}>
                <PageHeader
                    title="股票类计算工具"
                    description=""
                    breadcrumbs={[]}
                />
            </Cell>

            <Cell colSpan={12}>
                <HKStockCommission />
            </Cell>

            <Cell colSpan={12}>
                <USStockCommission />
            </Cell>

        </ResponsiveGrid>
    );
};
