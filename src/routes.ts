import { IRouterConfig, lazy } from 'ice';
import UserLayout from '@/layouts/UserLayout';
import BasicLayout from '@/layouts/BasicLayout';

const CommonTools = lazy(() => import('@/pages/CommonTools'));
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
        path: '/finance/bond',
        component: BondTools,
      }
    ],
  }
];
export default routerConfig;
