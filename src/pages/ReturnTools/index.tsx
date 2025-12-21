import * as React from 'react';
import { ResponsiveGrid } from '@alifd/next';

import PageHeader from '@/components/PageHeader';
import XIRRCalculator from '@/components/Financial/XIRRCalculator';

const { Cell } = ResponsiveGrid;

export default function () {
    return (
        <ResponsiveGrid gap={20}>
            <Cell colSpan={12}>
                <PageHeader
                    title="收益率"
                    description=""
                    breadcrumbs={[]}
                />
            </Cell>

            <Cell colSpan={12}>
                <XIRRCalculator />
            </Cell>

        </ResponsiveGrid>
    );
}