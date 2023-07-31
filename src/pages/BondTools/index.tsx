import * as React from 'react';
import { ResponsiveGrid } from '@alifd/next';

import PageHeader from '@/components/PageHeader';
import BondCalculator from '@/components/Financial/BondCalculator';

const { Cell } = ResponsiveGrid;

export default function() {
    return (
        <ResponsiveGrid gap={20}>
            <Cell colSpan={12}>
                <PageHeader
                    title="债券类计算工具"
                    description=""
                    breadcrumbs={[]}
                />
            </Cell>

            <Cell colSpan={12}>
                <BondCalculator />
            </Cell>

        </ResponsiveGrid>
    );
};
