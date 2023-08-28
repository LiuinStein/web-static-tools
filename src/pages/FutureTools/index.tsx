import * as React from 'react';
import { ResponsiveGrid } from '@alifd/next';

import PageHeader from '@/components/PageHeader';
import USDOunceToRMBGram from '@/components/Financial/USDOunceToRMBGram';

const { Cell } = ResponsiveGrid;

export default function() {
    return (
        <ResponsiveGrid gap={20}>
            <Cell colSpan={12}>
                <PageHeader
                    title="期货类计算工具"
                    description=""
                    breadcrumbs={[]}
                />
            </Cell>

            <Cell colSpan={12}>
                <USDOunceToRMBGram />
            </Cell>

        </ResponsiveGrid>
    );
};
