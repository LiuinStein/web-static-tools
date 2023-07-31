import { IRouterConfig, lazy } from 'ice';
import UserLayout from '@/layouts/UserLayout';
import BasicLayout from '@/layouts/BasicLayout';

const CommonTools = lazy(() => import('@/pages/CommonTools'));
const MonetaryTools = lazy(() => import('@/pages/MonetaryTools'));
const BondTools = lazy(() => import('@/pages/BondTools'));

const routerConfig: IRouterConfig[] = [
  {
    path: '/',
    component: BasicLayout,
    children: [
      {
        path: '/common',
        component: CommonTools,
      },
      {
        path: '/finance/monetary',
        component: MonetaryTools,
      },
      {
        path: '/finance/bond',
        component: BondTools,
      }
    ],
  }
];
export default routerConfig;
