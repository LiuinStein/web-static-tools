import * as React from 'react';
import { ResponsiveGrid } from '@alifd/next';

import PageHeader from '@/components/PageHeader';
import DateCalculator from '@/components/DateCalculator';
import PaTo10kPerDay from '@/components/Financial/PaTo10kPerDay';
import InterestByDay from '@/components/Financial/InterestByDay';
import ProductSwitch from '@/components/Financial/ProductSwitch';

const { Cell } = ResponsiveGrid;

export default function() {
    return (
        <ResponsiveGrid gap={20}>
            <Cell colSpan={12}>
                <PageHeader
                    title="货币、固收类计算工具"
                    description=""
                    breadcrumbs={[]}
                />
            </Cell>

            <Cell colSpan={12}>
                <PaTo10kPerDay />
            </Cell>

            <Cell colSpan={12}>
                <DateCalculator />
            </Cell>

            <Cell colSpan={12}>
                <InterestByDay />
            </Cell>

            <Cell colSpan={12}>
                <ProductSwitch />
            </Cell>

        </ResponsiveGrid>
    );
};
