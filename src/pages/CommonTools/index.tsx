import * as React from 'react';
import { ResponsiveGrid } from '@alifd/next';

import PageHeader from '@/components/PageHeader';
import DateCalculator from '@/components/DateCalculator';

const { Cell } = ResponsiveGrid;

const CommonTools = () => {
    return (
        <ResponsiveGrid gap={20}>
            <Cell colSpan={12}>
                <PageHeader
                    title="通用工具"
                    description=""
                    breadcrumbs={[]}
                />
            </Cell>

            <Cell colSpan={12}>
                <DateCalculator />
            </Cell>

        </ResponsiveGrid>
    );
};

export default CommonTools;
