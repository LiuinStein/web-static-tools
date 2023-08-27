import { IRouterConfig, lazy } from 'ice';
import BasicLayout from '@/layouts/BasicLayout';

const CommonTools = lazy(() => import('@/pages/CommonTools'));
const MonetaryTools = lazy(() => import('@/pages/MonetaryTools'));
const BondTools = lazy(() => import('@/pages/BondTools'));
const StockTools = lazy(() => import('@/pages/StockTools'));

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
      },
      {
        path: '/finance/stock',
        component: StockTools,
      }
    ],
  }
];
export default routerConfig;
