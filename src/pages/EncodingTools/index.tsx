import * as React from 'react';
import { ResponsiveGrid } from '@alifd/next';

import PageHeader from '@/components/PageHeader';
import CommonEncoder from '@/components/Code/CommonEncoder';

const { Cell } = ResponsiveGrid;

export default function () {
    return (
        <ResponsiveGrid gap={20}>
            <Cell colSpan={12}>
                <PageHeader
                    title="编解码工具"
                    description=""
                    breadcrumbs={[]}
                />
            </Cell>

            <Cell colSpan={12}>
                <CommonEncoder title={'Base64'} encoder={(v: string) => btoa(v)} decoder={(v: string) => atob(v)} />
            </Cell>

            <Cell colSpan={12}>
                <CommonEncoder title={'URL'} encoder={(v: string) => encodeURIComponent(v)} decoder={(v: string) => decodeURIComponent(v)} />
            </Cell>

        </ResponsiveGrid>
    );
};
