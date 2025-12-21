import { IRouterConfig, lazy } from 'ice';
import BasicLayout from '@/layouts/BasicLayout';

const CommonTools = lazy(() => import('@/pages/CommonTools'));
const MonetaryTools = lazy(() => import('@/pages/MonetaryTools'));
const BondTools = lazy(() => import('@/pages/BondTools'));
const StockTools = lazy(() => import('@/pages/StockTools'));
const FutureTools = lazy(() => import('@/pages/FutureTools'));
const ReturnTools = lazy(() => import('@/pages/ReturnTools'));
const EncodingTools = lazy(() => import('@/pages/EncodingTools'));

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
      },
      {
        path: '/finance/future',
        component: FutureTools,
      },
      {
        path: '/finance/return',
        component: ReturnTools,
      },
      {
        path: '/code/encoding',
        component: EncodingTools,
      }
    ],
  }
];
export default routerConfig;
